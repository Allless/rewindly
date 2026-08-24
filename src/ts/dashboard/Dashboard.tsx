import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import { STAT_REGISTRY } from "../stats/allStats";
import { formatRelativeDays } from "../stats/shared/formatDate";
import { AvatarContext, type AvatarSource } from "../media/avatars";
import { getAvatarUrl, getHitPreview } from "../media/downloadMedia";
import { enqueueFetch } from "../media/fetchQueue";
import { HitPreviewContext, type HitPreviewSource } from "../media/hitPreviews";
import { MediaStat } from "./MediaStat";
import { StoryColumn, type Slide } from "./StoryColumn";
import { SharePanel } from "./SharePanel";
import { ThemeToggle } from "./ThemeToggle";
import ShareIcon from "../../icons/share.svg?react";
import RefreshIcon from "../../icons/refresh.svg?react";
import LogoutIcon from "../../icons/logout.svg?react";

import type { ComponentChildren } from "preact";
import type { MediaResolver, MediaPreview } from "../media/downloadMedia";
import type { Dataset } from "../model/types";

const DAY_MS = 86_400_000;

/**
 * Resolves profile photos on demand for whichever peers the visible cards ask
 * about — from the persisted blob store or a live download — so stat cards
 * can render real avatars while staying pure. Peers with neither fall back to
 * initials.
 */
function AvatarProvider({
  media,
  children,
}: {
  media: MediaResolver | null;
  children: ComponentChildren;
}) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const requested = useRef(new Set<string>());
  const created = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const url of created.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const request = useCallback(
    (peerId: string, priority = 0) => {
      if (requested.current.has(peerId)) return;
      requested.current.add(peerId);
      void enqueueFetch(priority, () => getAvatarUrl(media, peerId)).then(
        (url) => {
          if (url) created.current.push(url);
          setUrls((prev) => ({ ...prev, [peerId]: url }));
        },
      );
    },
    [media],
  );

  const source = useMemo<AvatarSource>(
    () => ({ request, urls }),
    [request, urls],
  );

  return (
    <AvatarContext.Provider value={source}>{children}</AvatarContext.Provider>
  );
}

/** Same pattern as AvatarProvider, for "Greatest hits" media previews. */
function HitPreviewProvider({
  media,
  children,
}: {
  media: MediaResolver | null;
  children: ComponentChildren;
}) {
  const [previews, setPreviews] = useState<Record<string, MediaPreview | null>>(
    {},
  );
  const requested = useRef(new Set<string>());
  const created = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const url of created.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const request = useCallback(
    (messageId: string, priority = 0) => {
      if (requested.current.has(messageId)) return;
      requested.current.add(messageId);
      void enqueueFetch(priority, () => getHitPreview(media, messageId)).then(
        (preview) => {
          if (preview) created.current.push(preview.url);
          setPreviews((prev) => ({ ...prev, [messageId]: preview }));
        },
      );
    },
    [media],
  );

  const source = useMemo<HitPreviewSource>(
    () => ({ request, previews }),
    [request, previews],
  );

  return (
    <HitPreviewContext.Provider value={source}>
      {children}
    </HitPreviewContext.Provider>
  );
}

/** Every slide in story order: registry stats with the sticker/GIF slides
 * spliced into the quirks act (before `greatest-hits`, the act's climax),
 * and Share closing the finale. `supports` drops slides the dataset's
 * platform has no data for. */
function buildSlides(
  dataset: Dataset,
  media: MediaResolver | null,
  supports: (slideId: string) => boolean,
): Slide[] {
  const statSlides: Slide[] = STAT_REGISTRY.filter((stat) =>
    supports(stat.id),
  ).map((stat) => ({
    id: stat.id,
    title: stat.title,
    icon: stat.icon,
    description: stat.description,
    act: stat.act,
    archetype: stat.archetype,
    hero: stat.hero,
    content: <stat.Render dataset={dataset} />,
  }));

  const mediaSlides: Slide[] = [
    {
      id: "media-rotation",
      title: "Sticker & GIF rotation",
      icon: "🧩",
      description: "The stickers and GIFs you send most.",
      act: "quirks",
      archetype: "gallery",
      content: (
        <div class="response-times">
          <div class="response-section">
            <h4>Stickers</h4>
            <MediaStat
              dataset={dataset}
              media={media}
              mediaType="sticker"
              emptyLabel="No stickers sent yet."
            />
          </div>
          <div class="response-section">
            <h4>GIFs</h4>
            <MediaStat
              dataset={dataset}
              media={media}
              mediaType="gif"
              emptyLabel="No GIFs sent yet."
            />
          </div>
        </div>
      ),
    },
  ];

  const foundHits = statSlides.findIndex((s) => s.id === "greatest-hits");
  const hitsAt = foundHits === -1 ? statSlides.length : foundHits;
  return [
    ...statSlides.slice(0, hitsAt),
    ...mediaSlides.filter((s) => supports(s.id)),
    ...statSlides.slice(hitsAt),
    {
      id: "share",
      title: "Share your year",
      icon: "🔗",
      description:
        "Pick sections and get an anonymized link — never names or messages.",
      act: "finale",
      archetype: "custom",
      content: <SharePanel dataset={dataset} media={media} />,
    },
  ];
}

interface DashboardProps {
  dataset: Dataset;
  media: MediaResolver | null;
  /** Re-ingest handler; omitted when the platform can't refresh in place. */
  onRefresh?: () => void;
  onDisconnect: () => void;
  /** Platform slide filter; every slide is shown when omitted. */
  supportsSlide?: (slideId: string) => boolean;
}

/**
 * Presents every registered stat as a story column — one section per stat,
 * scrolled vertically or jumped to from the rail. Each stat module
 * computes and renders itself; the dashboard only frames them. Nothing here
 * talks to Telegram except the on-demand media/avatar downloads.
 */
export function Dashboard({
  dataset,
  media,
  onRefresh,
  onDisconnect,
  supportsSlide,
}: DashboardProps) {
  // Memoized so navigation re-renders only the frame — re-rendering every
  // mounted slide per index change recomputes all stats and stalls scrolling.
  const slides = useMemo(
    () => buildSlides(dataset, media, supportsSlide ?? (() => true)),
    [dataset, media, supportsSlide],
  );

  return (
    <AvatarProvider media={media}>
      <HitPreviewProvider media={media}>
        <StoryColumn slides={slides}>
          <div class="dashboard-head">
            <h2>Your Telegram, rewound</h2>
            <div class="head-actions">
              <ThemeToggle />
              <button
                type="button"
                class="btn-secondary btn-icon"
                title="Share your year"
                aria-label="Share your year"
                onClick={() =>
                  document.getElementById("share")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                <ShareIcon />
              </button>
              {onRefresh && (
                <button
                  type="button"
                  class="btn-secondary btn-icon"
                  title="Refresh data — re-read your chat history"
                  aria-label="Refresh data"
                  onClick={onRefresh}
                >
                  <RefreshIcon />
                </button>
              )}
              <button
                type="button"
                class="btn-secondary btn-icon"
                title="Disconnect — forget this browser's data and session"
                aria-label="Disconnect"
                onClick={onDisconnect}
              >
                <LogoutIcon />
              </button>
            </div>
          </div>

          <p class="muted">
            {dataset.meta.messageCount.toLocaleString()} messages analyzed on
            your device{dataset.meta.partial ? " (partial history)" : ""},
            fetched{" "}
            {formatRelativeDays(
              Math.floor((Date.now() - dataset.meta.fetchedAt) / DAY_MS),
            )}
            . Nothing was uploaded.
          </p>
        </StoryColumn>
      </HitPreviewProvider>
    </AvatarProvider>
  );
}
