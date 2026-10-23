import { RATE_CAPACITY, RATE_REFILL_MS } from "./protocol";

/** Fractional token bucket state. Persisted per connection via `ws.serializeAttachment()`. */
export interface Bucket {
  tokens: number;
  last: number;
}

export type TakeResult =
  | { ok: true; bucket: Bucket }
  | { ok: false; bucket: Bucket; retryInMs: number };

/**
 * A fresh bucket starts full.
 * @param now Current epoch milliseconds.
 * @param capacity Maximum tokens, defaults to the chat allowance.
 * @return A full bucket.
 */
export function newBucket(now: number, capacity: number = RATE_CAPACITY): Bucket {
  return { tokens: capacity, last: now };
}

/**
 * Consumes one token. Pure: the input bucket is never mutated, the caller stores
 * the returned bucket. Refill is linear, capped at `capacity`. The bucket carries
 * no capacity of its own, so the caller must pass the same values every time for
 * one bucket — that is how chat and game traffic keep separate allowances.
 * @param bucket Current bucket state.
 * @param now Current epoch milliseconds.
 * @param capacity Maximum tokens for this bucket.
 * @param refillMs Milliseconds to regenerate one token.
 * @return Whether a token was taken, plus the next bucket state.
 */
export function take(
  bucket: Bucket,
  now: number,
  capacity: number = RATE_CAPACITY,
  refillMs: number = RATE_REFILL_MS,
): TakeResult {
  const elapsed = Math.max(0, now - bucket.last);
  const tokens = Math.min(capacity, bucket.tokens + elapsed / refillMs);

  if (tokens >= 1) {
    return { ok: true, bucket: { tokens: tokens - 1, last: now } };
  }

  return {
    ok: false,
    bucket: { tokens, last: now },
    retryInMs: Math.ceil((1 - tokens) * refillMs),
  };
}
