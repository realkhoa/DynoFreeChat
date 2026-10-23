import { describe, expect, it } from "vitest";
import { BASE_DELAY_MS, MAX_DELAY_MS, nextDelay } from "../src/net/backoff";

describe("nextDelay", () => {
  it("starts around one second with jitter", () => {
    expect(nextDelay(0, () => 0)).toBe(800);
    expect(nextDelay(0, () => 0.5)).toBe(BASE_DELAY_MS);
    expect(nextDelay(0, () => 1)).toBe(1200);
  });

  it("doubles per attempt", () => {
    expect(nextDelay(1, () => 0.5)).toBe(2000);
    expect(nextDelay(2, () => 0.5)).toBe(4000);
    expect(nextDelay(3, () => 0.5)).toBe(8000);
  });

  it("never exceeds the cap", () => {
    expect(nextDelay(10, () => 1)).toBeLessThanOrEqual(MAX_DELAY_MS);
    expect(nextDelay(99, () => 1)).toBeLessThanOrEqual(MAX_DELAY_MS);
  });

  it("stays deterministic for a fixed random source", () => {
    expect(nextDelay(4, () => 0.25)).toBe(nextDelay(4, () => 0.25));
  });

  it("treats negative attempts as the first delay", () => {
    expect(nextDelay(-3, () => 0.5)).toBe(BASE_DELAY_MS);
  });
});
