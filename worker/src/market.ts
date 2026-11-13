/**
 * @file market.ts
 * @brief Thin proxy for the market data feed, with caching and stale fallback.
 * @details Browsers cannot call the upstream services directly: they send no
 * CORS headers and rate limit per client IP. The Worker keeps a short cache
 * (the feed updates about every three seconds), serves the last good payload
 * when an upstream fails, and bounds every upstream call with a timeout so a
 * request never hangs. No business logic lives here — only transport.
 */

import {
  INDEX_KEYS,
  isIndexTicker,
  makeFireAntReply,
  makeVozItem,
  parseChart,
  parseDepthProfile,
  parseF247Posts,
  parseFeedSource,
  parseFireAntPosts,
  parseIndices,
  parseOneSymbol,
  parseQuotes,
  parseResolution,
  parseSymbolList,
  type Candle,
  type ChartPayload,
  type DepthLevel,
  type DepthPayload,
  type FeedItem,
  type FeedPayload,
  type IndicesPayload,
  type MarketIndex,
  type Quote,
  type QuotesPayload,
} from "@dyno/shared/market";
import { json } from "./http";

/** VPS datafeed origin: quotes, index levels and three-tier depth. */
export const VPS_BASE = "https://bgapidatafeed.vps.com.vn";

/** Entrade chart API: candles for every listed ticker and index. */
export const ENTARDE_BASE = "https://services.entrade.com.vn/chart-api/v2/ohlcs";

/** FireAnt REST API: community posts and replies per symbol. */
export const FIREANT_BASE = "https://restv2.fireant.vn";

/** FireAnt symbol page, scraped only to refresh the anonymous bearer token. */
export const FIREANT_PAGE = "https://fireant.vn/ma-chung-khoan";

/** F247 public search endpoint. */
export const F247_SEARCH = "https://f247.com/search.json?q=";

/** VOZ thread the club posts in; page 99999 redirects to the last page. */
export const VOZ_THREAD =
  "https://voz.vn/t/clb-chung-khoan-chia-se-kinh-nghiem-dau-tu-chung-khoan-2026-ky-nguyen-vuon-minh.1188208/page-";

/** Public anonymous FireAnt token, used when the page scrape fails. */
const FIREANT_ANON_TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6IkdYdExONzViZlZQakdvNERWdjV4QkRITHpnSSIsImtpZCI6IkdYdExONzViZlZQakdvNERWdjV4QkRITHpnSSJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmZpcmVhbnQudm4iLCJhdWQiOiJodHRwczovL2FjY291bnRzLmZpcmVhbnQudm4vcmVzb3VyY2VzIiwiZXhwIjoxODg5NjIyNTMwLCJuYmYiOjE1ODk2MjI1MzAsImNsaWVudF9pZCI6ImZpcmVhbnQudHJhZGVzdGF0aW9uIiwic2NvcGUiOlsiYWNhZGVteS1yZWFkIiwiYWNhZGVteS13cml0ZSIsImFjY291bnRzLXJlYWQiLCJhY2NvdW50cy13cml0ZSIsImJsb2ctcmVhZCIsImNvbXBhbmllcy1yZWFkIiwiZmluYW5jZS1yZWFkIiwiaW5kaXZpZHVhbHMtcmVhZCIsImludmVzdG9wZWRpYS1yZWFkIiwib3JkZXJzLXJlYWQiLCJvcmRlcnMtd3JpdGUiLCJwb3N0cy1yZWFkIiwicG9zdHMtd3JpdGUiLCJzZWFyY2giLCJzeW1ib2xzLXJlYWQiLCJ1c2VyLWRhdGEtcmVhZCIsInVzZXItZGF0YS13cml0ZSIsInVzZXJzLXJlYWQiXSwianRpIjoiMjYxYTZhYWQ2MTQ5Njk1ZmJiYzcwODM5MjM0Njc1NWQifQ.dA5-HVzWv-BRfEiAd24uNBiBxASO-PAyWeWESovZm_hj4aXMAZA1-bWNZeXt88dqogo18AwpDQ-h6gefLPdZSFrG5umC1dVWaeYvUnGm62g4XS29fj6p01dhKNNqrsu5KrhnhdnKYVv9VdmbmqDfWR8wDgglk5cJFqalzq6dJWJInFQEPmUs9BW_Zs8tQDn-i5r4tYq2U8vCdqptXoM7YgPllXaPVDeccC9QNu2Xlp9WUvoROzoQXg25lFub1IYkTrM66gJ6t9fJRZToewCt495WNEOQFa_rwLCZ1QwzvL0iYkONHS_jZ0BOhBCdW9dWSawD6iF1SIQaFROvMDH1rg";

/** Freshness window for a candle series. */
export const CHART_TTL_MS = 60_000;

/** Freshness window for a volume profile. */
export const DEPTH_TTL_MS = 60_000;

/** Freshness window for the community feed; upstream is slow and chatty. */
export const FEED_TTL_MS = 60_000;

/** Freshness window for a quote batch, matching the upstream update rate. */
export const QUOTE_TTL_MS = 3000;

/** Freshness window for the index basket. */
export const INDEX_TTL_MS = 3000;

/** How long a stale payload may still be served while upstream recovers. */
export const STALE_TTL_MS = 5 * 60 * 1000;

/** Upper bound for one upstream request. */
export const UPSTREAM_TIMEOUT_MS = 4000;

/** Requests allowed per client IP inside one window. */
export const RATE_CAPACITY = 30;

/** Length of the rate-limit window. */
export const RATE_WINDOW_MS = 10_000;

/** Longest a cached entry may live in the platform cache. */
const CACHE_MAX_AGE_SECONDS = 300;

/** Dependency seam so tests can replace the network, cache and clock. */
export interface MarketDeps {
  /** Performs one upstream request. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Platform cache, or `null` when the runtime has none. */
  cache: Pick<Cache, "match" | "put"> | null;
  /** Current epoch milliseconds. */
  now: () => number;
}

/** One cached payload plus when it was stored. */
interface CacheEntry<T> {
  storedAt: number;
  payload: T;
}

/** Per-isolate cache: the platform cache is shared, this one is free to read. */
const memory = new Map<string, CacheEntry<unknown>>();

/**
 * @brief Drops the per-isolate cache. Test seam; production never calls it.
 */
export function resetMarketCache(): void {
  memory.clear();
}

/** Per-IP request windows for the best-effort rate limit. */
const windows = new Map<string, { start: number; count: number }>();

/**
 * @brief Builds the runtime dependencies for the proxy routes.
 * @return The dependencies bound to the platform `fetch`, cache and clock.
 */
export function marketDeps(): MarketDeps {
  let cache: MarketDeps["cache"] = null;
  try {
    cache = (caches as unknown as { default?: Cache }).default ?? null;
  } catch {
    // A runtime without the Cache API still works through the isolate map.
    cache = null;
  }
  return { fetch: (input, init) => fetch(input, init), cache, now: () => Date.now() };
}

/**
 * @brief Reads one cache entry, preferring the isolate map.
 * @param deps Runtime dependencies.
 * @param key Cache key (an absolute URL string).
 * @return The entry, or `null` when absent or unreadable.
 */
async function readEntry<T>(deps: MarketDeps, key: string): Promise<CacheEntry<T> | null> {
  const local = memory.get(key);
  if (local !== undefined) return local as CacheEntry<T>;
  if (deps.cache === null) return null;

  try {
    const response = await deps.cache.match(key);
    if (response === undefined || response === null) return null;
    const entry = (await response.json()) as CacheEntry<T>;
    if (typeof entry.storedAt !== "number") return null;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

/**
 * @brief Stores one cache entry in both layers.
 * @param deps Runtime dependencies.
 * @param key Cache key.
 * @param entry Entry to store.
 * @return Resolves once the platform cache write was attempted.
 */
async function writeEntry<T>(deps: MarketDeps, key: string, entry: CacheEntry<T>): Promise<void> {
  memory.set(key, entry);
  if (deps.cache === null) return;

  try {
    await deps.cache.put(
      key,
      new Response(JSON.stringify(entry), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `max-age=${CACHE_MAX_AGE_SECONDS}`,
        },
      }),
    );
  } catch {
    // Cache writes are an optimization; a failure must not fail the request.
  }
}

/**
 * @brief Serves a cached payload, refreshing it when it is older than the TTL.
 * @param deps Runtime dependencies.
 * @param key Cache key.
 * @param ttlMs Freshness window.
 * @param loadUpstream Loader for a fresh payload; `null` means "no usable data".
 * @param isUsable Optional guard so an empty cached list is treated as a miss.
 * @return The payload plus whether it is stale, or `null` when nothing is left.
 */
async function load<T>(
  deps: MarketDeps,
  key: string,
  ttlMs: number,
  loadUpstream: () => Promise<T | null>,
  isUsable: (payload: T) => boolean = () => true,
): Promise<{ payload: T; stale: boolean } | null> {
  const stored = await readEntry<T>(deps, key);
  const cached = stored !== null && isUsable(stored.payload) ? stored : null;
  const now = deps.now();
  if (cached !== null && now - cached.storedAt < ttlMs) {
    return { payload: cached.payload, stale: false };
  }

  try {
    const payload = await loadUpstream();
    if (payload !== null) {
      await writeEntry(deps, key, { storedAt: now, payload });
      return { payload, stale: false };
    }
  } catch {
    // Fall through to the stale payload below.
  }

  if (cached !== null && now - cached.storedAt < STALE_TTL_MS) {
    return { payload: cached.payload, stale: true };
  }
  return null;
}

/**
 * @brief Fetches one upstream URL, bounded by the timeout.
 * @param deps Runtime dependencies.
 * @param url Absolute upstream URL.
 * @param headers Extra request headers.
 * @return The upstream response.
 * @throws When the request fails, times out, or the response is not ok.
 */
async function request(
  deps: MarketDeps,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await deps.fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json", ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @brief Fetches one upstream URL as JSON.
 * @param deps Runtime dependencies.
 * @param url Absolute upstream URL.
 * @param headers Extra request headers.
 * @return The decoded JSON value.
 * @throws When the request fails or the body is not JSON.
 */
async function getJson(
  deps: MarketDeps,
  url: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  return (await request(deps, url, headers)).json();
}

/**
 * @brief Rounds to two decimals.
 * @param value Raw number.
 * @return The value rounded to two decimals.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * @brief Builds one quote from an Entrade daily candle series.
 * @details The VPS datafeed refuses Cloudflare egress in production, so quotes
 * fall back to Entrade: the last close becomes the matched price, the previous
 * close the reference, and the ceiling/floor are the ±7% band. Bid/ask depth is
 * simply absent in this mode.
 * @param symbol Ticker or index.
 * @param deps Runtime dependencies.
 * @return The derived quote, or `null` when the series is unusable.
 */
async function entradeQuote(symbol: string, deps: MarketDeps): Promise<Quote | null> {
  const kind = isIndexTicker(symbol) ? "index" : "stock";
  const nowSeconds = Math.floor(deps.now() / 1000);
  const payload = await getJson(
    deps,
    `${ENTARDE_BASE}/${kind}?symbol=${symbol}&from=${nowSeconds - 86_400 * 30}&to=${nowSeconds}&resolution=1D`,
  );
  const candles = parseChart(payload, symbol, "1D").candles;
  if (candles.length === 0) return null;

  const last = candles[candles.length - 1]!;
  const previous = candles[candles.length - 2];
  const ref = previous?.close ?? last.close;
  const change = round2(last.close - ref);

  return {
    symbol,
    ref: round2(ref),
    ceiling: round2(ref * 1.07),
    floor: round2(ref * 0.93),
    last: round2(last.close),
    avg: 0,
    high: round2(last.high),
    low: round2(last.low),
    change,
    changePercent: ref > 0 ? round2((change / ref) * 100) : 0,
    volume: last.volume,
    foreignBuy: 0,
    foreignRoom: 0,
    side: "",
    bids: [],
    asks: [],
  };
}

/**
 * @brief Loads a quote batch from Entrade, one request per symbol.
 * @param symbols Tickers to load.
 * @param deps Runtime dependencies.
 * @return The quotes that loaded; empty when every symbol failed.
 */
async function entradeQuotes(symbols: string[], deps: MarketDeps): Promise<Quote[]> {
  const settled = await Promise.allSettled(symbols.map((symbol) => entradeQuote(symbol, deps)));
  const quotes: Quote[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value !== null) quotes.push(result.value);
  }
  return quotes;
}

/** Entrade tickers for the index ids the UI shows. */
const ENTARDE_INDEX_SYMBOLS: Record<string, string> = {
  "10": "VNINDEX",
  "11": "VN30",
  "02": "HNX",
  "03": "UPCOM",
};

/**
 * @brief Loads the index basket from Entrade, one request per index.
 * @param deps Runtime dependencies.
 * @return The indices that loaded; empty when every index failed.
 */
async function entradeIndices(deps: MarketDeps): Promise<MarketIndex[]> {
  const keys = [...INDEX_KEYS];
  const settled = await Promise.allSettled(
    keys.map((key) => entradeQuote(ENTARDE_INDEX_SYMBOLS[key] ?? key, deps)),
  );

  const indices: MarketIndex[] = [];
  settled.forEach((result, index) => {
    const key = keys[index];
    if (key === undefined || result.status !== "fulfilled" || result.value === null) return;
    indices.push({
      key,
      name: key === "10" ? "VN-INDEX" : key === "11" ? "VN30" : key === "02" ? "HNX" : "UPCOM",
      value: result.value.last,
      change: result.value.change,
      changePercent: result.value.changePercent,
    });
  });
  return indices;
}

/**
 * @brief Answers `GET /api/market/quotes`.
 * @details Tries the VPS datafeed first (three-tier depth) and falls back to
 * Entrade daily candles when VPS is unreachable, which is the case from
 * Cloudflare's egress.
 * @param rawSymbols Raw `symbols` query value.
 * @param deps Runtime dependencies.
 * @return A JSON response with a {@link QuotesPayload}, or an error code.
 */
export async function quotesResponse(rawSymbols: string | null, deps: MarketDeps): Promise<Response> {
  const symbols = parseSymbolList(rawSymbols);
  if (symbols === null) return json({ code: "BAD_SYMBOLS" }, 400);

  const key = `https://market.cache/quotes/${symbols.join(",")}`;
  const loaded = await load<Quote[]>(
    deps,
    key,
    QUOTE_TTL_MS,
    async () => {
      try {
        const payload = await getJson(deps, `${VPS_BASE}/getliststockdata/${symbols.join(",")}`);
        const quotes = parseQuotes(payload);
        if (quotes.length > 0) return quotes;
      } catch {
        // Fall through to the Entrade snapshot below.
      }

      const fallback = await entradeQuotes(symbols, deps);
      return fallback.length > 0 ? fallback : null;
    },
    (quotes) => quotes.length > 0,
  );

  if (loaded === null) return json({ code: "UPSTREAM_UNAVAILABLE" }, 502);

  const body: QuotesPayload = { quotes: loaded.payload, stale: loaded.stale, ts: deps.now() };
  return json(body);
}

/**
 * @brief Answers `GET /api/market/indices`.
 * @param deps Runtime dependencies.
 * @return A JSON response with an {@link IndicesPayload}, or an error code.
 */
export async function indicesResponse(deps: MarketDeps): Promise<Response> {
  const key = "https://market.cache/indices";
  const loaded = await load<MarketIndex[]>(
    deps,
    key,
    INDEX_TTL_MS,
    async () => {
      try {
        const payload = await getJson(deps, `${VPS_BASE}/getlistindexdetail/${INDEX_KEYS.join(",")}`);
        const indices = parseIndices(payload);
        if (indices.length > 0) return indices;
      } catch {
        // Fall through to the Entrade snapshot below.
      }

      const fallback = await entradeIndices(deps);
      return fallback.length > 0 ? fallback : null;
    },
    (indices) => indices.length > 0,
  );

  if (loaded === null) return json({ code: "UPSTREAM_UNAVAILABLE" }, 502);

  const body: IndicesPayload = { indices: loaded.payload, stale: loaded.stale, ts: deps.now() };
  return json(body);
}

/**
 * @brief Consumes one request from the per-IP window.
 * @details Best effort: isolate memory only, which is enough to keep one
 * misbehaving tab from hammering the upstreams. Shared limiting would need a
 * Durable Object and is not worth it for a public read-only feed.
 * @param ip Client IP, or a stable placeholder when the runtime has none.
 * @param now Current epoch milliseconds.
 * @return Whether the request may proceed.
 */
export function takeRate(ip: string, now: number): boolean {
  const current = windows.get(ip);
  if (current === undefined || now - current.start >= RATE_WINDOW_MS) {
    if (windows.size > 1024) {
      for (const [key, window] of windows) {
        if (now - window.start >= RATE_WINDOW_MS) windows.delete(key);
      }
    }
    windows.set(ip, { start: now, count: 1 });
    return true;
  }

  current.count += 1;
  return current.count <= RATE_CAPACITY;
}

/** FireAnt bearer token cached for the isolate, plus its expiry. */
let fireantToken: { value: string; expiresAt: number } = { value: "", expiresAt: 0 };

/**
 * @brief Reads the `__NEXT_DATA__` blob embedded in a FireAnt page.
 * @param html Page HTML.
 * @return The decoded JSON blob, or `null` when the page has none.
 */
function nextData(html: string): unknown {
  const marker = html.indexOf("__NEXT_DATA__");
  if (marker === -1) return null;

  const open = html.indexOf(">", marker);
  const close = html.indexOf("</script>", open);
  if (open === -1 || close === -1) return null;

  try {
    return JSON.parse(html.slice(open + 1, close));
  } catch {
    return null;
  }
}

/**
 * @brief Resolves the FireAnt bearer token, refreshing it from the page when stale.
 * @details The public token rotates; the page carries the current one inside its
 * Next.js state. When the scrape fails the last known public token is used so
 * the feed still answers.
 * @param deps Runtime dependencies.
 * @return The bearer token, possibly empty.
 */
async function getFireantToken(deps: MarketDeps): Promise<string> {
  const now = deps.now();
  if (fireantToken.value.length > 0 && fireantToken.expiresAt > now) return fireantToken.value;

  try {
    const html = await (await request(deps, `${FIREANT_PAGE}/FPT`, { accept: "text/html" })).text();
    const data = nextData(html) as { props?: { initialState?: { auth?: { accessToken?: unknown } } } } | null;
    const token = data?.props?.initialState?.auth?.accessToken;
    if (typeof token === "string" && token.length > 0) {
      fireantToken = { value: token, expiresAt: now + 2 * 60 * 60 * 1000 };
      return token;
    }
  } catch {
    // Fall back to the public token below.
  }

  fireantToken = { value: FIREANT_ANON_TOKEN, expiresAt: now + 5 * 60 * 1000 };
  return FIREANT_ANON_TOKEN;
}

/** One community page: its items and the pagination it came from. */
interface FeedPage {
  items: FeedItem[];
  page: number;
  maxPage: number;
}

/**
 * @brief Loads the FireAnt posts and the replies of the busiest threads.
 * @param symbol Symbol to load.
 * @param deps Runtime dependencies.
 * @return The page, or `null` when upstream returned nothing usable.
 */
async function loadFireAnt(symbol: string, deps: MarketDeps): Promise<FeedPage | null> {
  const token = await getFireantToken(deps);
  const headers = { authorization: `Bearer ${token}` };
  const raw = await getJson(
    deps,
    `${FIREANT_BASE}/symbols/${encodeURIComponent(symbol)}/posts?offset=0&limit=40`,
    headers,
  );
  const items = parseFireAntPosts(raw, symbol);
  if (!Array.isArray(raw)) return items.length > 0 ? { items, page: 1, maxPage: 1 } : null;

  const threads = raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .filter((entry) => Number(entry.totalReplies ?? 0) > 0 && entry.postID !== undefined)
    .slice(0, 4);

  for (const thread of threads) {
    const postId = String(thread.postID);
    try {
      const replies = await getJson(
        deps,
        `${FIREANT_BASE}/posts/${encodeURIComponent(postId)}/replies`,
        headers,
      );
      if (!Array.isArray(replies)) continue;
      for (const reply of replies.slice(0, 5)) {
        const item = makeFireAntReply(reply, symbol, postId);
        if (item !== null) items.push(item);
      }
    } catch {
      // One dead thread must not empty the whole feed.
    }
  }

  return items.length > 0 ? { items: items.slice(0, 80), page: 1, maxPage: 1 } : null;
}

/**
 * @brief Loads the F247 search results for one symbol.
 * @param symbol Symbol to load.
 * @param deps Runtime dependencies.
 * @return The page, or `null` when upstream returned nothing usable.
 */
async function loadF247(symbol: string, deps: MarketDeps): Promise<FeedPage | null> {
  const raw = await getJson(deps, `${F247_SEARCH}${encodeURIComponent(symbol)}`);
  const items = parseF247Posts(raw);
  return items.length > 0 ? { items, page: 1, maxPage: 1 } : null;
}

/**
 * @brief Scrapes one VOZ thread page with the streaming HTML rewriter.
 * @param response Upstream page response; its body is consumed.
 * @param page Page number the articles are attributed to.
 * @return The feed items found on the page.
 */
async function scrapeVoz(response: Response, page: number): Promise<FeedItem[]> {
  interface Draft {
    author: string;
    createdAt: string;
    text: string;
  }

  const drafts: Draft[] = [];
  let current: Draft | null = null;

  const rewriter = new HTMLRewriter()
    .on("article[data-author]", {
      element(element) {
        const draft: Draft = {
          author: element.getAttribute("data-author") ?? "",
          createdAt: "",
          text: "",
        };
        current = draft;
        element.onEndTag(() => {
          drafts.push(draft);
        });
      },
    })
    .on("article[data-author] .bbWrapper", {
      text(text) {
        if (current !== null) current.text += text.text;
      },
    })
    .on("article[data-author] time[datetime]", {
      element(element) {
        if (current !== null) current.createdAt = element.getAttribute("datetime") ?? "";
      },
    });

  await rewriter.transform(response).text();

  const items: FeedItem[] = [];
  drafts.forEach((draft, index) => {
    const item = makeVozItem(draft.author, draft.text, draft.createdAt, index, page);
    if (item !== null) items.push(item);
  });
  return items;
}

/**
 * @brief Loads one VOZ thread page.
 * @details Page `0` asks for the last page; the redirect target tells us which
 * page that was, so pagination can continue backwards from there.
 * @param page Requested page, or `0` for the latest.
 * @param deps Runtime dependencies.
 * @return The page, or `null` when the scrape found nothing.
 */
async function loadVoz(page: number, deps: MarketDeps): Promise<FeedPage | null> {
  const requested = page > 0 ? page : 99999;
  const response = await request(deps, `${VOZ_THREAD}${requested}`, { accept: "text/html" });
  const match = /page-(\d+)/.exec(response.url);
  const actualPage = match !== null ? Number(match[1]) : page > 0 ? page : 1;
  const items = await scrapeVoz(response, actualPage);
  return items.length > 0 ? { items, page: actualPage, maxPage: actualPage } : null;
}

/**
 * @brief Answers `GET /api/market/chart`.
 * @param rawSymbol Raw `symbol` query value.
 * @param rawResolution Raw `resolution` query value.
 * @param deps Runtime dependencies.
 * @return A JSON response with a {@link ChartPayload}, or an error code.
 */
export async function chartResponse(
  rawSymbol: string | null,
  rawResolution: string | null,
  deps: MarketDeps,
): Promise<Response> {
  const symbol = parseOneSymbol(rawSymbol);
  if (symbol === null) return json({ code: "BAD_SYMBOL" }, 400);

  const resolution = parseResolution(rawResolution);
  const kind = isIndexTicker(symbol) ? "index" : "stock";
  const nowSeconds = Math.floor(deps.now() / 1000);
  const windowSeconds = resolution === "1D" ? 86_400 * 180 : 86_400 * 5;
  const key = `https://market.cache/chart/${kind}/${symbol}/${resolution}`;

  const loaded = await load<Candle[]>(
    deps,
    key,
    CHART_TTL_MS,
    async () => {
      const payload = await getJson(
        deps,
        `${ENTARDE_BASE}/${kind}?symbol=${symbol}&from=${nowSeconds - windowSeconds}&to=${nowSeconds}&resolution=${resolution}`,
      );
      const chart = parseChart(payload, symbol, resolution);
      return chart.candles.length > 0 ? chart.candles : null;
    },
    (candles) => candles.length > 0,
  );

  if (loaded === null) return json({ code: "UPSTREAM_UNAVAILABLE" }, 502);

  const body: ChartPayload = { symbol, resolution, candles: loaded.payload, ts: deps.now() };
  return json(body);
}

/**
 * @brief Answers `GET /api/market/depth` with a volume profile.
 * @param rawSymbol Raw `symbol` query value.
 * @param deps Runtime dependencies.
 * @return A JSON response with a {@link DepthPayload}, or an error code.
 */
export async function depthResponse(rawSymbol: string | null, deps: MarketDeps): Promise<Response> {
  const symbol = parseOneSymbol(rawSymbol);
  if (symbol === null) return json({ code: "BAD_SYMBOL" }, 400);

  const kind = isIndexTicker(symbol) ? "index" : "stock";
  const nowSeconds = Math.floor(deps.now() / 1000);
  const key = `https://market.cache/depth/${kind}/${symbol}`;

  const loaded = await load<DepthLevel[]>(
    deps,
    key,
    DEPTH_TTL_MS,
    async () => {
      const payload = await getJson(
        deps,
        `${ENTARDE_BASE}/${kind}?symbol=${symbol}&from=${nowSeconds - 86_400}&to=${nowSeconds}&resolution=1`,
      );
      const depth = parseDepthProfile(payload, symbol);
      return depth.levels.length > 0 ? depth.levels : null;
    },
    (levels) => levels.length > 0,
  );

  if (loaded === null) return json({ code: "UPSTREAM_UNAVAILABLE" }, 502);

  const totalVolume = loaded.payload.reduce((sum, level) => sum + level.volume, 0);
  const body: DepthPayload = { symbol, totalVolume, levels: loaded.payload, ts: deps.now() };
  return json(body);
}

/**
 * @brief Answers `GET /api/market/feed`.
 * @param rawSymbol Raw `symbol` query value.
 * @param rawSource Raw `source` query value.
 * @param rawPage Raw `page` query value.
 * @param deps Runtime dependencies.
 * @return A JSON response with a {@link FeedPayload}, or an error code.
 */
export async function feedResponse(
  rawSymbol: string | null,
  rawSource: string | null,
  rawPage: string | null,
  deps: MarketDeps,
): Promise<Response> {
  const symbol = parseOneSymbol(rawSymbol);
  if (symbol === null) return json({ code: "BAD_SYMBOL" }, 400);

  const source = parseFeedSource(rawSource);
  if (source === null) return json({ code: "BAD_SOURCE" }, 400);

  const requestedPage = rawPage !== null && /^\d{1,5}$/.test(rawPage.trim()) ? Number(rawPage.trim()) : 0;
  const key = `https://market.cache/feed/${source}/${symbol}/${requestedPage}`;

  const loaded = await load<FeedPage>(
    deps,
    key,
    FEED_TTL_MS,
    async () => {
      if (source === "fireant") return loadFireAnt(symbol, deps);
      if (source === "f247") return loadF247(symbol, deps);
      return loadVoz(requestedPage, deps);
    },
    (page) => page.items.length > 0,
  );

  if (loaded === null) return json({ code: "UPSTREAM_UNAVAILABLE" }, 502);

  const body: FeedPayload = {
    symbol,
    source,
    items: loaded.payload.items,
    page: loaded.payload.page,
    maxPage: loaded.payload.maxPage,
    ts: deps.now(),
  };
  return json(body);
}
