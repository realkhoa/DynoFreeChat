import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ChartPayload,
  DepthPayload,
  FeedPayload,
  IndicesPayload,
  QuotesPayload,
} from "@dyno/shared/market";
import {
  CHART_TTL_MS,
  INDEX_TTL_MS,
  QUOTE_TTL_MS,
  RATE_CAPACITY,
  RATE_WINDOW_MS,
  STALE_TTL_MS,
  chartResponse,
  depthResponse,
  feedResponse,
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

/** One scripted upstream route for the router harness. */
interface Route {
  /** Substring of the request URL that selects this route. */
  match: string;
  /** Body returned: an object is JSON encoded, a string is returned as-is. */
  body: unknown;
  /** HTTP status, defaults to 200. */
  status?: number;
}

interface RouterHarness {
  deps: MarketDeps;
  requests: Array<{ url: string; headers: Record<string, string> }>;
  clock: { now: number };
}

/**
 * @brief Builds market dependencies that answer by URL substring.
 * @param routes Scripted upstream routes, first match wins.
 * @return The harness.
 */
function makeRouter(routes: Route[]): RouterHarness {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const clock = { now: 1_000_000 };

  const deps: MarketDeps = {
    now: () => clock.now,
    cache: null,
    fetch: async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({ url: input, headers });
      const route = routes.find((candidate) => input.includes(candidate.match));
      if (route === undefined) return new Response("not found", { status: 404 });
      const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
      return new Response(body, { status: route.status ?? 200 });
    },
  };

  return { deps, requests, clock };
}

/** Entrade-shaped OHLC payload: three one-minute candles. */
const OHLC = {
  t: [1_700_000_000, 1_700_000_060, 1_700_000_120],
  o: [132.1, 132.4, 132.2],
  h: [132.6, 132.7, 132.5],
  l: [131.9, 132.1, 132.0],
  c: [132.4, 132.2, 132.5],
  v: [1200, 800, 400],
};

describe("chart proxy", () => {
  it("normalizes the parallel arrays into candles with millisecond times", async () => {
    const h = makeRouter([{ match: "ohlcs/stock", body: OHLC }]);
    const body = (await (await chartResponse("fpt", "1D", h.deps)).json()) as ChartPayload;

    expect(body.symbol).toBe("FPT");
    expect(body.resolution).toBe("1D");
    expect(body.candles).toHaveLength(3);
    expect(body.candles[0]).toEqual({
      time: 1_700_000_000_000,
      open: 132.1,
      high: 132.6,
      low: 131.9,
      close: 132.4,
      volume: 1200,
    });
    expect(h.requests[0]?.url).toContain("symbol=FPT");
    expect(h.requests[0]?.url).toContain("resolution=1D");
  });

  it("routes index tickers to the index endpoint", async () => {
    const h = makeRouter([{ match: "ohlcs/index", body: OHLC }]);
    await chartResponse("vnindex", null, h.deps);
    expect(h.requests[0]?.url).toContain("ohlcs/index?symbol=VNINDEX");
    expect(h.requests[0]?.url).toContain("resolution=1D");
  });

  it("400s a missing or invalid symbol", async () => {
    const h = makeRouter([]);
    expect((await chartResponse(null, null, h.deps)).status).toBe(400);
    expect((await chartResponse("BAD!", null, h.deps)).status).toBe(400);
  });

  it("502s when the candle series is empty", async () => {
    const h = makeRouter([{ match: "ohlcs", body: { t: [], o: [], h: [], l: [], c: [], v: [] } }]);
    expect((await chartResponse("FPT", null, h.deps)).status).toBe(502);
  });

  it("caches a candle series for a minute", async () => {
    const h = makeRouter([{ match: "ohlcs", body: OHLC }]);
    await chartResponse("FPT", "1D", h.deps);
    h.clock.now += CHART_TTL_MS - 1;
    await chartResponse("FPT", "1D", h.deps);
    expect(h.requests).toHaveLength(1);
  });
});

describe("depth proxy", () => {
  it("aggregates volume by price, heaviest price first", async () => {
    const h = makeRouter([{ match: "ohlcs", body: OHLC }]);
    const body = (await (await depthResponse("FPT", h.deps)).json()) as DepthPayload;

    expect(body.symbol).toBe("FPT");
    expect(body.totalVolume).toBe(2400);
    expect(body.levels.map((level) => level.price)).toEqual([132.5, 132.4, 132.2]);
    expect(body.levels[0]).toEqual({ price: 132.5, volume: 400, percent: 33.33 });
    expect(body.levels[1]).toEqual({ price: 132.4, volume: 1200, percent: 100 });
  });

  it("502s when the profile has no levels", async () => {
    const h = makeRouter([{ match: "ohlcs", body: { t: [], o: [], h: [], l: [], c: [], v: [] } }]);
    expect((await depthResponse("FPT", h.deps)).status).toBe(502);
  });
});

describe("feed proxy", () => {
  it("loads FireAnt posts and the replies of the busiest threads", async () => {
    const tokenHtml = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { initialState: { auth: { accessToken: "tok-123" } } },
    })}</script></html>`;
    const posts = [
      {
        postID: 11,
        title: "FPT sắp bứt phá",
        content: "<p>Dòng tiền <b>vào</b></p>",
        user: { name: "An" },
        totalReplies: 2,
        totalLikes: 7,
        date: "2026-11-13T02:00:00Z",
      },
      { postID: 12, content: "Giữ tiếp", user: { name: "Bình" }, totalReplies: 0, totalLikes: 1 },
    ];
    const replies = [{ postID: 111, content: "Đồng ý", user: { name: "Chi" }, totalLikes: 2 }];

    const h = makeRouter([
      { match: "fireant.vn/ma-chung-khoan", body: tokenHtml },
      { match: "/posts/11/replies", body: replies },
      { match: "/symbols/FPT/posts", body: posts },
    ]);

    const body = (await (await feedResponse("FPT", "fireant", null, h.deps)).json()) as FeedPayload;
    expect(body.source).toBe("fireant");
    expect(body.items.map((item) => item.author)).toEqual(["An", "Bình", "Chi"]);
    expect(body.items[0]?.text).toBe("FPT sắp bứt phá. Dòng tiền vào");
    expect(body.items[2]?.text).toBe("↳ Đồng ý");
    expect(h.requests[1]?.headers.authorization).toBe("Bearer tok-123");
  });

  it("loads the F247 search results", async () => {
    const h = makeRouter([
      {
        match: "f247.com/search.json",
        body: {
          posts: [
            {
              id: 7,
              username: "Trader",
              blurb: "Nhận định HPG",
              topic_id: 3,
              like_count: 4,
              created_at: "2026-11-12",
            },
          ],
          topics: [{ id: 3, title: "Thép" }],
        },
      },
    ]);

    const body = (await (await feedResponse("HPG", "f247", null, h.deps)).json()) as FeedPayload;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ source: "F247", topic: "Thép", likes: 4 });
  });

  it("scrapes the VOZ thread with the streaming rewriter", async () => {
    const html = `
      <article data-author="VoZer A">
        <div class="message-inner">
          <div class="message-content"><div class="bbWrapper">Thị trường <b>hôm nay</b> xanh quá</div></div>
          <time datetime="2026-11-13T03:04:05Z"></time>
        </div>
      </article>
      <article data-author="VoZer B">
        <div class="bbWrapper">Chốt lời <a href="#">HPG</a> thôi</div>
      </article>`;
    const h = makeRouter([{ match: "voz.vn/t/", body: html }]);

    const body = (await (await feedResponse("HPG", "voz", "3", h.deps)).json()) as FeedPayload;
    expect(body.page).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ author: "VoZer A", createdAt: "2026-11-13T03:04:05Z" });
    expect(body.items[0]?.text).toBe("Thị trường hôm nay xanh quá");
    expect(body.items[1]?.text).toBe("Chốt lời HPG thôi");
    expect(h.requests[0]?.url).toContain("/page-3");
  });

  it("400s an unknown source", async () => {
    const h = makeRouter([]);
    expect((await feedResponse("FPT", "twitter", null, h.deps)).status).toBe(400);
  });

  it("502s when upstream returns nothing usable", async () => {
    const h = makeRouter([{ match: "f247.com", body: { posts: [], topics: [] } }]);
    expect((await feedResponse("FPT", "f247", null, h.deps)).status).toBe(502);
  });
});
