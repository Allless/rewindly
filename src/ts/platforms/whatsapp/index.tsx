/**
 * WhatsApp platform (beta): multi-chat ingestion from "Export chat" files.
 * Coverage is whatever the user exported; there is no live connection, so
 * media can't be fetched and a "refresh" means re-uploading.
 */
import { WhatsappConnect } from "./Connect";

import type { Dataset } from "../../model/types";
import type { Platform, PlatformSession } from "../types";

function createSession(dataset: Dataset): PlatformSession {
  return {
    selfId: () => Promise.resolve(dataset.self.id),
    ingest: () => Promise.resolve(dataset),
    onCacheRestored: () => Promise.resolve(),
    media: null,
    canRefresh: false,
    usesCache: false, // a fresh upload must never be shadowed by old cache
    disconnect: () => Promise.resolve(),
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
  supports: (slideId) => !UNSUPPORTED.has(slideId),
};
