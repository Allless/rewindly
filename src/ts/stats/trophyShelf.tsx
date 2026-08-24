import type { FunctionComponent } from "preact";

import { PeerAvatar, PeerName } from "../media/avatars";
import { defineStat } from "./registry";
import { humanizeSeconds } from "./shared/formatDuration";
import { beatStyle, useInViewOnce, useReveal } from "./shared/reveal";
import { ghostedChats } from "./ghostedChats";
import { nightOwls } from "./nightOwls";
import { computeResponseTimes } from "./responseTimesCompute";
import { streaks } from "./streaks";
import { computeTextingStyles } from "./textingStylesCompute";
import { isNoiseChat } from "./shared/chatFilters";
import type { Dataset } from "../model/types";

/*
 * The deck's finale: one trophy per behaviour, one winner each, assembled
 * from the computes the other slides already run (no new metrics here).
 * Awards with no qualifying winner are simply absent.
 */

/** Rows stagger faster than narrative beats — ten awards at the narrative
 * pace would take two seconds to hand out. */
const TROPHY_STAGGER_MS = 80;

interface Trophy {
  award: string;
  chatId: string;
  title: string;
  username?: string;
  detail: string;
}

export interface TrophyShelfResult {
  trophies: Trophy[];
}

function compute(dataset: Dataset): TrophyShelfResult {
  const response = computeResponseTimes(dataset);
  const styles = computeTextingStyles(dataset);
  const trophies: Trophy[] = [];

  const add = (
    award: string,
    source: { chatId: string; title: string; username?: string } | undefined,
    detail: string,
  ) => {
    if (!source) return;
    trophies.push({ award, ...source, detail });
  };

  // Most messages exchanged, DMs only.
  const perChatCounts = new Map<string, number>();
  for (const message of dataset.messages) {
    perChatCounts.set(
      message.chatId,
      (perChatCounts.get(message.chatId) ?? 0) + 1,
    );
  }
  const busiest = Object.values(dataset.chats)
    .filter((chat) => chat.type === "private" && !isNoiseChat(dataset, chat.id))
    .map((chat) => ({
      chatId: chat.id,
      title: chat.title,
      username: chat.username,
      messages: perChatCounts.get(chat.id) ?? 0,
    }))
    .sort((a, b) => b.messages - a.messages)[0];
  if (busiest && busiest.messages > 0) {
    add(
      "Most messaged",
      busiest,
      `${busiest.messages.toLocaleString()} messages exchanged`,
    );
  }

  const fastest = response.theyReplyFastest[0];
  if (fastest?.theirMedianSeconds != null) {
    add(
      "Fastest on the draw",
      fastest,
      `replies in ${humanizeSeconds(fastest.theirMedianSeconds, response.minuteGranularity ?? false)}`,
    );
  }

  add(
    "Wall of text",
    styles.essayists[0],
    styles.essayists[0]
      ? `${Math.round(styles.essayists[0].charsPerMessage)} characters per message`
      : "",
  );

  add(
    "Death by a thousand texts",
    styles.splitters[0],
    styles.splitters[0]
      ? `${styles.splitters[0].messagesPerTurn.toFixed(1)} messages per burst`
      : "",
  );

  add(
    "Always texts first",
    response.theyStartMost[0],
    response.theyStartMost[0]
      ? `starts ${response.theyStartMost[0].theirStarts} of ${
          response.theyStartMost[0].theirStarts +
          response.theyStartMost[0].yourStarts
        } conversations`
      : "",
  );

  const youFastest = response.youReplyFastest[0];
  if (youFastest?.yourMedianSeconds != null) {
    add(
      "You drop everything for",
      youFastest,
      `you answer in ${humanizeSeconds(youFastest.yourMedianSeconds, response.minuteGranularity ?? false)}`,
    );
  }

  const quiet = ghostedChats.compute(dataset).chats[0];
  if (quiet) {
    add(
      "Longest silence",
      quiet,
      `${quiet.daysSinceLast} days since the last message`,
    );
  }

  const nights = nightOwls.compute(dataset);
  const owl = nights.nightOwls[0] ?? nights.afterDarkOnly[0];
  if (owl) {
    add(
      "Your 3am friend",
      owl,
      owl.nightMessages !== undefined
        ? `all ${owl.nightMessages} of your messages after midnight`
        : `${Math.round(owl.share * 100)}% of your messages after midnight`,
    );
  }

  const together = streaks.compute(dataset).perChat[0];
  if (together) {
    add("Never a day apart", together, `${together.days} days in a row`);
  }

  add(
    "Chief ghost",
    response.theyGhost[0],
    response.theyGhost[0]
      ? `ignored ${response.theyGhost[0].ignoredAttempts} of your ${response.theyGhost[0].attempts} attempts`
      : "",
  );

  return { trophies };
}

const Card: FunctionComponent<{ result: TrophyShelfResult }> = ({ result }) => {
  const { live, settled } = useReveal();
  const animate = live && !settled;
  // The shelf reveals as one cascade — one observer on the list, not 15.
  const { ref, seen } = useInViewOnce<HTMLUListElement>(animate);
  if (result.trophies.length === 0) {
    return <p class="muted">Not enough chat history to hand out trophies.</p>;
  }
  return (
    <ul class="trophy-shelf" ref={ref}>
      {result.trophies.map((trophy, i) => (
        <li
          key={trophy.award}
          class={`trophy beat${seen ? " beat-in" : ""}${animate ? "" : " beat-settled"}`}
          style={beatStyle(i, TROPHY_STAGGER_MS)}
        >
          <span class="trophy-award">{trophy.award}</span>
          <span class="trophy-winner">
            <PeerAvatar
              peerId={trophy.chatId}
              title={trophy.title}
              username={trophy.username}
            />
            <PeerName
              class="chat-title"
              peerId={trophy.chatId}
              title={trophy.title}
              username={trophy.username}
            />
          </span>
          <span class="chat-detail">{trophy.detail}</span>
        </li>
      ))}
    </ul>
  );
};

export const trophyShelf = defineStat<TrophyShelfResult>({
  id: "trophy-shelf",
  title: "Trophy shelf",
  icon: "🥇",
  description: "One award per texting habit. Nobody asked for these.",
  compute,
  Card,
});
