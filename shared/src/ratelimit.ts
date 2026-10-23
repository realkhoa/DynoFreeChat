import { RATE_CAPACITY, RATE_REFILL_MS } from "./protocol";

/** Fractional token bucket state. Persisted per connection via `ws.serializeAttachment()`. */
export interface Bucket {
  tokens: number;
  last: number;
}

export type TakeResult =
  | { ok: true; bucket: Bucket }
  | { ok: false; bucket: Bucket; retryInMs: number };

/** A fresh bucket starts full. */
export function newBucket(now: number): Bucket {
  return { tokens: RATE_CAPACITY, last: now };
}

/**
 * Consumes one token. Pure: the input bucket is never mutated, the caller stores
 * the returned bucket. Refill is linear, capped at {@link RATE_CAPACITY}.
 */
export function take(bucket: Bucket, now: number): TakeResult {
  const elapsed = Math.max(0, now - bucket.last);
  const tokens = Math.min(RATE_CAPACITY, bucket.tokens + elapsed / RATE_REFILL_MS);

  if (tokens >= 1) {
    return { ok: true, bucket: { tokens: tokens - 1, last: now } };
  }

  return {
    ok: false,
    bucket: { tokens, last: now },
    retryInMs: Math.ceil((1 - tokens) * RATE_REFILL_MS),
  };
}
