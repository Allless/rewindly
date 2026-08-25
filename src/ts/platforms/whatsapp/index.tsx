/**
 * WhatsApp platform (beta): multi-chat ingestion from "Export chat" files.
 * Coverage is whatever the user exported; there is no live connection, so
 * media can't be fetched and a "refresh" means re-uploading.
 */
import { WhatsappConnect } from "./Connect";
import { loadDataset } from "../../store/datasetCache";

import type { Dataset } from "../../model/types";
import type { Platform, PlatformSession } from "../types";

/**
 * Which cached dataset belongs to WhatsApp. The cache is keyed by self id,
 * which is only knowable after an upload — so it's recorded here, letting a
 * reload restore the last rewind instead of demanding the files again.
 * (Deliberately a `retrogram.` key, like every other storage key.)
 */
const SELF_KEY = "retrogram.wa.self";

function createSession(dataset: Dataset): PlatformSession {
  return {
    selfId: () => Promise.resolve(dataset.self.id),
    ingest: () => {
      localStorage.setItem(SELF_KEY, dataset.self.id);
      return Promise.resolve(dataset);
    },
    onCacheRestored: () => Promise.resolve(),
    media: null,
    canRefresh: false,
    // A fresh upload must never be shadowed by an old cache; restoring one
    // is `resume()`'s job, and it feeds the dataset in directly.
    usesCache: false,
    disconnect: () => {
      localStorage.removeItem(SELF_KEY);
      return Promise.resolve();
    },
  };
}

/** Slides that need data text exports don't carry (reactions, media bytes). */
// The emoji-culture slide stays: its reaction half hides itself when the
// dataset has no reactions.
const UNSUPPORTED = new Set(["greatest-hits", "media-rotation"]);

function ConnectScreen({
  onConnected,
}: {
  onConnected: (session: PlatformSession) => void;
}) {
  return (
    <WhatsappConnect
      onReady={(dataset) => onConnected(createSession(dataset))}
    />
  );
}

export const whatsappPlatform: Platform = {
  id: "whatsapp",
  name: "WhatsApp",
  ConnectScreen,
  async resume() {
    const selfId = localStorage.getItem(SELF_KEY);
    if (!selfId) return null;
    const cached = await loadDataset(selfId);
    // A stale marker (cache cleared from the browser) falls back to upload.
    if (!cached || cached.meta.messageCount === 0) {
      localStorage.removeItem(SELF_KEY);
      return null;
    }
    return createSession(cached);
  },
  canResume: () => localStorage.getItem(SELF_KEY) !== null,
  supports: (slideId) => !UNSUPPORTED.has(slideId),
};
