import type { FunctionComponent } from "preact";

import { REPO_URL } from "../links";
import { defineStat } from "./registry";
import { humanizeSeconds } from "./shared/formatDuration";
import { PeerRows } from "./shared/PeerRows";
import { Beat } from "./shared/reveal";
import {
  computeResponseTimes,
  type ResponseTimesResult,
} from "./responseTimesCompute";

/** Ignored conversation attempts, both directions (see METHODOLOGY.md);
 * shares the session-based computation with the response-times slides. */

const Card: FunctionComponent<{ result: ResponseTimesResult }> = ({
  result,
}) => {
  if (result.theyGhost.length === 0 && result.youGhost.length === 0) {
    return (
      <p class="muted">
        Nobody's ghosting anybody — every conversation attempt eventually got an
        answer. Healthy!
      </p>
    );
  }
  const coarse = result.minuteGranularity;
  return (
    <div class="response-times">
      <Beat step={0}>
        <PeerRows
          heading="Ghosting you"
          rows={result.theyGhost}
          detail={(chat) =>
            `ignored ${chat.ignoredAttempts} of your ${chat.attempts} conversation attempts · ` +
            `usually replies in ${humanizeSeconds(chat.medianReplySeconds, coarse)}`
          }
        />
      </Beat>
      <Beat step={1}>
        <PeerRows
          heading="Ghosted by you"
          rows={result.youGhost}
          detail={(chat) =>
            `you ignored ${chat.ignoredAttempts} of their ${chat.attempts} attempts · ` +
            `you usually reply in ${humanizeSeconds(chat.medianReplySeconds, coarse)}`
          }
        />
      </Beat>
      <Beat step={2}>
        <p class="muted hint">
          An attempt counts as ignored only when the silent side never
          engaged, not even later —{" "}
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

export const leftOnRead = defineStat<ResponseTimesResult>({
  id: "left-on-read",
  title: "Ghosted",
  icon: "👻",
  description: "Conversation attempts that never got an answer — both ways.",
  compute: computeResponseTimes,
  Card,
});
