import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { focusFetchPriority } from "../media/fetchQueue";
import { SlidePriorityContext } from "../media/slidePriority";
import { RevealContext } from "../stats/shared/reveal";
import { pickCurrent } from "./storyNav";
import { SlideIcon } from "./slideIcons";

import type { ComponentChildren } from "preact";
import type { SlideArchetype } from "../stats/registry";

export interface Slide {
  id: string;
  title: string;
  /** One emoji, shown beside the title and on the rail. */
  icon: string;
  description: string;
  /** Narrative act — groups the rail and drives the page's act tint. */
  act?: string;
  /** Layout shape (see `SlideArchetype`); defaults to "ledger". */
  archetype?: SlideArchetype;
  /** Leads with a `Hero` numeral — the title renders as a kicker. */
  hero?: boolean;
  content: ComponentChildren;
}

/** A slide counts as visited only after it stays near this long — slides
 * merely scrolled past on the way to a farther one keep their reveal. */
const REVEAL_SETTLE_MS = 180;
/** Safety valve: a rail jump whose arrival the observer never confirms
 * (coalesced callbacks) stops suppressing observer updates after this. */
const FLIGHT_TIMEOUT_MS = 1500;

/**
 * The story column: every slide is a section in one vertical scroll — sized
 * by its archetype, from near-viewport hero moments to content-tall data
 * slides — revealing its beats the first time the reader approaches.
 * A zero-height line at the viewport midline decides the current section
 * (for the rail, the spotlight, and media priority); a wider "near" band
 * triggers the beat reveals early. Deliberately no scroll-snap —
 * async media loads would make the browser re-snap under the reader. Used by
 * both the dashboard and the shared-report page so a share looks like the
 * real thing.
 */
export function StoryColumn({
  slides,
  children,
}: {
  slides: Slide[];
  /** Rendered above the column (heading, actions, coverage line). */
  children?: ComponentChildren;
}) {
  const count = slides.length;
  const [current, setCurrent] = useState(0);
  const [near, setNear] = useState<ReadonlySet<number>>(new Set());
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  const [settled, setSettled] = useState<ReadonlySet<number>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  const sections = useRef<(HTMLElement | null)[]>([]);
  const onLine = useRef(new Set<number>());
  const flight = useRef<{ target: number; timer: number } | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const nearRef = useRef(near);
  nearRef.current = near;
  const progressRef = useRef<HTMLDivElement>(null);

  const endFlight = () => {
    if (!flight.current) return;
    clearTimeout(flight.current.timer);
    flight.current = null;
  };

  // The midline observer: a section is a candidate while it touches the
  // viewport's vertical center. During a rail jump, observer updates are
  // suppressed until the target reports in, so the rail doesn't run
  // backwards through every section the jump flies over.
  useEffect(() => {
    onLine.current.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const at = sections.current.indexOf(entry.target as HTMLElement);
          if (at < 0) continue;
          if (entry.isIntersecting) onLine.current.add(at);
          else onLine.current.delete(at);
        }
        const next = pickCurrent(onLine.current, currentRef.current);
        if (flight.current) {
          if (next !== flight.current.target) return;
          endFlight();
        }
        setCurrent(next);
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    for (const el of sections.current.slice(0, count)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [slides, count]);

  // The near observer: a section is "near" once it reaches the middle 70% of
  // the viewport. It drives the beat reveals, so choreography plays while the
  // reader scrolls in — waiting for the midline made every card pop after
  // arrival instead of easing in on approach.
  useEffect(() => {
    setNear(new Set());
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const at = sections.current.indexOf(entry.target as HTMLElement);
            if (at < 0) continue;
            if (entry.isIntersecting) next.add(at);
            else next.delete(at);
          }
          return next;
        });
      },
      { rootMargin: "-15% 0px -15% 0px", threshold: 0 },
    );
    for (const el of sections.current.slice(0, count)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [slides, count]);

  // The reader grabbing the page mid-jump takes control back immediately.
  useEffect(() => {
    const cancel = () => endFlight();
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
    };
  }, []);

  // First approach to a slide plays its beat reveal; revisits show it
  // settled. The timer restarts on every near-set change, so a fling that
  // sweeps sections through the viewport doesn't burn their first reveal.
  useEffect(() => {
    const timer = setTimeout(() => {
      setRevealed((prev) => {
        let next: Set<number> | null = null;
        for (const at of nearRef.current) {
          if (!prev.has(at)) {
            next ??= new Set(prev);
            next.add(at);
          }
        }
        return next ?? prev;
      });
    }, REVEAL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [near]);

  // Leaving a section mid-reveal snaps its beats to their end state — a
  // half-played reveal on scroll-back reads as broken.
  useEffect(() => {
    setSettled((prev) => {
      let next: Set<number> | null = null;
      for (const at of revealed) {
        if (!near.has(at) && !prev.has(at)) {
          next ??= new Set(prev);
          next.add(at);
        }
      }
      return next ?? prev;
    });
  }, [near, revealed]);

  // A tap on the section is a vote against waiting: reveal and settle at once.
  const settleNow = (at: number) => {
    setRevealed((prev) => (prev.has(at) ? prev : new Set(prev).add(at)));
    setSettled((prev) => (prev.has(at) ? prev : new Set(prev).add(at)));
  };

  // The visible slide's pending media downloads jump the queue.
  useEffect(() => {
    focusFetchPriority(current);
  }, [current]);

  const goTo = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(count - 1, target));
      const el = sections.current[clamped];
      if (!el) return;
      endFlight();
      const timer = window.setTimeout(endFlight, FLIGHT_TIMEOUT_MS);
      flight.current = { target: clamped, timer };
      setCurrent(clamped);
      const reduceMotion = matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      el.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      el.focus({ preventScroll: true });
    },
    [count],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        goTo(currentRef.current + 1);
      } else if (event.key === "ArrowLeft") {
        goTo(currentRef.current - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  // Mobile progress hairline: continuous, driven off native scroll without
  // re-rendering — a CSS var on the bar is the only thing that moves.
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      progressRef.current?.style.setProperty(
        "--progress",
        String(max > 0 ? doc.scrollTop / max : 0),
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const railClass = (i: number) =>
    `rail-item${i === current ? " rail-active" : revealed.has(i) ? " rail-visited" : ""}${
      i > 0 && slides[i - 1].act !== slides[i].act ? " rail-break" : ""
    }`;

  const jumpList = (extra: string) =>
    slides.map((s, i) => (
      <button
        type="button"
        key={s.id}
        class={extra === "rail" ? railClass(i) : "sheet-item"}
        aria-label={s.title}
        aria-current={i === current ? "true" : undefined}
        onClick={() => {
          setSheetOpen(false);
          goTo(i);
        }}
      >
        <span class="rail-icon" aria-hidden="true">
          <SlideIcon id={s.id} fallback={s.icon} />
        </span>
        <span class="rail-name">{s.title}</span>
      </button>
    ));

  return (
    <section class="dashboard story">
      {/* Full-viewport ground behind everything; its color crossfades to the
          current act's quiet tint as the reader crosses act boundaries. */}
      <div
        class="story-atmosphere"
        data-act={slides[current]?.act}
        aria-hidden="true"
      />

      {children}

      <div class="story-progress" ref={progressRef} aria-hidden="true" />

      <nav class="story-rail" aria-label="Sections">
        {jumpList("rail")}
      </nav>

      <div class="story-column">
        {slides.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            class={`story-section arch-${s.archetype ?? "ledger"}${
              s.hero ? " has-hero" : ""
            }${i === current ? " story-current" : ""}`}
            data-act={s.act}
            tabindex={-1}
            aria-labelledby={`${s.id}-title`}
            ref={(el) => {
              sections.current[i] = el;
            }}
            onClick={() => settleNow(i)}
          >
            <article class="story-card">
              <header class="story-head">
                <h3 id={`${s.id}-title`}>
                  <span class="slide-icon" aria-hidden="true">
                    <SlideIcon id={s.id} fallback={s.icon} />
                  </span>
                  {s.title}
                </h3>
                <p class="muted">{s.description}</p>
              </header>
              <SlidePriorityContext.Provider value={i}>
                <RevealContext.Provider
                  value={{ live: true, settled: settled.has(i) }}
                >
                  {s.content}
                </RevealContext.Provider>
              </SlidePriorityContext.Provider>
            </article>
          </section>
        ))}
      </div>

      <button
        type="button"
        class="story-chip"
        aria-label="Jump to a section"
        onClick={() => setSheetOpen(true)}
      >
        {current + 1} / {count}
      </button>
      {sheetOpen && (
        <div class="story-sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <nav
            class="story-sheet"
            aria-label="Jump to a section"
            onClick={(event) => event.stopPropagation()}
          >
            {jumpList("sheet")}
          </nav>
        </div>
      )}
    </section>
  );
}
