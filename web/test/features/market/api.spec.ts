// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { IndicesPayload, QuotesPayload } from "@dyno/shared/market";
import { MarketApi, MarketApiError } from "@/features/market/api";

/** Builds a `fetch` stand-in that answers with one scripted response. */
function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const QUOTES: QuotesPayload = {
  quotes: [
    {
      symbol: "FPT",
      ref: 131.3,
      ceiling: 140.4,
      floor: 122.2,
      last: 132.5,
      avg: 132.1,
      high: 133.2,
      low: 130.9,
      change: 1.2,
      changePercent: 0.91,
      volume: 1_234_500,
      foreignBuy: 210_300,
      foreignRoom: 4_567_800,
      side: "BUY",
      bids: [{ price: 132.4, volume: 12_300 }],
      asks: [{ price: 132.5, volume: 9_900 }],
    },
  ],
  stale: false,
  ts: 1_700_000_000_000,
};

const INDICES: IndicesPayload = {
  indices: [{ key: "10", name: "VN-INDEX", value: 1287.45, change: 3.12, changePercent: 0.24 }],
  stale: false,
  ts: 1_700_000_000_000,
};

describe("MarketApi", () => {
  it("requests the quote batch from the Worker proxy", async () => {
    const fetchImpl = fetchReturning(QUOTES);
    const api = new MarketApi("https://api.example", fetchImpl);

    const payload = await api.quotes(["FPT", "HPG"]);
    expect(payload.quotes).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example/api/market/quotes?symbols=FPT,HPG", {
      headers: { accept: "application/json" },
    });
  });

  it("normalizes a partial payload instead of trusting it blindly", async () => {
    const api = new MarketApi("https://api.example", fetchReturning({ quotes: [], ts: 42 }));
    const payload = await api.quotes(["FPT"]);
    expect(payload.stale).toBe(false);
    expect(payload.ts).toBe(42);
  });

  it("surfaces the proxy error code", async () => {
    const api = new MarketApi("https://api.example", fetchReturning({ code: "RATE_LIMITED" }, 429));
    const error = await api.indices().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MarketApiError);
    expect((error as MarketApiError).code).toBe("RATE_LIMITED");
  });

  it("reports an unreachable proxy as NETWORK", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("failed to fetch");
    }) as unknown as typeof fetch;
    const api = new MarketApi("https://api.example", fetchImpl);
    await expect(api.indices()).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("rejects a body that does not match the contract", async () => {
    const api = new MarketApi("https://api.example", fetchReturning({ quotes: "nope" }));
    await expect(api.quotes(["FPT"])).rejects.toMatchObject({ code: "BAD_PAYLOAD" });
  });

  it("requests the index basket without a query", async () => {
    const fetchImpl = fetchReturning(INDICES);
    const api = new MarketApi("https://api.example", fetchImpl);
    await expect(api.indices()).resolves.toMatchObject({ indices: INDICES.indices });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example/api/market/indices", {
      headers: { accept: "application/json" },
    });
  });
});
