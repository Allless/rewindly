import type { FunctionComponent } from "preact";

import { defineStat } from "./registry";
import { isNoiseChat } from "./shared/chatFilters";
import { PeerRows } from "./shared/PeerRows";
import { Beat, CountUp, Hero } from "./shared/reveal";
import { hourOfWeek } from "./shared/time";

import type { Dataset } from "../model/types";

/*
 * Who you talk to after dark. Ranking by a *share* of messages in a window
 * rather than an average hour: hours wrap around midnight, so a mean over
 * 23:00 and 01:00 lands at noon — exactly wrong. Windows are in the
 * dataset's timezone, direct chats only.
 */

/* The 4–5am hour deliberately counts for neither list: an all-nighter
 * spilling past 4 is not a morning person, and discarding the ambiguous
 * hour beats misassigning it. */
const NIGHT_FROM = 0;
const NIGHT_TO = 4; // exclusive
const MORNING_FROM = 5;
const MORNING_TO = 8;
/*
 * Ranking by share needs a credible denominator: 100% of 8 messages would
 * otherwise beat 45% of 500 and the list would fill with your quietest
 * chats. Chats below the floor that are *entirely* nocturnal get their own
 * list instead, where the small count is the point.
 */
const MIN_MESSAGES = 50;
const MIN_NIGHT_MESSAGES = 10;
const AFTER_DARK_MIN = 4;
const AFTER_DARK_SHARE = 0.9;
const LIMIT = 5;

export interface DayPartRank {
  chatId: string;
  title: string;
  username?: string;
  share: number; // 0..1 of that chat's messages inside the window
  messages: number;
  /** Only set on the after-dark-only list, where the count is the story. */
  nightMessages?: number;
}

export interface NightOwlsResult {
  nightOwls: DayPartRank[];
  earlyBirds: DayPartRank[];
  /** Small chats that happen (almost) only at night — a different story. */
  afterDarkOnly: DayPartRank[];
  /** Your own share of messages sent after dark. */
  yourNightShare: number | null;
}

function compute(dataset: Dataset): NightOwlsResult {
  const tz = dataset.meta.timezone;
  const perChat = new Map<
    string,
    { messages: number; night: number; morning: number }
  >();
  let yourTotal = 0;
  let yourNight = 0;

  for (const message of dataset.messages) {
    const hour = hourOfWeek(message.timestamp, tz) % 24;
    const isNight = hour >= NIGHT_FROM && hour < NIGHT_TO;
    const isMorning = hour >= MORNING_FROM && hour < MORNING_TO;

    if (message.direction === "sent") {
      yourTotal += 1;
      if (isNight) yourNight += 1;
    }

    const chat = dataset.chats[message.chatId];
    if (isNoiseChat(dataset, message.chatId)) continue;
    if (chat !== undefined && chat.type !== "private") continue;
    const entry = perChat.get(message.chatId) ?? {
      messages: 0,
      night: 0,
      morning: 0,
    };
    entry.messages += 1;
    if (isNight) entry.night += 1;
    if (isMorning) entry.morning += 1;
    perChat.set(message.chatId, entry);
  }

  const all = [...perChat.entries()].map(([chatId, e]) => ({
    chatId,
    title: dataset.chats[chatId]?.title ?? chatId,
    username: dataset.chats[chatId]?.username,
    messages: e.messages,
    night: e.night / e.messages,
    nightMessages: e.night,
    morning: e.morning / e.messages,
  }));

  const ranks = [...perChat.entries()]
    .filter(([, e]) => e.messages >= MIN_MESSAGES)
    .map(([chatId, e]) => ({
      chatId,
      title: dataset.chats[chatId]?.title ?? chatId,
      username: dataset.chats[chatId]?.username,
      messages: e.messages,
      night: e.night / e.messages,
      morning: e.morning / e.messages,
    }));

  const top = (key: "night" | "morning"): DayPartRank[] =>
    ranks
      .filter((r) =>
        key === "night"
          ? r.night * r.messages >= MIN_NIGHT_MESSAGES
          : r[key] > 0,
      )
      .sort((a, b) => b[key] - a[key] || b.messages - a.messages)
      .slice(0, LIMIT)
      .map(({ chatId, title, username, messages }) => ({
        chatId,
        title,
        username,
        messages,
        share: ranks.find((r) => r.chatId === chatId)?.[key] ?? 0,
      }));

  const afterDarkOnly = all
    .filter(
      (r) =>
        r.messages < MIN_MESSAGES &&
        r.messages >= AFTER_DARK_MIN &&
        r.night >= AFTER_DARK_SHARE,
    )
    .sort((a, b) => b.night - a.night || b.messages - a.messages)
    .slice(0, LIMIT)
    .map(({ chatId, title, username, messages, night, nightMessages }) => ({
      chatId,
      title,
      username,
      messages,
      share: night,
      nightMessages,
    }));

  return {
    nightOwls: top("night"),
    earlyBirds: top("morning"),
    afterDarkOnly,
    yourNightShare: yourTotal > 0 ? yourNight / yourTotal : null,
  };
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

const Card: FunctionComponent<{ result: NightOwlsResult }> = ({ result }) => {
  if (
    result.nightOwls.length === 0 &&
    result.earlyBirds.length === 0 &&
    result.afterDarkOnly.length === 0
  ) {
    return <p class="muted">Not enough messages in one chat to tell yet.</p>;
  }
  return (
    <div class="response-times">
      {result.yourNightShare !== null && (
        <>
          <Beat step={0} class="beat-hook">
            While everyone else sleeps — or is only just waking up…
          </Beat>
          <Hero
            value={
              <CountUp
                value={result.yourNightShare * 100}
                format={(n) => `${Math.round(n)}%`}
              />
            }
            label="of your messages go out between midnight and 4am"
          />
        </>
      )}
      <Beat step={2}>
        <PeerRows
          heading="Your 3am club"
          rows={result.nightOwls}
          detail={(chat) =>
            `${percent(chat.share)} of your ${chat.messages.toLocaleString()} messages after midnight`
          }
        />
      </Beat>
      <Beat step={3}>
        <PeerRows
          heading="Only ever after dark"
          rows={result.afterDarkOnly}
          detail={(chat) =>
            `${chat.nightMessages ?? 0} of ${chat.messages} messages, all after midnight`
          }
        />
      </Beat>
      {result.earlyBirds.length > 0 && (
        <Beat step={4}>
          <PeerRows
            heading="Morning people"
            rows={result.earlyBirds}
            detail={(chat) =>
              `${percent(chat.share)} of your ${chat.messages.toLocaleString()} messages before 8am`
            }
          />
        </Beat>
      )}
    </div>
  );
};

export const nightOwls = defineStat<NightOwlsResult>({
  id: "night-owls",
  title: "Night owls",
  icon: "🦉",
  description: "Who you talk to after dark — and who catches you at dawn.",
  compute,
  Card,
});
