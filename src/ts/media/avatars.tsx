/**
 * Peer avatars: real profile photos with an initials fallback. Photo downloads
 * need a live gramjs client, so the dashboard provides an `AvatarSource`
 * through context and stat cards stay pure — they just render `<Avatar>`.
 * Without a live session (e.g. a dataset restored from cache) the initials
 * fallback renders.
 */

import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";

import { SlidePriorityContext } from "./slidePriority";

export interface AvatarSource {
  /** Ask for a peer's profile photo; a no-op without a live client. */
  request: (peerId: string, priority?: number) => void;
  /** peerId → object URL, or null when the download failed/unavailable. */
  urls: Record<string, string | null>;
  /**
   * Allow loading public profile photos straight from t.me (no session, no
   * API). Only the shared-report view enables it: there is no client to
   * download with, and the photos are already public. It does mean the
   * viewer's browser requests those images from Telegram.
   */
  publicPhotos?: boolean;
}

export const AvatarContext = createContext<AvatarSource>({
  request: () => undefined,
  urls: {},
});

/** First letters of up to two title words, for the avatar fallback. */
export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? "");
  return letters.join("").toUpperCase();
}

/** Deterministic hue from the title, so each avatar has a stable color. */
export function avatarHue(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) % 360;
  }
  return hash;
}

/** Telegram's public userpic endpoint — works for any public @username. */
const publicPhotoUrl = (username: string) =>
  `https://t.me/i/userpic/320/${encodeURIComponent(username)}.jpg`;

export function Avatar({
  peerId,
  title,
  username,
}: {
  peerId: string;
  title: string;
  username?: string;
}) {
  const { request, urls, publicPhotos } = useContext(AvatarContext);
  const priority = useContext(SlidePriorityContext);
  const [publicFailed, setPublicFailed] = useState(false);
  useEffect(() => request(peerId, priority), [peerId, priority, request]);

  const url = urls[peerId];
  if (url) {
    return <img class="avatar avatar-img" src={url} alt="" loading="lazy" />;
  }
  if (publicPhotos && username && !publicFailed) {
    return (
      <img
        class="avatar avatar-img"
        src={publicPhotoUrl(username)}
        alt=""
        loading="lazy"
        onError={() => setPublicFailed(true)}
        // t.me answers "no public photo" with a 1×1 GIF (under a 404 the
        // browser ignores, because the body decodes), so `error` never fires
        // and an empty circle renders. Treat a degenerate image as a miss.
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
            setPublicFailed(true);
          }
        }}
      />
    );
  }
  return (
    <span
      class="avatar"
      style={{ backgroundColor: `hsl(${avatarHue(title)} 55% 45%)` }}
      aria-hidden="true"
    >
      {initials(title)}
    </span>
  );
}

/**
 * Best-effort Telegram link for a peer: t.me for public usernames, the tg://
 * app protocol for private users. Private groups/channels have no linkable
 * form → null.
 */
export function peerLink(peerId: string, username?: string): string | null {
  if (username) return `https://t.me/${username}`;
  const [kind, id] = peerId.split(":");
  return kind === "user" && id ? `tg://user?id=${id}` : null;
}

interface PeerProps {
  peerId: string;
  title: string;
  username?: string;
}

/** An `Avatar` that opens the chat in Telegram when the peer is linkable. */
export function PeerAvatar({ peerId, title, username }: PeerProps) {
  const link = peerLink(peerId, username);
  const avatar = <Avatar peerId={peerId} title={title} username={username} />;
  if (!link) return avatar;
  return (
    <a
      class="avatar-link"
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      aria-hidden="true"
    >
      {avatar}
    </a>
  );
}

/** A peer's display name, linked to Telegram when the peer is linkable. */
export function PeerName({
  peerId,
  title,
  username,
  class: className,
}: PeerProps & { class: string }) {
  const link = peerLink(peerId, username);
  if (!link) return <span class={className}>{title}</span>;
  return (
    <a class={className} href={link} target="_blank" rel="noopener noreferrer">
      {title}
    </a>
  );
}
