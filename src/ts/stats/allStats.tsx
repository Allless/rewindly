/**
 * The populated stat registry. This is the only place that imports every stat
 * module, keeping `registry.tsx` (which the modules import from) free of module
 * imports and therefore acyclic.
 */

import { register } from "./registry";
import { activityHeatmap } from "./activityHeatmap";
import { emojiCulture } from "./emojiCulture";
import { ghostedChats } from "./ghostedChats";
import { nightOwls } from "./nightOwls";
import { greatestHits } from "./greatestHits";
import { responseTimes } from "./responseTimes";
import { streaks } from "./streaks";
import { topDms, topGroups } from "./topContacts";
import { volumeOverTime } from "./volumeOverTime";
import { whoTextsFirst } from "./whoTextsFirst";
import { leftOnRead } from "./leftOnRead";
import { textingStyles } from "./textingStyles";
import { trophyShelf } from "./trophyShelf";

import type { RegisteredStat } from "./registry";

/**
 * The ordered story the dashboard tells, in five acts: how much you talked →
 * your people → the dynamics between you → your quirks → the finale. Each
 * slide maps onto a layout archetype (see `SlideArchetype`); the sticker/GIF
 * slides are spliced into the quirks act by the dashboard (they need a media
 * resolver), and Share closes the finale.
 */
export const STAT_REGISTRY: RegisteredStat[] = [
  register(volumeOverTime, { act: "volume", archetype: "hero" }),
  register(activityHeatmap, { act: "volume", archetype: "field" }),
  register(topDms, { act: "people", archetype: "ledger" }),
  register(topGroups, { act: "people", archetype: "ledger" }),
  register(streaks, { act: "people", archetype: "hero" }),
  register(responseTimes, { act: "dynamics", archetype: "ledger" }),
  register(whoTextsFirst, { act: "dynamics", archetype: "ledger" }),
  register(leftOnRead, { act: "dynamics", archetype: "ledger" }),
  register(ghostedChats, { act: "dynamics", archetype: "ledger" }),
  register(nightOwls, { act: "dynamics", archetype: "split", hero: true }),
  register(textingStyles, { act: "quirks", archetype: "ledger" }),
  register(emojiCulture, { act: "quirks", archetype: "split" }),
  register(greatestHits, { act: "quirks", archetype: "gallery" }),
  register(trophyShelf, { act: "finale", archetype: "field" }),
];
