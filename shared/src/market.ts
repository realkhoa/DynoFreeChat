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

/** One OHLCV candle. */
export interface Candle {
  /** Candle open time, epoch milliseconds. */
  time: number;
  /** Opening price. */
  open: number;
  /** Highest price. */
  high: number;
  /** Lowest price. */
  low: number;
  /** Closing price. */
  close: number;
  /** Traded volume in shares. */
  volume: number;
}

/** Response body of `GET /api/market/chart`. */
export interface ChartPayload {
  symbol: string;
  resolution: string;
  candles: Candle[];
  ts: number;
}

/** One price level of the volume profile. */
export interface DepthLevel {
  /** Price the volume traded at. */
  price: number;
  /** Shares matched at this price. */
  volume: number;
  /** Volume relative to the busiest level, in percent. */
  percent: number;
}

/** Response body of `GET /api/market/depth`. */
export interface DepthPayload {
  symbol: string;
  totalVolume: number;
  levels: DepthLevel[];
  ts: number;
}

/** One community post or reply. */
export interface FeedItem {
  /** Stable id across refreshes, e.g. `fa_123` or `voz_4`. */
  id: string;
  /** Upstream label, e.g. `FireAnt` or `VOZ F31`. */
  source: string;
  /** Display name of the poster. */
  author: string;
  /** Upstream timestamp string, kept verbatim for display. */
  createdAt: string;
  /** Post body with HTML stripped and whitespace collapsed. */
  text: string;
  /** Thread title the post belongs to. */
  topic: string;
  /** Upstream like count. */
  likes: number;
  /** Upstream reply count. */
  replies: number;
  /** Absolute page the post can be read on. */
  url: string;
}

/** Response body of `GET /api/market/feed`. */
export interface FeedPayload {
  symbol: string;
  source: string;
  items: FeedItem[];
  page: number;
  maxPage: number;
  ts: number;
}

/** Community sources the proxy can fetch. */
export const FEED_SOURCES = ["fireant", "voz", "f247"] as const;

/** One community source. */
export type FeedSource = (typeof FEED_SOURCES)[number];

/** Resolutions the chart endpoint accepts. */
export const CHART_RESOLUTIONS = ["1", "5", "15", "1D"] as const;

/** Index tickers Entrade serves from its index endpoint. */
const INDEX_TICKERS = new Set(["VNINDEX", "VN30", "HNX", "UPCOM"]);

/**
 * @brief Parses the `source` query value.
 * @param raw Raw query value.
 * @return The source, or `null` when unsupported.
 */
export function parseFeedSource(raw: string | null): FeedSource | null {
  if (raw === null) return "fireant";
  const source = raw.trim().toLowerCase();
  return (FEED_SOURCES as readonly string[]).includes(source) ? (source as FeedSource) : null;
}

/**
 * @brief Parses the `resolution` query value.
 * @param raw Raw query value.
 * @return A supported resolution, defaulting to daily.
 */
export function parseResolution(raw: string | null): string {
  if (raw === null) return "1D";
  const resolution = raw.trim();
  return (CHART_RESOLUTIONS as readonly string[]).includes(resolution) ? resolution : "1D";
}

/**
 * @brief Validates one ticker or index symbol from a query value.
 * @param raw Raw query value.
 * @return The upper-case symbol, or `null` when invalid.
 */
export function parseOneSymbol(raw: string | null): string | null {
  if (raw === null) return null;
  const symbol = raw.trim().toUpperCase();
  if (SYMBOL_PATTERN.test(symbol)) return symbol;
  return INDEX_TICKERS.has(symbol) ? symbol : null;
}

/**
 * @brief Whether a symbol must be requested from Entrade's index endpoint.
 * @param symbol Upper-case symbol.
 * @return True for the four index tickers.
 */
export function isIndexTicker(symbol: string): boolean {
  return INDEX_TICKERS.has(symbol);
}

/**
 * @brief Strips tags and decodes the entities the feeds actually emit.
 * @param raw HTML fragment.
 * @return Collapsed plain text.
 */
export function stripTags(raw: string): string {
  const withoutTags = raw.replace(/<[^>]*>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    });
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * @brief Normalizes an Entrade OHLC response.
 * @details Entrade answers with parallel arrays (`t`,`o`,`h`,`l`,`c`,`v`) whose
 * lengths can disagree when a bar is incomplete, so only aligned entries that
 * carry a finite close survive.
 * @param raw Raw upstream payload.
 * @param symbol Symbol the payload belongs to.
 * @param resolution Resolution the payload was requested at.
 * @return The normalized chart payload.
 */
export function parseChart(raw: unknown, symbol: string, resolution: string): ChartPayload {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const times = Array.isArray(record.t) ? record.t : [];
  const opens = Array.isArray(record.o) ? record.o : [];
  const highs = Array.isArray(record.h) ? record.h : [];
  const lows = Array.isArray(record.l) ? record.l : [];
  const closes = Array.isArray(record.c) ? record.c : [];
  const volumes = Array.isArray(record.v) ? record.v : [];

  const count = Math.min(times.length, opens.length, highs.length, lows.length, closes.length);
  const candles: Candle[] = [];
  for (let index = 0; index < count; index += 1) {
    const close = num(closes[index]);
    const open = num(opens[index]);
    if (close <= 0 && open <= 0) continue;

    const rawTime = num(times[index]);
    const time = rawTime < 1_000_000_000_000 ? rawTime * 1000 : rawTime;
    candles.push({
      time,
      open,
      high: num(highs[index]) || Math.max(open, close),
      low: num(lows[index]) || Math.min(open, close),
      close,
      volume: num(volumes[index]),
    });
  }

  return { symbol, resolution, candles, ts: Date.now() };
}

/**
 * @brief Builds a volume profile from one-minute candles.
 * @details Every candle contributes its volume to the bucket of its close price;
 * the busiest bucket becomes 100 percent.
 * @param raw Raw Entrade OHLC payload (resolution `1`).
 * @param symbol Symbol the payload belongs to.
 * @return The normalized profile, heaviest price first.
 */
export function parseDepthProfile(raw: unknown, symbol: string): DepthPayload {
  const chart = parseChart(raw, symbol, "1");
  const buckets = new Map<number, number>();
  let totalVolume = 0;

  for (const candle of chart.candles) {
    const price = round2(candle.close);
    buckets.set(price, (buckets.get(price) ?? 0) + candle.volume);
    totalVolume += candle.volume;
  }

  const maxVolume = Math.max(0, ...buckets.values());
  const levels: DepthLevel[] = [...buckets.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([price, volume]) => ({
      price,
      volume,
      percent: maxVolume > 0 ? round2((volume / maxVolume) * 100) : 0,
    }));

  return { symbol, totalVolume, levels, ts: Date.now() };
}

/**
 * @brief Normalizes FireAnt posts into feed items.
 * @param raw Raw posts payload.
 * @param symbol Symbol the posts were requested for.
 * @return The normalized items, newest first as upstream returns them.
 */
export function parseFireAntPosts(raw: unknown, symbol: string): FeedItem[] {
  if (!Array.isArray(raw)) return [];

  const items: FeedItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const post = entry as Record<string, unknown>;
    const postId = post.postID;
    const user = post.user;
    const author =
      typeof user === "object" && user !== null
        ? String((user as Record<string, unknown>).name ?? "FireAnt User")
        : String(post.userName ?? "FireAnt User");

    const title = stripTags(String(post.title ?? ""));
    const content = stripTags(String(post.content ?? post.description ?? ""));
    const text = title.length > 0 && !content.includes(title) ? `${title}. ${content}` : title || content;
    if (text.length === 0) continue;

    items.push({
      id: `fa_${String(postId ?? items.length)}`,
      source: "FireAnt",
      author,
      createdAt: String(post.date ?? post.createdDate ?? ""),
      text,
      topic: `FireAnt: Thảo luận $${symbol}`,
      likes: num(post.totalLikes ?? post.likeCount),
      replies: num(post.totalReplies),
      url: `https://fireant.vn/ma-chung-khoan/${symbol}`,
    });
  }
  return items;
}

/**
 * @brief Normalizes F247 search results into feed items.
 * @param raw Raw `search.json` payload.
 * @return The normalized items.
 */
export function parseF247Posts(raw: unknown): FeedItem[] {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const posts = Array.isArray(record.posts) ? record.posts : [];
  const topics = Array.isArray(record.topics) ? record.topics : [];

  const titles = new Map<number, string>();
  for (const topic of topics) {
    if (typeof topic !== "object" || topic === null) continue;
    const entry = topic as Record<string, unknown>;
    titles.set(num(entry.id), String(entry.title ?? ""));
  }

  const items: FeedItem[] = [];
  for (const entry of posts) {
    if (typeof entry !== "object" || entry === null) continue;
    const post = entry as Record<string, unknown>;
    const text = stripTags(String(post.blurb ?? ""));
    if (text.length === 0) continue;

    items.push({
      id: `f247_${String(post.id ?? items.length)}`,
      source: "F247",
      author: String(post.username ?? "Trader"),
      createdAt: String(post.created_at ?? ""),
      text,
      topic: titles.get(num(post.topic_id)) ?? "",
      likes: num(post.like_count),
      replies: 0,
      url: `https://f247.com/post/${String(post.id ?? "")}`,
    });
  }
  return items;
}

/**
 * @brief Builds a feed item from one FireAnt reply.
 * @param raw Raw reply payload.
 * @param symbol Symbol the thread belongs to.
 * @param postId Thread id the reply answers.
 * @return The feed item, or `null` when the body is empty.
 */
export function makeFireAntReply(raw: unknown, symbol: string, postId: string): FeedItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const reply = raw as Record<string, unknown>;
  const user = reply.user;
  const author =
    typeof user === "object" && user !== null
      ? String((user as Record<string, unknown>).name ?? "FireAnt Member")
      : String(reply.userName ?? "FireAnt Member");
  const text = stripTags(String(reply.content ?? reply.description ?? ""));
  if (text.length === 0) return null;

  return {
    id: `fa_reply_${String(reply.postID ?? postId)}`,
    source: "FireAnt",
    author,
    createdAt: String(reply.date ?? ""),
    text: `↳ ${text}`,
    topic: `FireAnt: Thảo luận $${symbol} (Trả lời #${postId})`,
    likes: num(reply.totalLikes),
    replies: 0,
    url: `https://fireant.vn/ma-chung-khoan/${symbol}`,
  };
}

/**
 * @brief Builds a feed item from one scraped VOZ article.
 * @param author Author name from the article attribute.
 * @param text Collapsed post body.
 * @param createdAt ISO timestamp from the `time` element.
 * @param index Position on the page, used for the stable id.
 * @param page VOZ page the article came from.
 * @return The feed item, or `null` when the body is empty.
 */
export function makeVozItem(
  author: string,
  text: string,
  createdAt: string,
  index: number,
  page: number,
): FeedItem | null {
  const body = stripTags(text);
  if (body.length === 0) return null;

  return {
    id: `voz_${page}_${index}`,
    source: "VOZ F31",
    author: author.length > 0 ? author : "VOZ Member",
    createdAt,
    text: body,
    topic: `VOZ: CLB Chứng Khoán (Page ${page})`,
    likes: 0,
    replies: 0,
    url: `https://voz.vn/t/clb-chung-khoan-chia-se-kinh-nghiem-dau-tu-chung-khoan-2026-ky-nguyen-vuon-minh.1188208/page-${page}`,
  };
}
