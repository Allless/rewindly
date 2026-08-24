/**
 * The platform seam: everything outside `platforms/` interacts with chat
 * services only through these types. A platform owns acquisition (login or
 * file upload), ingestion into the common `Dataset`, and live media fetching;
 * the app shell, dashboard, stats, cache, and share layers are platform-blind.
 *
 * Invariant: every id a platform puts in a `Dataset` (peers, messages, media)
 * must be globally unique across platforms — Telegram uses its legacy shapes
 * (`user:123`), other platforms must prefix theirs (`wa:…`) — because the
 * dataset and blob caches key on them unprefixed.
 */
import type { FunctionComponent } from "preact";

import type { Dataset, PeerId } from "../model/types";
import type { MediaResolver } from "../media/downloadMedia";

export type PlatformId = "telegram" | "whatsapp";

export interface IngestProgress {
  chatsDone: number;
  chatsTotal: number;
  messages: number;
  /** Set while the platform rate-limits us: seconds it told us to wait.
   * Cleared (undefined) on the next flowing progress event. */
  waitSeconds?: number;
}

/** A connected/loaded source of one account's data. */
export interface PlatformSession {
  /** Stable id of the account owner; the dataset cache key. */
  selfId(): Promise<PeerId>;
  /** Read the full (or best-available) history into a Dataset. */
  ingest(opts: { onProgress?: (p: IngestProgress) => void }): Promise<Dataset>;
  /** Called instead of ingest() when a cached dataset is served. */
  onCacheRestored(): Promise<void>;
  /** Live media fetching, or null when the platform can't fetch post-ingest. */
  media: MediaResolver | null;
  /** Whether ingest() can be re-run to refresh (vs. re-acquiring files). */
  canRefresh: boolean;
  /** False when connecting brings fresh data (file upload) that must not be
   * shadowed by a previously cached dataset. */
  usesCache: boolean;
  disconnect(): Promise<void>;
}

export interface Platform {
  id: PlatformId;
  name: string;
  /** Acquisition UI; resolves silently when a stored session can resume. */
  ConnectScreen: FunctionComponent<{
    onConnected: (session: PlatformSession) => void;
  }>;
  /** Silently resume a previously stored session, or null when there is
   * none — lets the shell skip straight past the login screen without
   * flashing it. Omitted when the platform has nothing to resume. */
  resume?: () => Promise<PlatformSession | null>;
  /** Synchronous hint that resume() has something to try, so first-time
   * visitors start on the login screen with no loading flash. Treated as
   * true when omitted. */
  canResume?: () => boolean;
  /** Whether this platform's data can populate the given slide. */
  supports(slideId: string): boolean;
}
