import type { FunctionComponent } from "preact";

import { REPO_URL } from "../links";
import { defineStat } from "./registry";
import { PeerRows } from "./shared/PeerRows";
import { Beat, CountUp, Hero } from "./shared/reveal";
import {
  computeResponseTimes,
  type InitiationRank,
  type ResponseTimesResult,
} from "./responseTimesCompute";

/** Initiation share and per-chat leaders (see METHODOLOGY.md); shares the
 * session-based computation with the response-times slides. */

const conversations = (chat: InitiationRank) =>
  chat.yourStarts + chat.theirStarts;

const Card: FunctionComponent<{ result: ResponseTimesResult }> = ({
  result,
}) => {
  const total = result.initiations
    ? result.initiations.yours + result.initiations.theirs
    : 0;
  if (total === 0) {
    return <p class="muted">Not enough conversations to tell yet.</p>;
  }
  return (
    <div class="response-times">
      {result.initiations && (
        <Hero
          value={
            <CountUp
              value={(result.initiations.yours / total) * 100}
              format={(n) => `${Math.round(n)}%`}
            />
          }
          label={
            <>
              conversations started by you — you{" "}
              {result.initiations.yours.toLocaleString()} · them{" "}
              {result.initiations.theirs.toLocaleString()}, across all your DMs
            </>
          }
        />
      )}
      <Beat step={2}>
        <PeerRows
          heading="You always text first"
          rows={result.youStartMost}
          detail={(chat) =>
            `you start ${chat.yourStarts} of ${conversations(chat)} conversations`
          }
        />
      </Beat>
      <Beat step={3}>
        <PeerRows
          heading="They text you first"
          rows={result.theyStartMost}
          detail={(chat) =>
            `they start ${chat.theirStarts} of ${conversations(chat)} conversations`
          }
        />
      </Beat>
      <Beat step={4}>
        <p class="muted hint">
          Counted per conversation session —{" "}
          <a
            href={`${REPO_URL}/blob/main/METHODOLOGY.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            methodology
          </a>
          .
        </p>
      </Beat>
    </div>
  );
};

export const whoTextsFirst = defineStat<ResponseTimesResult>({
  id: "who-texts-first",
  title: "Who texts first?",
  icon: "👋",
  description: "Who makes your conversations happen.",
  compute: computeResponseTimes,
  Card,
});
