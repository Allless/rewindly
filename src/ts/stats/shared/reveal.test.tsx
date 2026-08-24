import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { Beat, CountUp, Hero, RevealContext, beatStyle } from "./reveal";

/* A live, unsettled slide: beats wait for their own viewport entry. Effects
 * never run under preact-render-to-string, so nothing is "seen" yet. */
const live = { live: true, settled: false };

describe("Beat", () => {
  it("holds content back until it enters the viewport", () => {
    const html = render(
      <RevealContext.Provider value={live}>
        <Beat step={2}>later</Beat>
      </RevealContext.Provider>,
    );
    expect(html).toContain('class="beat"');
    expect(html).not.toContain("beat-in");
    expect(html).toContain("--beat-delay:400ms");
  });

  it("renders revealed and settled by default, so cards work without a deck", () => {
    const html = render(<Beat step={1}>now</Beat>);
    expect(html).toContain("beat beat-in beat-settled");
  });

  it("marks settled beats so CSS can cut the choreography short", () => {
    const html = render(
      <RevealContext.Provider value={{ live: true, settled: true }}>
        <Beat step={1}>skip ahead</Beat>
      </RevealContext.Provider>,
    );
    expect(html).toContain("beat-settled");
  });
});

describe("CountUp", () => {
  /* Static renders (tests, shares) must never show the count-up's zero. */
  it("shows the final value where there is no deck", () => {
    const html = render(
      <CountUp value={1234} format={(n) => String(Math.round(n))} />,
    );
    expect(html).toContain("1234");
  });

  it("starts from zero inside a live slide awaiting entry", () => {
    const html = render(
      <RevealContext.Provider value={live}>
        <CountUp value={1234} format={(n) => String(Math.round(n))} />
      </RevealContext.Provider>,
    );
    expect(html).toContain(">0<");
  });

  it("shows the final value on a settled slide", () => {
    const html = render(
      <RevealContext.Provider value={{ live: true, settled: true }}>
        <CountUp value={1234} format={(n) => String(Math.round(n))} />
      </RevealContext.Provider>,
    );
    expect(html).toContain("1234");
  });
});

describe("Hero", () => {
  it("is a beat with hero styling", () => {
    const html = render(<Hero value="42s" label="your median reply" />);
    expect(html).toContain("beat-hero");
    expect(html).toContain('class="hero-value"');
    expect(html).toContain("42s");
  });
});

describe("beatStyle", () => {
  it("scales the delay by step and unit", () => {
    expect(beatStyle(3, 200)).toEqual({ "--beat-delay": "600ms" });
  });
});
