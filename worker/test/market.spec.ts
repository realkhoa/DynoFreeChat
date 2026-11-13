import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { IndicesPayload, QuotesPayload } from "@dyno/shared/market";
import {
  INDEX_TTL_MS,
  QUOTE_TTL_MS,
  RATE_CAPACITY,
  RATE_WINDOW_MS,
  STALE_TTL_MS,
  indicesResponse,
  quotesResponse,
  resetMarketCache,
  takeRate,
  type MarketDeps,
} from "../src/market";
import { BASE, ORIGIN, uniqueIp } from "./helpers";

beforeEach(() => {
  resetMarketCache();
});

/** One VPS quote row, enough for the normalizer to accept it. */
function row(symbol: string, lastPrice = 132.5): Record<string, unknown> {
  return {
    sym: symbol,
    r: 131.3,
    c: 140.4,
    f: 122.2,
    lastPrice,
    lot: 1000,
    g1: "132.4|12300",
    g4: "132.5|9900",
  };
}

interface Harness {
  deps: MarketDeps;
  calls: string[];
  store: Map<string, string>;
  clock: { now: number };
  /** Replaces the upstream answer; a thrown error simulates a network failure. */
  respond: (body: unknown, status?: number) => void;
  fail: () => void;
}

/**
 * @brief Builds market dependencies backed by a scripted upstream and a fake cache.
 * @return The harness.
 */
function makeHarness(): Harness {
  const calls: string[] = [];
  const store = new Map<string, string>();
  const clock = { now: 1_000_000 };
  let answer: { body: unknown; status: number } | Error = { body: [], status: 200 };

  const deps: MarketDeps = {
    now: () => clock.now,
    fetch: async (input) => {
      calls.push(input);
      if (answer instanceof Error) throw answer;
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    },
    cache: {
      match: async (key) => {
        const body = store.get(String(key));
        return body === undefined ? undefined : new Response(body);
      },
      put: async (key, response) => {
        store.set(String(key), await response.text());
      },
    },
  };

  return {
    deps,
    calls,
    store,
    clock,
    respond: (body, status = 200) => {
      answer = { body, status };
    },
    fail: () => {
      answer = new Error("upstream down");
    },
  };
}

describe("quotes proxy", () => {
  it("normalizes the upstream rows and reports a fresh payload", async () => {
    const h = makeHarness();
    h.respond([row("FPT"), row("HPG", 30.5)]);

    const response = await quotesResponse("fpt,hpg", h.deps);
    expect(response.status).toBe(200);

    const body = (await response.json()) as QuotesPayload;
    expect(body.stale).toBe(false);
    expect(body.ts).toBe(h.clock.now);
    expect(body.quotes.map((quote) => quote.symbol)).toEqual(["FPT", "HPG"]);
    expect(body.quotes[0]?.bids[0]).toEqual({ price: 132.4, volume: 12300 });
    expect(h.calls).toEqual(["https://bgapidatafeed.vps.com.vn/getliststockdata/FPT,HPG"]);
  });

  it("serves the cache inside the freshness window without touching upstream", async () => {
    const h = makeHarness();
    h.respond([row("FPT")]);

    await quotesResponse("FPT", h.deps);
    h.clock.now += QUOTE_TTL_MS - 1;
    const second = (await (await quotesResponse("FPT", h.deps)).json()) as QuotesPayload;

    expect(second.quotes).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
  });

  it("refreshes once the cache is older than the TTL", async () => {
    const h = makeHarness();
    h.respond([row("FPT", 132.5)]);

    await quotesResponse("FPT", h.deps);
    h.clock.now += QUOTE_TTL_MS;
    h.respond([row("FPT", 133.1)]);
    const body = (await (await quotesResponse("FPT", h.deps)).json()) as QuotesPayload;

    expect(h.calls).toHaveLength(2);
    expect(body.quotes[0]?.last).toBe(133.1);
  });

  it("serves the last good payload as stale when upstream fails", async () => {
    const h = makeHarness();
    h.respond([row("FPT")]);
    await quotesResponse("FPT", h.deps);

    h.clock.now += QUOTE_TTL_MS + 1;
    h.fail();
    const body = (await (await quotesResponse("FPT", h.deps)).json()) as QuotesPayload;

    expect(body.stale).toBe(true);
    expect(body.quotes).toHaveLength(1);
  });

  it("502s when upstream fails and nothing was cached", async () => {
    const h = makeHarness();
    h.fail();
    const response = await quotesResponse("ZZZ", h.deps);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("502s when upstream answers with junk instead of a quote list", async () => {
    const h = makeHarness();
    h.respond({ error: "nope" });
    expect((await quotesResponse("FPT", h.deps)).status).toBe(502);
  });

  it("stops serving a stale payload once it is too old", async () => {
    const h = makeHarness();
    h.respond([row("FPT")]);
    await quotesResponse("FPT", h.deps);

    h.clock.now += STALE_TTL_MS + 1;
    h.fail();
    expect((await quotesResponse("FPT", h.deps)).status).toBe(502);
  });

  it("400s an invalid or missing symbol list", async () => {
    const h = makeHarness();
    h.respond([row("FPT")]);

    expect((await quotesResponse(null, h.deps)).status).toBe(400);
    expect((await quotesResponse("", h.deps)).status).toBe(400);
    expect((await quotesResponse("FPT,BAD!", h.deps)).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("refreshes a payload the platform cache already holds", async () => {
    const h = makeHarness();
    const key = "https://market.cache/quotes/AAA";
    h.store.set(key, JSON.stringify({ storedAt: h.clock.now, payload: [] }));
    h.respond([row("AAA")]);

    // An empty cached payload is not a usable quote list, so the proxy refreshes.
    const response = await quotesResponse("AAA", h.deps);
    expect(response.status).toBe(200);
    expect(h.calls).toHaveLength(1);
  });
});

describe("indices proxy", () => {
  it("returns the known indices in display order", async () => {
    const h = makeHarness();
    h.respond([
      { hashValue: "02", cIndex: 240, oIndex: 241 },
      { hashValue: "10", cIndex: 1287.45, oIndex: 1284.33, ot: "3.12|0.24%" },
      { hashValue: "99", cIndex: 1 },
    ]);

    const body = (await (await indicesResponse(h.deps)).json()) as IndicesPayload;
    expect(body.indices.map((index) => index.name)).toEqual(["VN-INDEX", "HNX"]);
    expect(body.stale).toBe(false);
  });

  it("serves the previous basket as stale after an upstream failure", async () => {
    const h = makeHarness();
    h.respond([{ hashValue: "10", cIndex: 1287.45, oIndex: 1284.33, ot: "3.12|0.24%" }]);
    await indicesResponse(h.deps);

    h.clock.now += INDEX_TTL_MS + 1;
    h.fail();
    const body = (await (await indicesResponse(h.deps)).json()) as IndicesPayload;
    expect(body.stale).toBe(true);
    expect(body.indices).toHaveLength(1);
  });
});

describe("rate limit", () => {
  it("allows a burst up to capacity and then refuses", () => {
    const ip = uniqueIp();
    for (let index = 0; index < RATE_CAPACITY; index += 1) {
      expect(takeRate(ip, 1_000)).toBe(true);
    }
    expect(takeRate(ip, 1_000)).toBe(false);
  });

  it("opens a new window after the interval", () => {
    const ip = uniqueIp();
    for (let index = 0; index < RATE_CAPACITY; index += 1) takeRate(ip, 1_000);
    expect(takeRate(ip, 1_000)).toBe(false);
    expect(takeRate(ip, 1_000 + RATE_WINDOW_MS)).toBe(true);
  });
});

describe("market routes", () => {
  it("400s a request without symbols and keeps the CORS headers", async () => {
    const response = await SELF.fetch(`${BASE}/api/market/quotes`, {
      headers: { origin: ORIGIN, "cf-connecting-ip": uniqueIp() },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    await expect(response.json()).resolves.toEqual({ code: "BAD_SYMBOLS" });
  });

  it("405s a non-GET request", async () => {
    const response = await SELF.fetch(`${BASE}/api/market/quotes`, {
      method: "POST",
      headers: { origin: ORIGIN, "cf-connecting-ip": uniqueIp() },
    });
    expect(response.status).toBe(405);
  });

  it("429s a client over the rate limit", async () => {
    const ip = uniqueIp();
    const headers = { origin: ORIGIN, "cf-connecting-ip": ip };
    for (let index = 0; index < RATE_CAPACITY; index += 1) {
      await SELF.fetch(`${BASE}/api/market/indices`, { headers });
    }
    const response = await SELF.fetch(`${BASE}/api/market/indices`, { headers });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("10");
  });

  it("403s a foreign origin before any proxy work", async () => {
    const response = await SELF.fetch(`${BASE}/api/market/quotes?symbols=FPT`, {
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});
