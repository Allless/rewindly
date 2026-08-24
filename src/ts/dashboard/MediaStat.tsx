import { useContext, useEffect, useState } from "preact/hooks";

import { topMediaByType } from "../stats/topMedia";
import { getMediaPreview } from "../media/downloadMedia";
import { enqueueFetch } from "../media/fetchQueue";
import { SlidePriorityContext } from "../media/slidePriority";
import { beatStyle, useInViewOnce, useReveal } from "../stats/shared/reveal";

import type { MediaResolver, MediaPreview } from "../media/downloadMedia";
import type { Dataset, MediaType } from "../model/types";

const TOP = 20;
/** Grid items stagger fast — a wall of thumbnails, not a narrative. */
const MEDIA_STAGGER_MS = 60;

interface MediaStatProps {
  dataset: Dataset;
  media: MediaResolver | null;
  mediaType: MediaType;
  emptyLabel: string;
}

/**
 * Ranks the top sticker/gif documents (pure) and resolves their previews —
 * from the persisted blob store or a live download — rendering images in an
 * <img> and mp4/webm clips in a looping <video>. A cache-restored session
 * shows whatever was downloaded before; anything else stays a placeholder.
 */
export function MediaStat({
  dataset,
  media,
  mediaType,
  emptyLabel,
}: MediaStatProps) {
  const items = topMediaByType(dataset, mediaType, TOP);
  const priority = useContext(SlidePriorityContext);
  const [previews, setPreviews] = useState<Record<string, MediaPreview | null>>(
    {},
  );
  const { live, settled } = useReveal();
  const animate = live && !settled;
  // Observe the list itself, not the images — previews load async and the
  // reveal must not wait on them.
  const { ref, seen } = useInViewOnce<HTMLUListElement>(animate);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    // A message carrying each document, for on-demand ref recovery when the
    // session-only ref map is empty (cache-restored) or references expired.
    const messageByMedia = new Map<string, string>();
    for (const message of dataset.messages) {
      if (message.mediaId && !messageByMedia.has(message.mediaId)) {
        messageByMedia.set(message.mediaId, message.id);
      }
    }

    void (async () => {
      for (const { mediaId } of topMediaByType(dataset, mediaType, TOP)) {
        const preview = await enqueueFetch(priority, () =>
          getMediaPreview(media, mediaId, messageByMedia.get(mediaId)),
        );
        if (cancelled) {
          if (preview) URL.revokeObjectURL(preview.url);
          return;
        }
        if (preview) created.push(preview.url);
        setPreviews((prev) => ({ ...prev, [mediaId]: preview }));
      }
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [dataset, media, mediaType, priority]);

  if (items.length === 0) {
    return <p class="muted">{emptyLabel}</p>;
  }

  return (
    <ul class="media-grid" ref={ref}>
      {items.map(({ mediaId, count }, i) => {
        const preview = previews[mediaId];
        return (
          <li
            key={mediaId}
            class={`media-item beat${seen ? " beat-in" : ""}${animate ? "" : " beat-settled"}`}
            style={beatStyle(i, MEDIA_STAGGER_MS)}
          >
            {preview ? (
              preview.video ? (
                <video
                  class="media-img"
                  src={preview.url}
                  autoplay
                  loop
                  muted
                  playsinline
                  onError={() =>
                    // Codec unsupported (e.g. WebM on older Safari) — show
                    // the placeholder rather than a dead player.
                    setPreviews((prev) => ({ ...prev, [mediaId]: null }))
                  }
                />
              ) : (
                <img
                  class="media-img"
                  src={preview.url}
                  alt=""
                  loading="lazy"
                />
              )
            ) : (
              <span class="media-placeholder" aria-hidden="true" />
            )}
            <span class="media-count muted">{count}×</span>
          </li>
        );
      })}
    </ul>
  );
}
