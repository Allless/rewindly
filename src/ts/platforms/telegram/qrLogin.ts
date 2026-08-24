/**
 * MTProto QR-login orchestration (gramjs).
 *
 * SECURITY: the session string produced here is *full-account access* to the
 * user's Telegram — equivalent to a logged-in device. It is persisted only to
 * this browser's localStorage and must NEVER be uploaded, logged, or leave the
 * device. Rewindly is 100% client-side precisely so this token stays local.
 *
 * gramjs and its Node polyfills are imported lazily *inside* the function so the
 * rest of the app (and the pure `loginLink` layer) does not hard-crash at import
 * time if the browser polyfills are unavailable.
 */
import type { TelegramClient } from "telegram";

import { buildLoginLink } from "./loginLink";

const SESSION_STORAGE_KEY = "retrogram.session";

const API_ID = Number(import.meta.env.VITE_TG_API_ID);
const API_HASH = String(import.meta.env.VITE_TG_API_HASH ?? "");

export interface QrLoginOptions {
  /** Called with a fresh `tg://login?token=...` URL each time the token rotates. */
  onLoginUrl: (url: string) => void;
  /** Called on a login error. Return `true` to stop retrying, `false` to continue. */
  onError: (err: Error) => Promise<boolean> | boolean;
  /** Supplies the 2FA password when the account has one set. */
  password?: () => Promise<string>;
  /** Handle to the underlying client, so the caller can disconnect a flow it abandons. */
  onClient?: (client: TelegramClient) => void;
}

export interface PhoneLoginOptions {
  /** Supplies the phone number (international format). Re-called if invalid. */
  phoneNumber: () => Promise<string>;
  /** Supplies the login code Telegram sends. Re-called if wrong. */
  phoneCode: () => Promise<string>;
  /** Supplies the 2FA password when the account has one set. */
  password: () => Promise<string>;
  /** Called on a login error. Return `true` to stop retrying, `false` to continue. */
  onError: (err: Error) => Promise<boolean> | boolean;
  /** Handle to the underlying client, so the caller can disconnect a flow it abandons. */
  onClient?: (client: TelegramClient) => void;
}

/** Connect a client on the saved session (or a fresh one). */
async function connectClient(): Promise<TelegramClient> {
  if (!API_ID || !API_HASH) {
    throw new Error(
      "Missing VITE_TG_API_ID / VITE_TG_API_HASH — register an app at my.telegram.org.",
    );
  }

  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions");

  const session = new StringSession(loadSavedSession() ?? "");
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();
  return client;
}

/**
 * Start the QR-login flow. Resolves with the connected client once the user has
 * authorized the session from their Telegram app.
 */
export async function startQrLogin(
  opts: QrLoginOptions,
): Promise<TelegramClient> {
  const client = await connectClient();
  opts.onClient?.(client);

  // Resume silently if the stored session is still authorized — no QR needed.
  if (await client.checkAuthorization()) {
    persistSession(client.session.save());
    return client;
  }

  await client.signInUserWithQrCode(
    { apiId: API_ID, apiHash: API_HASH },
    {
      qrCode: async (code) => opts.onLoginUrl(buildLoginLink(code.token)),
      onError: async (err) => opts.onError(err),
      password: opts.password,
    },
  );

  persistSession(client.session.save());
  return client;
}

/**
 * Start the phone-number login flow (sendCode → code → optional 2FA). The
 * callbacks are awaited as gramjs walks the flow, so the UI drives each step
 * by resolving them. This is the primary path on mobile, where Telegram
 * deliberately won't confirm a same-device `tg://login` deep link.
 */
export async function startPhoneLogin(
  opts: PhoneLoginOptions,
): Promise<TelegramClient> {
  const client = await connectClient();
  opts.onClient?.(client);

  // Resume silently if the stored session is still authorized.
  if (await client.checkAuthorization()) {
    persistSession(client.session.save());
    return client;
  }

  await client.signInUser(
    { apiId: API_ID, apiHash: API_HASH },
    {
      phoneNumber: opts.phoneNumber,
      phoneCode: opts.phoneCode,
      password: opts.password,
      onError: async (err) => opts.onError(err),
    },
  );

  persistSession(client.session.save());
  return client;
}

/**
 * Silently resume the saved session, or `null` when there is none or it was
 * revoked. Never shows UI; connection errors propagate to the caller (a dead
 * network shouldn't wipe a valid session).
 */
export async function resumeSavedSession(): Promise<TelegramClient | null> {
  if (!loadSavedSession()) return null;
  const client = await connectClient();
  if (await client.checkAuthorization()) {
    persistSession(client.session.save());
    return client;
  }
  // Revoked from another device — the stored string is dead weight.
  clearSession();
  await client.disconnect().catch(() => undefined);
  return null;
}

/** Read the saved session string, or `null` if none is stored. */
export function loadSavedSession(): string | null {
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

/** Remove the saved session (log out locally). */
export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function persistSession(session: unknown): void {
  if (typeof session === "string" && session.length > 0) {
    localStorage.setItem(SESSION_STORAGE_KEY, session);
  }
}
