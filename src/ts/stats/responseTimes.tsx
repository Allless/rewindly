import type { FunctionComponent } from "preact";

import { REPO_URL } from "../links";
import { defineStat } from "./registry";
import { humanizeSeconds } from "./shared/formatDuration";
import { PeerRows } from "./shared/PeerRows";
import { Beat, Hero } from "./shared/reveal";
import {
  computeResponseTimes,
  type ResponseTimesResult,
} from "./responseTimesCompute";

export type {
  GhostRank,
  PerChatResponseTime,
  ResponseTimesResult,
} from "./responseTimesCompute";

const Card: FunctionComponent<{ result: ResponseTimesResult }> = ({
  result,
}) => {
  return (
    <div class="response-times">
      <Beat step={0} class="beat-hook">
        When a conversation is live, you answer in…
      </Beat>
      <Hero
        value={humanizeSeconds(
          result.yourMedianSeconds,
          result.minuteGranularity,
        )}
        label="your median reply"
      />
      <Beat step={2}>
        <div class="response-medians">
          <div class="response-median">
            <span class="value">
              {humanizeSeconds(
                result.theirMedianSeconds,
                result.minuteGranularity,
              )}
            </span>
            <span class="label">their median reply</span>
          </div>
        </div>
      </Beat>
      {result.perChat.length > 1 && (
        <>
          <Beat step={3}>
            <PeerRows
              heading="Fastest to reply to you"
              rows={result.theyReplyFastest}
              detail={(chat) =>
                `replies in ${humanizeSeconds(chat.theirMedianSeconds, result.minuteGranularity)} · ` +
                `${chat.theirReplies.toLocaleString()} replies`
              }
            />
          </Beat>
          <Beat step={4}>
            <PeerRows
              heading="You reply fastest to"
              rows={result.youReplyFastest}
              detail={(chat) =>
                `you reply in ${humanizeSeconds(chat.yourMedianSeconds, result.minuteGranularity)} · ` +
                `${chat.yourReplies.toLocaleString()} replies`
              }
            />
          </Beat>
        </>
      )}
      <p class="muted hint">
        Median of replies within a conversation session —{" "}
        <a
          href={`${REPO_URL}/blob/main/METHODOLOGY.md`}
          target="_blank"
          rel="noopener noreferrer"
        >
          methodology
        </a>
        .
      </p>
    </div>
  );
};

export const responseTimes = defineStat<ResponseTimesResult>({
  id: "response-times",
  title: "How fast you reply",
  icon: "⚡",
  description: "How fast you both reply when a conversation is live.",
  compute: computeResponseTimes,
  Card,
});
