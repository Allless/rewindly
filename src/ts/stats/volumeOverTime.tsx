import type { FunctionComponent } from "preact";

import { bucketByMonth } from "./shared/time";
import { formatMonth } from "./shared/formatDate";
import { defineStat } from "./registry";
import { Beat, CountUp, Hero } from "./shared/reveal";
import type { Dataset } from "../model/types";

export interface MonthlyVolume {
  period: string; // "YYYY-MM"
  sent: number;
  received: number;
  total: number;
}

export interface VolumeOverTimeResult {
  monthly: MonthlyVolume[];
  totalSent: number;
  totalReceived: number;
  /** Words are style-neutral where message counts aren't — splitting one
   * thought into five bubbles inflates messages, not words. */
  wordsSent: number;
  wordsReceived: number;
}

function compute(dataset: Dataset): VolumeOverTimeResult {
  // Groups/channels only contain your own messages (ingestion filters them to
  // "me"), so counting them would skew the sent/received picture — DMs only.
  const dmMessages = dataset.messages.filter((message) => {
    const type = dataset.chats[message.chatId]?.type;
    return type === undefined || type === "private";
  });
  const buckets = bucketByMonth(dmMessages, dataset.meta.timezone);

  const monthly = [...buckets.entries()]
    .map(([period, messages]) => {
      const sent = messages.filter((m) => m.direction === "sent").length;
      const received = messages.length - sent;
      return {
        period,
        sent,
        received,
        total: messages.length,
      } satisfies MonthlyVolume;
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  const totalSent = monthly.reduce((sum, m) => sum + m.sent, 0);
  const totalReceived = monthly.reduce((sum, m) => sum + m.received, 0);
  let wordsSent = 0;
  let wordsReceived = 0;
  for (const m of dmMessages) {
    if (m.direction === "sent") wordsSent += m.wordCount;
    else wordsReceived += m.wordCount;
  }

  return { monthly, totalSent, totalReceived, wordsSent, wordsReceived };
}

const Card: FunctionComponent<{ result: VolumeOverTimeResult }> = ({
  result,
}) => {
  const peak = result.monthly.reduce((max, m) => Math.max(max, m.total), 0);
  const firstMonth = result.monthly[0]?.period;

  return (
    <div class="volume">
      <Beat step={0} class="beat-hook">
        {firstMonth ? `Since ${formatMonth(firstMonth)}…` : "So far…"}
      </Beat>
      <Hero
        value={<CountUp value={result.totalSent + result.totalReceived} />}
        label="messages exchanged"
      />
      <Beat step={2}>
        <p class="stat-summary">
          {result.totalSent.toLocaleString()} sent ·{" "}
          {result.totalReceived.toLocaleString()} received
          <span class="muted">
            {" "}
            — {result.wordsSent.toLocaleString()} vs{" "}
            {result.wordsReceived.toLocaleString()} words
          </span>
        </p>
      </Beat>
      <Beat step={3}>
        <ul class="volume-bars">
          {result.monthly.map((m) => (
            <li class="volume-row" key={m.period}>
              <span class="volume-label">{formatMonth(m.period)}</span>
              <span class="volume-track">
                <span
                  class="volume-fill"
                  style={{
                    width: peak === 0 ? "0%" : `${(m.total / peak) * 100}%`,
                  }}
                />
              </span>
              <span class="volume-count muted">{m.total}</span>
            </li>
          ))}
        </ul>
      </Beat>
    </div>
  );
};

export const volumeOverTime = defineStat<VolumeOverTimeResult>({
  id: "volume-over-time",
  title: "How much you talked",
  icon: "💬",
  description: "How many DM messages you sent and received each month.",
  compute,
  Card,
});
