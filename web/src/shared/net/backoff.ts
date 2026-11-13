/** Exponential backoff with jitter, capped at 30s. */
export const MAX_DELAY_MS = 30_000;
export const BASE_DELAY_MS = 1_000;
export const JITTER_RATIO = 0.2;

export function nextDelay(attempt: number, rand: () => number = Math.random): number {
  const safeAttempt = Math.max(0, Math.min(30, Math.floor(attempt)));
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** safeAttempt);
  const jitter = base * JITTER_RATIO * (rand() * 2 - 1);
  return Math.max(0, Math.min(MAX_DELAY_MS, Math.round(base + jitter)));
}
