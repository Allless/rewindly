/** Dev-only diagnostics — compiled out of production builds. */
export function debug(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.debug("[rewindly]", ...args);
  }
}
