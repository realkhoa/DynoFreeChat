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
  parseIndices,
  parseQuotes,
  parseSymbolList,
  type IndicesPayload,
  type MarketIndex,
  type Quote,
  type QuotesPayload,
} from "@dyno/shared/market";
import { json } from "./http";

/** VPS datafeed origin: quotes, index levels and three-tier depth. */
export const VPS_BASE = "https://bgapidatafeed.vps.com.vn";

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
 * @brief Fetches one upstream URL as JSON, bounded by the timeout.
 * @param deps Runtime dependencies.
 * @param url Absolute upstream URL.
 * @return The decoded JSON value.
 * @throws When the request fails, times out, or the response is not ok.
 */
async function getJson(deps: MarketDeps, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await deps.fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @brief Answers `GET /api/market/quotes`.
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
      const payload = await getJson(deps, `${VPS_BASE}/getliststockdata/${symbols.join(",")}`);
      const quotes = parseQuotes(payload);
      return quotes.length > 0 ? quotes : null;
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
      const payload = await getJson(deps, `${VPS_BASE}/getlistindexdetail/${INDEX_KEYS.join(",")}`);
      const indices = parseIndices(payload);
      return indices.length > 0 ? indices : null;
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
