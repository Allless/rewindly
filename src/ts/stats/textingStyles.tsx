import type { FunctionComponent } from "preact";

import { REPO_URL } from "../links";
import { defineStat } from "./registry";
import { PeerRows } from "./shared/PeerRows";
import { Beat } from "./shared/reveal";
import {
  computeTextingStyles,
  type TextingStylesResult,
} from "./textingStylesCompute";

/** "You write letters, they write bursts" — style, separated from volume. */

const Card: FunctionComponent<{ result: TextingStylesResult }> = ({
  result,
}) => {
  if (result.you.turns === 0 && result.them.turns === 0) {
    return <p class="muted">Not enough DM conversation to tell yet.</p>;
  }
  const tile = (label: string, side: TextingStylesResult["you"]) => (
    <div class="response-median">
      <span class="value">
        {side.turns > 0 ? (side.messages / side.turns).toFixed(1) : "—"}
      </span>
      <span class="label">
        {label}: messages per burst — avg{" "}
        {side.messages > 0 ? Math.round(side.chars / side.messages) : 0} chars,{" "}
        {side.words.toLocaleString()} words total
      </span>
    </div>
  );
  return (
    <div class="response-times">
      <Beat step={0}>
        <div class="response-medians">
          {tile("you", result.you)}
          {tile("them", result.them)}
        </div>
      </Beat>
      <Beat step={1}>
        <PeerRows
          heading="Death by a thousand texts"
          rows={result.splitters}
          detail={(chat) =>
            `${chat.messagesPerTurn.toFixed(1)} messages per burst · ` +
            `${Math.round(chat.charsPerMessage)} chars each`
          }
        />
      </Beat>
      <Beat step={2}>
        <PeerRows
          heading="Wall of text award"
          rows={result.essayists}
          detail={(chat) =>
            `${Math.round(chat.charsPerMessage)} characters per message on average`
          }
        />
      </Beat>
      <Beat step={3}>
        <p class="muted hint">
          A burst is a run of consecutive messages within one conversation —{" "}
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

export const textingStyles = defineStat<TextingStylesResult>({
  id: "texting-styles",
  title: "How you text",
  icon: "✍️",
  description: "Letters or bursts? How you and your people write.",
  compute: computeTextingStyles,
  Card,
});
