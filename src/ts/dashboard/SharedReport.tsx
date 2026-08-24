import { activityHeatmap } from "../stats/activityHeatmap";
import { emojiCulture } from "../stats/emojiCulture";
import { emojiFrequency } from "../stats/emojiFrequency";
import { ghostedChats } from "../stats/ghostedChats";
import { nightOwls } from "../stats/nightOwls";
import { greatestHits, MEDIA_LABELS } from "../stats/greatestHits";
import { leftOnRead } from "../stats/leftOnRead";
import { reactions } from "../stats/reactions";
import { responseTimes } from "../stats/responseTimes";
import { streaks } from "../stats/streaks";
import { textingStyles } from "../stats/textingStyles";
import { topDms, topGroups } from "../stats/topContacts";
import { trophyShelf } from "../stats/trophyShelf";
import { volumeOverTime } from "../stats/volumeOverTime";
import { whoTextsFirst } from "../stats/whoTextsFirst";
import { STAT_REGISTRY } from "../stats/allStats";
import { AvatarContext, PeerAvatar } from "../media/avatars";
import { withEmojiPresentation } from "../stats/shared/emoji";
import { StoryColumn, type Slide } from "./StoryColumn";
import RewindGlyph from "../../rewind.svg?react";

import type { ComponentChildren } from "preact";
import type { SlideArchetype } from "../stats/registry";
import type { SharedSummary, SharedTopMedia } from "../share/summary";

function TopMediaRow({
  heading,
  total,
  top,
}: {
  heading: string;
  total: number;
  top: SharedTopMedia[];
}) {
  return (
    <div class="response-section">
      <h4>
        {heading} · {total.toLocaleString()} sent
      </h4>
      {top.length > 0 && (
        <ul class="media-grid">
          {top.map((item, i) => (
            <li key={i} class="media-item">
              {item.thumb ? (
                <img class="media-img" src={item.thumb} alt="" />
              ) : (
                <span class="media-placeholder" aria-hidden="true" />
              )}
              <span class="media-count muted">{item.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Read-only view of a shared summary, rendered as the same story column as
 * the dashboard: the stat modules' own Cards, fed results reconstructed from
 * the payload, in the same order with the same titles and icons. Only the sections
 * the sharer included appear. No login required.
 */
export function SharedReport({
  summary,
  onMakeYourOwn,
}: {
  summary: SharedSummary;
  onMakeYourOwn: () => void;
}) {
  const slides: Slide[] = [];
  // Stat modules don't carry story placement; the registry (the curation
  // source) does, so shares group into the same acts as the dashboard.
  const placements = new Map(STAT_REGISTRY.map((stat) => [stat.id, stat]));
  const add = (
    stat: {
      id: string;
      title: string;
      icon: string;
      description: string;
      act?: string;
      archetype?: SlideArchetype;
    },
    content: ComponentChildren,
  ) => {
    const placed = placements.get(stat.id);
    slides.push({
      id: stat.id,
      title: stat.title,
      icon: stat.icon,
      description: stat.description,
      act: stat.act ?? placed?.act,
      archetype: stat.archetype ?? placed?.archetype,
      hero: placed?.hero,
      content,
    });
  };

  if (summary.topChatMessages !== undefined) {
    add(
      {
        id: "headline",
        title: "The year at a glance",
        icon: "✨",
        description: "The headline numbers from this share.",
        act: "volume",
        archetype: "hero",
      },
      <dl class="stat-figures">
        <div>
          <dt>Messages</dt>
          <dd>{summary.messageCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Busiest DM</dt>
          <dd>{summary.topChatMessages.toLocaleString()} msgs</dd>
        </div>
        <div>
          <dt>Top message</dt>
          <dd>
            {summary.topHitReactions ?? 0}×{" "}
            {(summary.topHitEmoji ?? [])
              .slice(0, 3)
              .map(withEmojiPresentation)
              .join("")}
          </dd>
        </div>
        <div>
          <dt>Longest streak</dt>
          <dd>{summary.longestStreakDays ?? 0} days</dd>
        </div>
      </dl>,
    );
  }
  if (summary.volume) {
    add(volumeOverTime, <volumeOverTime.Card result={summary.volume} />);
  }
  if (summary.heatmap) {
    add(activityHeatmap, <activityHeatmap.Card result={summary.heatmap} />);
  }
  if (summary.people && summary.people.chats.length > 0) {
    add(topDms, <topDms.Card result={summary.people} />);
  }
  if (summary.groups && summary.groups.chats.length > 0) {
    add(topGroups, <topGroups.Card result={summary.groups} />);
  }
  if (summary.streaks) {
    add(streaks, <streaks.Card result={summary.streaks} />);
  }
  if (summary.response) {
    const response = summary.response;
    if (
      response.yourMedianSeconds !== null ||
      response.theirMedianSeconds !== null ||
      response.perChat.length > 0
    ) {
      add(responseTimes, <responseTimes.Card result={response} />);
    }
    if (response.initiations) {
      add(whoTextsFirst, <whoTextsFirst.Card result={response} />);
    }
    if (response.theyGhost.length > 0 || response.youGhost.length > 0) {
      add(leftOnRead, <leftOnRead.Card result={response} />);
    }
  } else if (
    summary.yourMedianSeconds !== undefined ||
    summary.theirMedianSeconds !== undefined
  ) {
    // Medians shared without any per-chat section.
    add(
      responseTimes,
      <responseTimes.Card
        result={{
          yourMedianSeconds: summary.yourMedianSeconds ?? null,
          theirMedianSeconds: summary.theirMedianSeconds ?? null,
          initiations: null,
          perChat: [],
          theyReplyFastest: [],
          youReplyFastest: [],
          youStartMost: [],
          theyStartMost: [],
          theyGhost: [],
          youGhost: [],
        }}
      />,
    );
  }
  if (summary.quiet && summary.quiet.chats.length > 0) {
    add(ghostedChats, <ghostedChats.Card result={summary.quiet} />);
  }
  if (summary.nights) {
    add(nightOwls, <nightOwls.Card result={summary.nights} />);
  }
  if (summary.styles) {
    add(textingStyles, <textingStyles.Card result={summary.styles} />);
  }
  // One emoji-culture slide, composed from whichever halves were shared —
  // the merged Card would render "no emoji" copy for a half that simply
  // wasn't included.
  const sharedReactions =
    summary.reactionsGiven !== undefined ||
    summary.reactionsReceived !== undefined
      ? {
          given: summary.reactionsGiven ?? [],
          received: summary.reactionsReceived ?? [],
        }
      : null;
  if (summary.topEmoji || sharedReactions) {
    add(
      emojiCulture,
      <div class="response-times">
        {summary.topEmoji && (
          <div class="response-section">
            <h4>You type with</h4>
            <emojiFrequency.Card result={{ topEmoji: summary.topEmoji }} />
          </div>
        )}
        {sharedReactions && <reactions.Card result={sharedReactions} />}
      </div>,
    );
  }
  if (summary.stickerTotal !== undefined || summary.gifTotal !== undefined) {
    add(
      {
        id: "media-rotation",
        title: "Sticker & GIF rotation",
        icon: "🧩",
        description: "The ones they send most.",
        act: "quirks",
        archetype: "gallery",
      },
      <div class="response-times">
        <TopMediaRow
          heading="Stickers"
          total={summary.stickerTotal ?? 0}
          top={summary.stickerTop ?? []}
        />
        <TopMediaRow
          heading="GIFs"
          total={summary.gifTotal ?? 0}
          top={summary.gifTop ?? []}
        />
      </div>,
    );
  }
  if (summary.hits && summary.hits.length > 0) {
    const hits = summary.hits;
    add(
      greatestHits,
      <ol class="hits">
        {hits.map((hit, i) => (
          <li key={i} class="hit">
            <div class="hit-head">
              <span class="hit-count">{hit.reactionCount}</span>
              <span class="hit-emoji">
                {hit.reactionEmoji.map(withEmojiPresentation).join(" ")}
              </span>
            </div>
            {hit.thumb && <img class="hit-media" src={hit.thumb} alt="" />}
            {hit.text ? (
              <blockquote class="hit-text">{hit.text}</blockquote>
            ) : (
              !hit.thumb && (
                <blockquote class="hit-text muted">
                  {MEDIA_LABELS[hit.mediaType]}
                </blockquote>
              )
            )}
          </li>
        ))}
      </ol>,
    );
  }
  if (summary.trophies && summary.trophies.trophies.length > 0) {
    add(trophyShelf, <trophyShelf.Card result={summary.trophies} />);
  }

  return (
    // Public profile photos load straight from t.me here: there's no session
    // to download with, and these images are already public.
    <AvatarContext.Provider
      value={{ request: () => undefined, urls: {}, publicPhotos: true }}
    >
      <StoryColumn slides={slides}>
        <div class="dashboard-head">
          <h2 class="shared-title">
            <PeerAvatar
              peerId="shared:self"
              title={summary.self.title}
              username={summary.self.username}
            />
            {summary.self.title}&apos;s year, rewound
          </h2>
          <button type="button" class="btn-primary" onClick={onMakeYourOwn}>
            Make your own <RewindGlyph class="btn-glyph" />
          </button>
        </div>

        <p class="muted">
          {summary.self.title} shared their Rewindly year with you —{" "}
          {summary.messageCount.toLocaleString()} messages. Only the sections
          they picked are here.
        </p>
      </StoryColumn>
    </AvatarContext.Provider>
  );
}
