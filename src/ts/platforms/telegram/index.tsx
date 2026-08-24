/**
 * Telegram platform: full-account ingest over MTProto (gramjs) behind a
 * QR/phone login. The only module tree that touches gramjs.
 */
import { QrConnect } from "./QrConnect";
import { clearSession, loadSavedSession, resumeSavedSession } from "./qrLogin";
import {
  fetchPeerRefs,
  ingest,
  type HitRefs,
  type MediaRefs,
  type PeerRefs,
} from "./ingest";
import { createTelegramMediaResolver } from "./media";

import type { TelegramClient } from "telegram";
import type { Platform, PlatformSession } from "../types";

function createSession(client: TelegramClient): PlatformSession {
  // Mutated in place by ingest/cache-restore; the resolver closes over them.
  const refs: MediaRefs = new Map();
  const peers: PeerRefs = new Map();
  const hits: HitRefs = new Map();

  return {
    async selfId() {
      const me = (await client.getMe()) as { id?: unknown };
      return `user:${String(me.id)}`;
    },

    async ingest({ onProgress }) {
      const result = await ingest(client, { onProgress });
      for (const [map, fresh] of [
        [refs, result.mediaRefs],
        [peers, result.peerRefs],
        [hits, result.hitRefs],
      ] as const) {
        map.clear();
        for (const [k, v] of fresh) map.set(k, v);
      }
      return result.dataset;
    },

    // Media refs aren't serializable, so a cached session renders stickers/
    // gifs from the persisted blob store only; peer refs rebuild with one
    // cheap call so profile photos always resolve.
    async onCacheRestored() {
      const fetched = await fetchPeerRefs(client).catch(
        () => new Map() as PeerRefs,
      );
      for (const [k, v] of fetched) peers.set(k, v);
    },

    media: createTelegramMediaResolver(client, refs, peers, hits),
    canRefresh: true,
    usesCache: true,

    async disconnect() {
      clearSession();
      await client.disconnect().catch(() => undefined);
    },
  };
}

function ConnectScreen({
  onConnected,
}: {
  onConnected: (session: PlatformSession) => void;
}) {
  return (
    <QrConnect onConnected={(client) => onConnected(createSession(client))} />
  );
}

export const telegramPlatform: Platform = {
  id: "telegram",
  name: "Telegram",
  ConnectScreen,
  async resume() {
    const client = await resumeSavedSession();
    return client ? createSession(client) : null;
  },
  canResume: () => loadSavedSession() !== null,
  supports: () => true,
};
