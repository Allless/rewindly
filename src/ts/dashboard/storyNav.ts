/**
 * The story column's current-section decision, kept pure so it's testable
 * without a DOM. The column observes a zero-height line at the viewport
 * midline (rootMargin -50%/-50%, threshold 0): a section "intersects" while
 * it touches that line, so with non-overlapping sections at most one or two
 * (at a boundary) are on the line at once.
 *
 * Rules: the previous answer wins while it still touches the line, and an
 * empty line (the midline inside a column gap, or the observer skipping
 * frames mid-fling) keeps it too — so boundary states never flicker the
 * rail. Otherwise the section nearest the previous one wins.
 */
export function pickCurrent(onLine: ReadonlySet<number>, prev: number): number {
  if (onLine.size === 0 || onLine.has(prev)) return prev;
  let best = prev;
  let bestDistance = Infinity;
  for (const at of onLine) {
    const distance = Math.abs(at - prev);
    if (distance < bestDistance || (distance === bestDistance && at < best)) {
      best = at;
      bestDistance = distance;
    }
  }
  return best;
}
