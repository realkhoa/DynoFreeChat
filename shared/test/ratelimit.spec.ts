import { describe, expect, it } from "vitest";
import { GAME_CAPACITY, GAME_REFILL_MS, RATE_CAPACITY, RATE_REFILL_MS } from "../src/protocol";
import { newBucket, take } from "../src/ratelimit";

const T0 = 1_700_000_000_000;

describe("token bucket", () => {
  it("starts full", () => {
    expect(newBucket(T0).tokens).toBe(RATE_CAPACITY);
  });

  it("allows RATE_CAPACITY messages at the same instant", () => {
    let bucket = newBucket(T0);
    for (let i = 0; i < RATE_CAPACITY; i += 1) {
      const result = take(bucket, T0);
      expect(result.ok).toBe(true);
      bucket = result.bucket;
    }
    expect(bucket.tokens).toBe(0);
  });

  it("rejects one message past capacity with a retry hint", () => {
    let bucket = newBucket(T0);
    for (let i = 0; i < RATE_CAPACITY; i += 1) {
      bucket = take(bucket, T0).bucket;
    }

    const sixth = take(bucket, T0);
    expect(sixth.ok).toBe(false);
    if (sixth.ok) throw new Error("expected rejection");
    expect(sixth.retryInMs).toBe(RATE_REFILL_MS);
  });

  it("refills one token per RATE_REFILL_MS", () => {
    let bucket = newBucket(T0);
    for (let i = 0; i < RATE_CAPACITY; i += 1) {
      bucket = take(bucket, T0).bucket;
    }

    const later = take(bucket, T0 + RATE_REFILL_MS);
    expect(later.ok).toBe(true);
    expect(later.bucket.tokens).toBeCloseTo(0, 5);
  });

  it("never refills past capacity", () => {
    const result = take(newBucket(T0), T0 + 60_000);
    expect(result.ok).toBe(true);
    expect(result.bucket.tokens).toBe(RATE_CAPACITY - 1);
  });

  it("does not mutate the bucket it was given", () => {
    const bucket = newBucket(T0);
    const snapshot = { ...bucket };
    take(bucket, T0 + 5_000);
    expect(bucket).toEqual(snapshot);
  });

  it("honours an explicit capacity and refill for a separate bucket", () => {
    let bucket = newBucket(T0, GAME_CAPACITY);
    expect(bucket.tokens).toBe(GAME_CAPACITY);

    for (let i = 0; i < GAME_CAPACITY; i += 1) {
      const result = take(bucket, T0, GAME_CAPACITY, GAME_REFILL_MS);
      expect(result.ok).toBe(true);
      bucket = result.bucket;
    }

    const blocked = take(bucket, T0, GAME_CAPACITY, GAME_REFILL_MS);
    expect(blocked.ok).toBe(false);

    const refilled = take(bucket, T0 + GAME_REFILL_MS, GAME_CAPACITY, GAME_REFILL_MS);
    expect(refilled.ok).toBe(true);
  });

  it("keeps a game bucket independent of the chat bucket", () => {
    let chat = newBucket(T0);
    let game = newBucket(T0, GAME_CAPACITY);

    for (let i = 0; i < RATE_CAPACITY; i += 1) chat = take(chat, T0).bucket;
    for (let i = 0; i < GAME_CAPACITY; i += 1) game = take(game, T0, GAME_CAPACITY, GAME_REFILL_MS).bucket;

    expect(take(chat, T0).ok).toBe(false);
    expect(take(game, T0, GAME_CAPACITY, GAME_REFILL_MS).ok).toBe(false);
  });
});
