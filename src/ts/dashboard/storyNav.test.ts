import { describe, expect, it } from "vitest";

import { pickCurrent } from "./storyNav";

describe("pickCurrent", () => {
  it("keeps the previous section when nothing is on the midline", () => {
    expect(pickCurrent(new Set(), 4)).toBe(4);
  });

  it("keeps the previous section while it still touches the line", () => {
    expect(pickCurrent(new Set([3, 4]), 4)).toBe(4);
  });

  it("moves to the section on the line", () => {
    expect(pickCurrent(new Set([7]), 4)).toBe(7);
  });

  it("jumps to a far section after a fling that skipped callbacks", () => {
    expect(pickCurrent(new Set([12]), 2)).toBe(12);
  });

  it("prefers the section nearest the previous one at a boundary", () => {
    expect(pickCurrent(new Set([5, 9]), 4)).toBe(5);
  });

  it("breaks equal distances toward the earlier section", () => {
    expect(pickCurrent(new Set([3, 7]), 5)).toBe(3);
  });
});
