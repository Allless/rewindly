import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { Dashboard } from "./dashboard/Dashboard";
import { SharedReport } from "./dashboard/SharedReport";
import { ThemeToggle } from "./dashboard/ThemeToggle";
import { telegramPlatform } from "./platforms/telegram";
import { whatsappPlatform } from "./platforms/whatsapp";
import { decryptText } from "./share/crypto";
import { inflateText, parseShareHash } from "./share/link";
import { shareStatus } from "./share/summary";
import { fetchShare } from "./share/telegraph";
import { clearDataset, loadDataset, saveDataset } from "./store/datasetCache";
import { REPO_URL } from "./links";
import Logo from "../logo.svg?react";

import type { IngestProgress, PlatformSession } from "./platforms/types";
import type { ShareRef } from "./share/link";
import type { SharedSummary } from "./share/summary";
import type { Dataset } from "./model/types";

type Status = "resuming" | "connect" | "loading" | "ready" | "error";

/** What the loading screen is actually doing right now. */
type LoadStage = "cache" | "ingest";

// Telegram is the main flow; WhatsApp is offered as a beta behind a query
// param until it earns its own page.
const platform =
  new URLSearchParams(location.search).get("platform") === "whatsapp"
    ? whatsappPlatform
    : telegramPlatform;

const resumable = () =>
  Boolean(platform.resume && (platform.canResume?.() ?? true));

/**
 * Root component and data-flow controller. On connect it reads the account's
 * history into a normalized `Dataset` (from the IndexedDB cache if present,
 * otherwise a fresh ingest), then hands it to the dashboard. Everything stays
 * on-device — Rewindly has no backend.
 */
export function App() {
  // Dev-only: `?fixture` renders the dashboard with the sample dataset.
  if (import.meta.env.DEV && location.search.includes("fixture")) {
    return <FixtureApp />;
  }
  return <ConnectedApp />;
}

function FixtureApp() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  useEffect(() => {
    void import("./model/fixture").then((m) => setDataset(m.sampleDataset));
  }, []);
  if (!dataset) return <p class="muted">Loading fixture…</p>;
  return (
    <div class="app">
      <main>
        <Dashboard
          dataset={dataset}
          media={null}
          onDisconnect={() => undefined}
        />
      </main>
    </div>
  );
}

function ConnectedApp() {
  // A stored session resumes silently; starting in "resuming" keeps the
  // login form from flashing for a returning user (and the loading screen
  // from flashing for a first-time one).
  const [status, setStatus] = useState<Status>(() =>
    resumable() && !parseShareHash(location.hash) ? "resuming" : "connect",
  );
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [loadStage, setLoadStage] = useState<LoadStage>("cache");
  const [error, setError] = useState<string | null>(null);

  // Opened via a share link? Render the shared summary instead of the login
  // flow — no Telegram session needed for viewing.
  const [shareRef, setShareRef] = useState<ShareRef | null>(() =>
    parseShareHash(location.hash),
  );
  const [sharedSummary, setSharedSummary] = useState<SharedSummary | null>(
    null,
  );
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareRef) return;
    let cancelled = false;
    setSharedSummary(null);
    setShareError(null);
    loadSharedSummary(shareRef)
      .then((summary) => {
        if (!cancelled) setSharedSummary(summary);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setShareError(
            err instanceof Error ? err.message : "Couldn't load this share.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shareRef]);

  const exitShared = () => {
    history.replaceState(null, "", location.pathname + location.search);
    setShareRef(null);
    setSharedSummary(null);
    setShareError(null);
  };

  const handleConnected = useCallback(async (connected: PlatformSession) => {
    setStatus("loading");
    setLoadStage("cache");
    setError(null);
    setSession(connected);
    try {
      setDataset(
        await loadOrIngest(connected, setProgress, () =>
          setLoadStage("ingest"),
        ),
      );
      setStatus("ready");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't read your Telegram data.",
      );
      setStatus("error");
    }
  }, []);

  // The silent resume itself; one-shot. Any failure just lands on the login
  // screen — a dead network must not look like a broken app.
  const resumeTried = useRef(false);
  useEffect(() => {
    if (resumeTried.current) return;
    resumeTried.current = true;
    if (!platform.resume || !resumable() || shareRef) return;
    platform.resume().then(
      (restored) => {
        if (restored) void handleConnected(restored);
        else setStatus("connect");
      },
      () => setStatus("connect"),
    );
  }, [shareRef, handleConnected]);

  // Re-ingest, bypassing the cache. The old entry survives until the new
  // ingest succeeds, so an interrupted refresh keeps the existing results.
  const handleRefresh = async () => {
    if (!session?.canRefresh) return;
    setStatus("loading");
    setLoadStage("ingest");
    setError(null);
    setProgress(null);
    try {
      setDataset(await ingestFresh(session, setProgress));
      setStatus("ready");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't read your Telegram data.",
      );
      setStatus("error");
    }
  };

  const handleDisconnect = () => {
    // Only this platform's data: ids are namespaced (`wa:` etc. — see
    // platforms/types.ts), Telegram's are legacy-unprefixed.
    void clearDataset(
      platform.id === "whatsapp"
        ? (key) => key.includes("wa:")
        : (key) => !key.includes("wa:"),
    );
    void session?.disconnect();
    setDataset(null);
    setSession(null);
    setError(null);
    setStatus("connect");
  };

  const media = session?.media ?? null;

  return (
    <div class="app">
      <header class="app-header">
        <div>
          <h1 class="wordmark">
            <a
              class="wordmark-link"
              href={location.pathname}
              onClick={(event) => {
                // Shared view exits in place; otherwise let the link navigate
                // (e.g. from ?platform=whatsapp back home).
                if (shareRef) {
                  event.preventDefault();
                  exitShared();
                }
              }}
            >
              <Logo class="wordmark-logo" />
              Rewindly
            </a>
          </h1>
          <p class="tagline">
            Your {platform.name}, rewound — 100% in your browser
          </p>
        </div>
        {/* The dashboard carries its own toggle in its action row. */}
        {!(status === "ready" && !shareRef) && <ThemeToggle />}
      </header>

      <main>
        {shareRef && shareError && (
          <div class="error-panel">
            <p>{shareError}</p>
            <button type="button" class="btn-secondary" onClick={exitShared}>
              Go to Rewindly
            </button>
          </div>
        )}

        {shareRef && !shareError && !sharedSummary && (
          <p class="muted">Loading shared report…</p>
        )}

        {shareRef && !shareError && sharedSummary && (
          <SharedReport summary={sharedSummary} onMakeYourOwn={exitShared} />
        )}

        {!shareRef && status === "connect" && (
          <div class="view-enter">
            <platform.ConnectScreen onConnected={handleConnected} />
            {platform.id === "telegram" && (
              <p class="muted hint beta-link">
                WhatsApp user?{" "}
                <a href="?platform=whatsapp">Try the WhatsApp rewind (beta)</a>
              </p>
            )}
          </div>
        )}

        {!shareRef && status === "resuming" && (
          <LoadingScreen stage="restore" progress={null} />
        )}

        {!shareRef && status === "loading" && (
          <LoadingScreen stage={loadStage} progress={progress} />
        )}

        {!shareRef && status === "error" && (
          <div class="error-panel view-enter">
            <p>{error}</p>
            <button
              type="button"
              class="btn-secondary"
              onClick={handleDisconnect}
            >
              Start over
            </button>
          </div>
        )}

        {!shareRef && status === "ready" && dataset && (
          <div class="view-enter">
            <Dashboard
              dataset={dataset}
              media={media}
              onRefresh={
                session?.canRefresh ? () => void handleRefresh() : undefined
              }
              onDisconnect={handleDisconnect}
              supportsSlide={platform.supports}
            />
          </div>
        )}
      </main>

      <footer class="app-footer">
        <p class="muted">
          Open source (MIT) ·{" "}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Source &amp; issues on GitHub
          </a>{" "}
          · No backend, no analytics, no tracking — not affiliated with Telegram
          or WhatsApp.
          {__COMMIT_HASH__ && (
            <>
              {" · Deployed from "}
              <a
                href={`${REPO_URL}/commit/${__COMMIT_HASH__}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <code>{__COMMIT_HASH__}</code>
              </a>
            </>
          )}
        </p>
      </footer>
    </div>
  );
}

/**
 * The one screen between login and dashboard. Stages: reconnecting a stored
 * session, checking the local cache, then the real ingest with a per-chat
 * progress bar — and an explicit countdown whenever the platform rate-limits
 * us, so a long pause reads as "waiting on Telegram", not "hung".
 */
function LoadingScreen({
  stage,
  progress,
}: {
  stage: "restore" | LoadStage;
  progress: IngestProgress | null;
}) {
  const wait = progress?.waitSeconds;
  const [waitLeft, setWaitLeft] = useState<number | null>(null);

  // Local countdown between progress events; the next flowing event (no
  // waitSeconds) clears it.
  useEffect(() => {
    if (wait === undefined) {
      setWaitLeft(null);
      return;
    }
    setWaitLeft(Math.ceil(wait));
    const timer = setInterval(
      () => setWaitLeft((s) => (s !== null && s > 0 ? s - 1 : s)),
      1000,
    );
    return () => clearInterval(timer);
  }, [wait, progress]);

  const fraction =
    progress && progress.chatsTotal > 0
      ? Math.min(1, progress.chatsDone / progress.chatsTotal)
      : null;

  return (
    <div class="loading-screen view-enter" role="status">
      <div class="load-spinner" aria-hidden="true" />

      {stage === "restore" && (
        <p class="muted">Reconnecting your {platform.name} session…</p>
      )}
      {stage === "cache" && (
        <p class="muted">Checking for data already on this device…</p>
      )}

      {stage === "ingest" && (
        <>
          <p class="muted">
            {progress
              ? `Reading your ${platform.name} history on this device…`
              : "Listing your chats…"}
          </p>
          <div class="load-bar">
            <div
              class={`load-bar-fill${fraction === null ? " load-bar-indeterminate" : ""}`}
              style={
                fraction !== null
                  ? { transform: `scaleX(${fraction})` }
                  : undefined
              }
            />
          </div>
          {progress && (
            <p class="muted load-count">
              {progress.chatsDone}/{progress.chatsTotal} chats ·{" "}
              {progress.messages.toLocaleString()} messages
            </p>
          )}
          {waitLeft !== null && (
            <p class="load-wait">
              {platform.name} asked us to slow down — resuming{" "}
              {waitLeft > 0 ? `in ${waitLeft}s` : "any moment now"}…
            </p>
          )}
          {platform.id === "telegram" && waitLeft === null && (
            <p class="muted hint">
              Telegram rate-limits large accounts, so this can pause and take a
              few minutes. Nothing leaves your device.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Resolve a share link to its summary: fetch+decrypt, or inflate inline data. */
async function loadSharedSummary(ref: ShareRef): Promise<SharedSummary> {
  const json =
    ref.kind === "inline"
      ? await inflateText(ref.data)
      : await decryptText(await fetchShare(ref.paths), ref.key);
  const parsed: unknown = JSON.parse(json);
  const status = shareStatus(parsed);
  if (status === "unsupported") {
    throw new Error(
      "This share was made with a different version of Rewindly and can't be opened. Ask for a fresh link.",
    );
  }
  if (status === "invalid") {
    throw new Error("This link doesn't contain a valid Rewindly share.");
  }
  return parsed as SharedSummary;
}

/** Reuse the cached dataset for this account if present, else ingest and cache. */
async function loadOrIngest(
  session: PlatformSession,
  onProgress: (p: IngestProgress) => void,
  onIngestStart: () => void,
): Promise<Dataset> {
  if (session.usesCache) {
    const cached = await loadDataset(await session.selfId());
    if (cached && cached.meta.messageCount > 0) {
      await session.onCacheRestored();
      return cached;
    }
  }
  onIngestStart();
  return ingestFresh(session, onProgress);
}

/** Ingest from the platform and cache the result. */
async function ingestFresh(
  session: PlatformSession,
  onProgress: (p: IngestProgress) => void,
): Promise<Dataset> {
  const dataset = await session.ingest({ onProgress });
  await saveDataset(dataset);
  return dataset;
}
