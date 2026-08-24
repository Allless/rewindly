/**
 * Staged reveals ("beats"): a hook line first, then the hero fact, then
 * supporting detail — the Wrapped card grammar, but reader-paced. Inside a
 * live story column every beat watches for its own entry into the viewport
 * and fades in there, so the page reads as one continuous stream the scroll
 * pulls forward, not per-slide choreography that pops on arrival. `step`
 * staggers beats that enter together.
 *
 * `settled` cuts the choreography short: the column flips it when the reader
 * taps the section or scrolls away mid-reveal, snapping every beat (and
 * count-up) to its end state — a half-played reveal reads as broken, and a
 * reader who taps has already voted against waiting.
 *
 * The default context is not live and settled, so cards render in their
 * final state wherever there is no story column (tests, standalone renders).
 */

import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import type { ComponentChildren, CSSProperties, RefObject } from "preact";

export interface RevealState {
  /** Inside a live story column — beats animate on their own viewport entry. */
  live: boolean;
  /** Snap to the end state: tapped, revisited, or no column at all. */
  settled: boolean;
}

export const RevealContext = createContext<RevealState>({
  live: false,
  settled: true,
});

export function useReveal(): RevealState {
  return useContext(RevealContext);
}

/* One shared observer for every beat on the page. An element is "seen" the
 * first time it crosses into the lower-margin band, then unobserved — the
 * reveal never rewinds. */
let sharedObserver: IntersectionObserver | null = null;
const onSeen = new WeakMap<Element, () => void>();

function observeEntry(el: Element, callback: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    callback();
    return () => undefined;
  }
  sharedObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        sharedObserver?.unobserve(entry.target);
        const seen = onSeen.get(entry.target);
        onSeen.delete(entry.target);
        seen?.();
      }
    },
    // A beat lights up once it clears the bottom ~10% of the viewport.
    { rootMargin: "0px 0px -10% 0px", threshold: 0 },
  );
  onSeen.set(el, callback);
  sharedObserver.observe(el);
  return () => {
    onSeen.delete(el);
    sharedObserver?.unobserve(el);
  };
}

/**
 * True once the referenced element has entered the viewport. While `active`
 * is false (settled slides, static renders) it reports seen immediately, so
 * content never hides without a reveal coming.
 */
export function useInViewOnce<T extends HTMLElement>(
  active: boolean,
): { ref: RefObject<T>; seen: boolean } {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!active || seen) return;
    const el = ref.current;
    if (!el) {
      setSeen(true);
      return;
    }
    return observeEntry(el, () => setSeen(true));
  }, [active, seen]);
  return { ref, seen: seen || !active };
}

/** Delay between narrative beats. The reader owns the scroll pace, so the
 * choreography must resolve fast — everything lands within ~a second. */
export const BEAT_UNIT_MS = 200;

export function beatStyle(
  step: number,
  unitMs: number = BEAT_UNIT_MS,
): CSSProperties {
  return { "--beat-delay": `${Math.round(step * unitMs)}ms` };
}

/** One reveal stage: fades in when it scrolls into view, `step` delay units
 * after its siblings. All motion lives in CSS behind prefers-reduced-motion. */
export function Beat({
  step,
  unitMs,
  class: cls,
  children,
}: {
  step: number;
  unitMs?: number;
  class?: string;
  children: ComponentChildren;
}) {
  const { live, settled } = useReveal();
  const animate = live && !settled;
  const { ref, seen } = useInViewOnce<HTMLDivElement>(animate);
  return (
    <div
      ref={ref}
      class={`beat${seen ? " beat-in" : ""}${animate ? "" : " beat-settled"}${cls ? ` ${cls}` : ""}`}
      style={beatStyle(step, unitMs)}
    >
      {children}
    </div>
  );
}

/** The one number/name a slide is about, oversized. Defaults to beat 1 —
 * right after the hook line. */
export function Hero({
  step = 1,
  value,
  label,
}: {
  step?: number;
  value: ComponentChildren;
  label: ComponentChildren;
}) {
  return (
    <Beat step={step} class="beat-hero">
      <span class="hero-value">{value}</span>
      <span class="hero-label">{label}</span>
    </Beat>
  );
}

/**
 * Animates a number from zero when it scrolls into view. Wherever the reveal
 * is inactive (no story column, a settled or revisited slide, reduced
 * motion) it shows the final value immediately, so shares, tests, and
 * revisits never display a zero.
 */
export function CountUp({
  value,
  delayMs = BEAT_UNIT_MS,
  durationMs = 1100,
  format = (n) => Math.round(n).toLocaleString(),
}: {
  value: number;
  /** Matched to the host beat's delay so the count starts as it fades in. */
  delayMs?: number;
  durationMs?: number;
  format?: (n: number) => string;
}) {
  const { live, settled } = useReveal();
  const animate = live && !settled;
  const { ref, seen } = useInViewOnce<HTMLSpanElement>(animate);
  const played = useRef(false);
  const [display, setDisplay] = useState(() => (animate ? 0 : value));

  useEffect(() => {
    if (!animate || played.current) {
      setDisplay(value);
      return;
    }
    if (!seen) return;
    played.current = true;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const start = performance.now() + delayMs;
    let raf = requestAnimationFrame(function tick(now: number) {
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      setDisplay(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [animate, seen, value, delayMs, durationMs]);

  return <span ref={ref}>{format(display)}</span>;
}
