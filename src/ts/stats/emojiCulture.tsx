/**
 * One slide for the whole emoji story: the glyphs you type with, then the
 * reactions you trade. Merges the `emojiFrequency` and `reactions` modules —
 * side by side they read as near-duplicates, together they're one culture.
 * The reaction half hides itself on platforms/datasets without reactions.
 */

import type { FunctionComponent } from "preact";

import { emojiFrequency } from "./emojiFrequency";
import { reactions } from "./reactions";
import { defineStat } from "./registry";
import { Beat } from "./shared/reveal";

import type { EmojiFrequencyResult } from "./emojiFrequency";
import type { ReactionsResult } from "./reactions";
import type { Dataset } from "../model/types";

export interface EmojiCultureResult {
  emoji: EmojiFrequencyResult;
  reactions: ReactionsResult;
}

function compute(dataset: Dataset): EmojiCultureResult {
  return {
    emoji: emojiFrequency.compute(dataset),
    reactions: reactions.compute(dataset),
  };
}

const Card: FunctionComponent<{ result: EmojiCultureResult }> = ({
  result,
}) => {
  const hasReactions =
    result.reactions.given.length > 0 || result.reactions.received.length > 0;
  return (
    <div class="response-times">
      <Beat step={0} class="response-section">
        <h4>You type with</h4>
        <emojiFrequency.Card result={result.emoji} />
      </Beat>
      {hasReactions && (
        <Beat step={1}>
          <reactions.Card result={result.reactions} />
        </Beat>
      )}
    </div>
  );
};

export const emojiCulture = defineStat<EmojiCultureResult>({
  id: "emoji-culture",
  title: "Your emoji fingerprint",
  icon: "😀",
  description: "The emoji you send — and the reactions you trade.",
  compute,
  Card,
});
