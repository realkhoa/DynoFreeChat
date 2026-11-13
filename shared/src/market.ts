/**
 * @file market.ts
 * @brief Wire types and defensive normalization for the Vietnamese market feed.
 * @details The Worker proxies three undocumented upstream services: VPS for
 * quotes and index levels, Entrade for candles, FireAnt/voz for the community
 * feed. Their payloads change shape without notice, so every value is parsed
 * here and the browser only ever sees the normalized types below. Keeping the
 * parsing in `shared` gives the Worker and the browser one contract, and makes
 * the rules unit-testable without a network.
 */

/** One price level of the three-tier order book. */
export interface QuoteLevel {
  /** Level price in thousands of VND, e.g. `132.4`. */
  price: number;
  /** Traded volume at this price, in shares. */
  volume: number;
}

/** One symbol snapshot, normalized from the VPS row. */
export interface Quote {
  /** Ticker, upper case, e.g. `FPT`. */
  symbol: string;
  /** Reference price for the session. */
  ref: number;
  /** Ceiling price for the session. */
  ceiling: number;
  /** Floor price for the session. */
  floor: number;
  /** Last matched price; falls back to the reference when nothing matched yet. */
  last: number;
  /** Average matched price. */
  avg: number;
  /** Highest matched price. */
  high: number;
  /** Lowest matched price. */
  low: number;
  /** Absolute change against the reference price. */
  change: number;
  /** Change against the reference price, in percent. */
  changePercent: number;
  /** Total matched volume, in shares. */
  volume: number;
  /** Foreign buy volume, in shares. */
  foreignBuy: number;
  /** Remaining foreign room, in shares. */
  foreignRoom: number;
  /** Upstream trading-status label; empty when the feed omits it. */
  side: string;
  /** Three bid levels, best first. */
  bids: QuoteLevel[];
  /** Three ask levels, best first. */
  asks: QuoteLevel[];
}

/** One market index snapshot. */
export interface MarketIndex {
  /** Upstream index id, e.g. `10`. */
  key: string;
  /** Display name, e.g. `VN-INDEX`. */
  name: string;
  /** Current index value. */
  value: number;
  /** Absolute change against the open. */
  change: number;
  /** Change against the open, in percent. */
  changePercent: number;
}

/** Response body of `GET /api/market/quotes`. */
export interface QuotesPayload {
  quotes: Quote[];
  /** True when the Worker served the last good payload because upstream failed. */
  stale: boolean;
  /** Epoch milliseconds the payload was assembled. */
  ts: number;
}

/** Response body of `GET /api/market/indices`. */
export interface IndicesPayload {
  indices: MarketIndex[];
  /** True when the Worker served the last good payload because upstream failed. */
  stale: boolean;
  /** Epoch milliseconds the payload was assembled. */
  ts: number;
}

/** Index ids the feed publishes, in display order. */
export const INDEX_KEYS = ["10", "11", "02", "03"] as const;

/** Display names per index id; ids outside this map are ignored. */
export const INDEX_NAMES: Record<string, string> = {
  "10": "VN-INDEX",
  "11": "VN30",
  "02": "HNX",
  "03": "UPCOM",
};

/** Largest symbol batch the proxy accepts in one request. */
export const MAX_SYMBOLS = 40;

/** Tickers the feed can serve: short alphanumerics, already upper case. */
export const SYMBOL_PATTERN = /^[A-Z0-9]{1,12}$/;

/**
 * @brief Coerces an upstream value to a finite number.
 * @details Upstream mixes numbers and numeric strings (`"0.45%"`, `"---"`), so
 * anything unparsable becomes `0` instead of `NaN`.
 * @param value Raw upstream value.
 * @return The parsed number, or `0`.
 */
function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @brief Rounds to two decimals without float noise in the payload.
 * @param value Raw number.
 * @return The value rounded to two decimals.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * @brief Reads one VPS order-book slot.
 * @details VPS encodes a level as the string `"price|volume"`; a missing or
 * malformed slot becomes a zeroed level so the three-tier shape never varies.
 * @param raw Raw slot value.
 * @return The normalized level.
 */
export function parseLevel(raw: unknown): QuoteLevel {
  if (typeof raw !== "string" || raw.length === 0) return { price: 0, volume: 0 };
  const [price, volume] = raw.split("|");
  return { price: num(price), volume: num(volume) };
}

/**
 * @brief Normalizes one VPS quote row.
 * @param raw Raw upstream row.
 * @return The quote, or `null` when the row has no usable ticker.
 */
export function parseQuote(raw: unknown): Quote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const symbol = String(record.sym ?? record.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return null;

  const ref = num(record.r ?? record.ref);
  const matched = num(record.lastPrice ?? record.last);
  const last = matched > 0 ? matched : ref;
  const change = round2(last - ref);
  const changePercent = ref > 0 ? round2((change / ref) * 100) : 0;

  return {
    symbol,
    ref,
    ceiling: num(record.c ?? record.ceiling),
    floor: num(record.f ?? record.floor),
    last,
    avg: num(record.avePrice ?? record.avgPrice),
    high: num(record.highPrice ?? record.high),
    low: num(record.lowPrice ?? record.low),
    change,
    changePercent,
    volume: num(record.lot ?? record.totalVolume),
    foreignBuy: num(record.fBVol ?? record.foreignBuy),
    foreignRoom: num(record.fRoom ?? record.foreignRoom),
    side: typeof record.side === "string" ? record.side : "",
    bids: [parseLevel(record.g1), parseLevel(record.g2), parseLevel(record.g3)],
    asks: [parseLevel(record.g4), parseLevel(record.g5), parseLevel(record.g6)],
  };
}

/**
 * @brief Normalizes one VPS index row.
 * @param raw Raw upstream row.
 * @return The index, or `null` for ids the feed adds but the UI does not show.
 */
export function parseIndex(raw: unknown): MarketIndex | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const key = String(record.hashValue ?? record.mc ?? "").trim();
  const name = INDEX_NAMES[key];
  if (name === undefined) return null;

  const open = num(record.oIndex);
  const value = num(record.cIndex ?? record.oIndex ?? record.lastIndex);
  // VPS publishes the session delta as `"change|percent%"`; fall back to the
  // open when a row omits it.
  const ot = typeof record.ot === "string" ? record.ot.split("|") : [];
  const change = ot.length > 0 ? num(ot[0]) : round2(value - open);
  const changePercent = ot.length > 1 ? num(ot[1]) : open > 0 ? round2((change / open) * 100) : 0;

  return { key, name, value: round2(value), change: round2(change), changePercent: round2(changePercent) };
}

/**
 * @brief Normalizes a whole VPS quote list.
 * @param raw Raw upstream payload.
 * @return Every row that parsed, in upstream order.
 */
export function parseQuotes(raw: unknown): Quote[] {
  if (!Array.isArray(raw)) return [];
  const quotes: Quote[] = [];
  for (const row of raw) {
    const quote = parseQuote(row);
    if (quote !== null) quotes.push(quote);
  }
  return quotes;
}

/**
 * @brief Normalizes a whole VPS index list.
 * @param raw Raw upstream payload.
 * @return Known indices in {@link INDEX_KEYS} order.
 */
export function parseIndices(raw: unknown): MarketIndex[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, MarketIndex>();
  for (const row of raw) {
    const index = parseIndex(row);
    if (index !== null && !byKey.has(index.key)) byKey.set(index.key, index);
  }
  return INDEX_KEYS.map((key) => byKey.get(key)).filter((index): index is MarketIndex => index !== undefined);
}

/**
 * @brief Parses and validates a comma separated ticker list.
 * @details The list is deduplicated and upper-cased; one invalid ticker rejects
 * the whole list so the proxy never forwards junk upstream.
 * @param raw Raw query-string value.
 * @return The tickers, or `null` when the list is empty, too long, or invalid.
 */
export function parseSymbolList(raw: string | null): string[] | null {
  if (raw === null) return null;

  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const part of raw.split(",")) {
    const symbol = part.trim().toUpperCase();
    if (symbol.length === 0) continue;
    if (!SYMBOL_PATTERN.test(symbol)) return null;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }

  if (symbols.length === 0 || symbols.length > MAX_SYMBOLS) return null;
  return symbols;
}
