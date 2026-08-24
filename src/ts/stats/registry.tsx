/**
 * Stat module contract. Deliberately imports NO stat modules, so the modules
 * can import `defineStat` from here without creating an import cycle. The
 * populated list lives in `allStats.tsx`.
 *
 * Every analytics feature is a pure `compute(dataset)` paired with a `Card`
 * presentation component. `compute` must be pure and synchronous, must derive
 * "now" from `dataset.meta.fetchedAt` (never `Date.now()`) so results are
 * deterministic, and must tolerate empty and partial datasets without throwing.
 *
 * `register()` erases a module's result type behind a single `Render` component.
 * This sidesteps the variance problem of storing `StatModule<SpecificResult>`
 * values in one array (the result type appears in the contravariant `Card`
 * prop, so specific modules are not assignable to a common `StatModule<unknown>`).
 */

import type { FunctionComponent } from "preact";

import type { Dataset } from "../model/types";

export interface StatModule<TResult = unknown> {
  id: string; // stable, kebab-case
  title: string;
  /** One emoji, shown beside the title to make the slide memorable. */
  icon: string;
  description: string;
  compute: (dataset: Dataset) => TResult;
  Card: FunctionComponent<{ result: TResult }>;
}

/**
 * Preserves the type link between a module's `compute` return value and the
 * `result` prop of its `Card`, so registration stays type-safe.
 */
export function defineStat<TResult>(
  module: StatModule<TResult>,
): StatModule<TResult> {
  return module;
}

/**
 * How a slide is composed. Five shared layout shapes instead of per-slide
 * one-offs: the shape sets the section's height, frame, and title treatment;
 * slides stay unique through their content, not bespoke chrome.
 */
export type SlideArchetype =
  /** Big centered number, kicker title, near-viewport height. */
  | "hero"
  /** Left-anchored heading over rows/lists; height mostly content-driven. */
  | "ledger"
  /** Hero beside a supporting chart (stacks on mobile); kicker title. */
  | "split"
  /** Image grid on a soft panel, caption-weight title. */
  | "gallery"
  /** A full-width grid/chart is the subject, on a soft panel. */
  | "field"
  /** Utility screens (share) — panel frame, outside the narrative grammar. */
  | "custom";

/**
 * Where and how a slide sits in the story. Curation data, so it lives with
 * the ordered list in `allStats.tsx`, not inside the stat modules.
 */
export interface StatPlacement {
  /** Narrative act — groups the rail and drives the page's act tint. */
  act: string;
  archetype: SlideArchetype;
  /** The slide leads with a `Hero` numeral — its title becomes a kicker.
   * Implied for "hero" slides; set explicitly on other archetypes. */
  hero?: boolean;
}

/** A stat with its result type erased behind a single `Render` component. */
export interface RegisteredStat {
  id: string;
  title: string;
  icon: string;
  description: string;
  act: string;
  archetype: SlideArchetype;
  hero?: boolean;
  Render: FunctionComponent<{ dataset: Dataset }>;
}

export function register<TResult>(
  module: StatModule<TResult>,
  placement: StatPlacement,
): RegisteredStat {
  const Card = module.Card;
  const Render: FunctionComponent<{ dataset: Dataset }> = ({ dataset }) => (
    <Card result={module.compute(dataset)} />
  );
  return {
    id: module.id,
    title: module.title,
    icon: module.icon,
    description: module.description,
    act: placement.act,
    archetype: placement.archetype,
    hero: placement.hero,
    Render,
  };
}
