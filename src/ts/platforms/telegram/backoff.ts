/**
 * Retry helper for Telegram calls. Handles FLOOD_WAIT (wait the server-mandated
 * seconds, then retry) and retries other transient errors with exponential
 * backoff. `sleep` is injectable so tests never actually wait.
 */

export interface FloodRetryOptions {
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  onWait?: (seconds: number) => void;
}

const DEFAULT_MAX_RETRIES = 5;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extract the FLOOD_WAIT duration (in seconds) from an error, or null if the
 * error is not a flood-wait. Recognises both a numeric `.seconds` property and a
 * `FLOOD_WAIT_<n>` message.
 */
export function floodWaitSeconds(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "seconds" in err) {
    const seconds = (err as { seconds: unknown }).seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return seconds;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  const match = /FLOOD_WAIT_(\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

export async function withFloodRetry<T>(
  fn: () => Promise<T>,
  opts: FloodRetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = opts.sleep ?? realSleep;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }

      const waitSeconds = floodWaitSeconds(err);
      if (waitSeconds !== null) {
        opts.onWait?.(waitSeconds);
        await sleep(waitSeconds * 1000);
      } else {
        // Transient error: exponential backoff (1s, 2s, 4s, ...).
        await sleep(2 ** attempt * 1000);
      }
      attempt++;
    }
  }
}
