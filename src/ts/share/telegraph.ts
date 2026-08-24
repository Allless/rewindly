/**
 * Anonymous ciphertext hosting on Telegram's Telegraph (telegra.ph). Account
 * creation is anonymous — no Telegram identity involved, just a bearer token
 * minted on the spot. The token is kept in this browser's localStorage only,
 * so this device can later overwrite ("revoke") the page. Pages hold base64url
 * ciphertext — useless without the key, which never leaves the URL fragment.
 */

const API = "https://api.telegra.ph";
const SHARES_STORAGE_KEY = "retrogram.shares";

export interface TelegraphShare {
  /** Pages holding consecutive slices of the payload, in order. */
  paths: string[];
  accessToken: string;
}

interface TelegraphResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

async function call(
  method: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  // Form-encoded on purpose: it's a CORS "simple request", so the browser
  // skips the OPTIONS preflight — which telegra.ph answers with 501.
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    body: new URLSearchParams(params),
  });
  const body = (await response.json()) as TelegraphResponse;
  if (!body.ok || typeof body.result !== "object" || body.result === null) {
    throw new Error(body.error ?? `telegra.ph ${method} failed`);
  }
  return body.result as Record<string, unknown>;
}

/** Telegraph rejects pages over 64KB; refuse early so the caller falls back. */
export const MAX_PAYLOAD_CHARS = 60_000;

/**
 * How many pages a single share may span. Each page is one more anonymous
 * upload and one more path in the link; in exchange the payload budget — and
 * with it the thumbnail resolution that fits inside — scales linearly.
 */
export const MAX_SHARE_PAGES = 2;

/** Total ciphertext a share may carry, across all its pages. */
export function shareCapacityChars(): number {
  return MAX_PAYLOAD_CHARS * MAX_SHARE_PAGES;
}

/**
 * Plaintext ceiling: encryption base64-expands by 4/3, so this is what a
 * summary may weigh before it stops fitting the share's pages. Callers size
 * thumbnails against the room left over after the structural sections.
 */
export const MAX_SUMMARY_CHARS =
  Math.floor((shareCapacityChars() * 3) / 4) - 1000;

/**
 * Upload a share payload, splitting it across pages when it exceeds one
 * page's cap. Returns the page paths in order plus the edit token.
 */
export async function uploadShare(payload: string): Promise<TelegraphShare> {
  const slices: string[] = [];
  for (let at = 0; at < payload.length; at += MAX_PAYLOAD_CHARS) {
    slices.push(payload.slice(at, at + MAX_PAYLOAD_CHARS));
  }
  if (slices.length > MAX_SHARE_PAGES) {
    throw new Error("share payload needs more pages than a share may span");
  }

  const account = await call("createAccount", { short_name: "rewindly" });
  const accessToken = account.access_token;
  if (typeof accessToken !== "string") {
    throw new Error("telegra.ph returned no access token");
  }

  // Promise.all keeps the pages in slice order, which is what reassembly
  // depends on.
  const paths = await Promise.all(
    slices.map(async (slice) => {
      const page = await call("createPage", {
        access_token: accessToken,
        // Single-letter title → short page path → short share URL.
        title: "r",
        author_name: "Rewindly",
        content: JSON.stringify([{ tag: "p", children: [slice] }]),
      });
      const path = page.path;
      if (typeof path !== "string") {
        throw new Error("telegra.ph returned no page path");
      }
      return path;
    }),
  );
  return { paths, accessToken };
}

/** Collect all text under Telegraph content nodes. */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node !== null && "children" in node) {
    return textOf((node as { children: unknown }).children);
  }
  return "";
}

/** Fetch a share payload back from its page path. */
export async function fetchShare(paths: string[]): Promise<string> {
  const slices = await Promise.all(
    paths.map(async (path) => {
      const page = await call(`getPage/${encodeURIComponent(path)}`, {
        return_content: "true",
      });
      return textOf(page.content).trim();
    }),
  );
  const payload = slices.join("");
  if (!payload || slices.some((slice) => !slice)) {
    throw new Error("This share is empty or was revoked.");
  }
  return payload;
}

/**
 * Remember a created share (path → edit token) so this device could revoke
 * it later by overwriting the page.
 */
export function rememberShare(share: TelegraphShare): void {
  try {
    const raw = localStorage.getItem(SHARES_STORAGE_KEY);
    const shares = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    for (const path of share.paths) shares[path] = share.accessToken;
    localStorage.setItem(SHARES_STORAGE_KEY, JSON.stringify(shares));
  } catch {
    // Best effort — sharing still works without revocation bookkeeping.
  }
}
