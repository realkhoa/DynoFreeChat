/**
 * @file api.ts
 * @brief Browser client for the Worker market proxy.
 * @details The Worker normalizes the undocumented upstream payloads, so this
 * layer only performs the request and rejects bodies that do not match the
 * shared contract. A rejected request surfaces as {@link MarketApiError} so the
 * board can tell a dead upstream from a bad payload.
 */

import type {
  ChartPayload,
  DepthPayload,
  FeedPayload,
  FeedSource,
  IndicesPayload,
  QuotesPayload,
} from "@dyno/shared/market";

/** Error raised by the market client; `code` is stable enough to branch on. */
export class MarketApiError extends Error {
  /**
   * @param code Machine readable reason, e.g. `UPSTREAM_UNAVAILABLE`.
   * @param message Human readable detail for the status line.
   */
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MarketApiError";
  }
}

/**
 * @brief Typed access to `/api/market/*`.
 */
export class MarketApi {
  /**
   * @param base Worker origin, e.g. `https://dyno.example.com`.
   * @param fetchImpl Fetch implementation; tests replace it.
   */
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  /**
   * @brief Fetches one quote batch.
   * @param symbols Tickers to request, already validated and upper case.
   * @return The normalized batch.
   * @throws {MarketApiError} When the proxy fails or the body is malformed.
   */
  async quotes(symbols: string[]): Promise<QuotesPayload> {
    const query = symbols.map((symbol) => encodeURIComponent(symbol)).join(",");
    const body = await this.get(`/api/market/quotes?symbols=${query}`);

    if (!Array.isArray(body.quotes)) throw new MarketApiError("BAD_PAYLOAD", "quote batch is malformed");
    return {
      quotes: body.quotes as QuotesPayload["quotes"],
      stale: body.stale === true,
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
    };
  }

  /**
   * @brief Fetches the index basket.
   * @return The normalized basket.
   * @throws {MarketApiError} When the proxy fails or the body is malformed.
   */
  async indices(): Promise<IndicesPayload> {
    const body = await this.get("/api/market/indices");

    if (!Array.isArray(body.indices)) throw new MarketApiError("BAD_PAYLOAD", "index basket is malformed");
    return {
      indices: body.indices as IndicesPayload["indices"],
      stale: body.stale === true,
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
    };
  }

  /**
   * @brief Fetches a candle series.
   * @param symbol Ticker or index.
   * @param resolution One of `1`, `5`, `15`, `1D`.
   * @return The normalized candle series.
   * @throws {MarketApiError} When the proxy fails or the body is malformed.
   */
  async chart(symbol: string, resolution: string): Promise<ChartPayload> {
    const body = await this.get(
      `/api/market/chart?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}`,
    );

    if (!Array.isArray(body.candles)) throw new MarketApiError("BAD_PAYLOAD", "candle series is malformed");
    return {
      symbol: typeof body.symbol === "string" ? body.symbol : symbol,
      resolution: typeof body.resolution === "string" ? body.resolution : resolution,
      candles: body.candles as ChartPayload["candles"],
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
    };
  }

  /**
   * @brief Fetches the volume profile of one symbol.
   * @param symbol Ticker or index.
   * @return The normalized profile.
   * @throws {MarketApiError} When the proxy fails or the body is malformed.
   */
  async depth(symbol: string): Promise<DepthPayload> {
    const body = await this.get(`/api/market/depth?symbol=${encodeURIComponent(symbol)}`);

    if (!Array.isArray(body.levels)) throw new MarketApiError("BAD_PAYLOAD", "volume profile is malformed");
    return {
      symbol: typeof body.symbol === "string" ? body.symbol : symbol,
      totalVolume: typeof body.totalVolume === "number" ? body.totalVolume : 0,
      levels: body.levels as DepthPayload["levels"],
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
    };
  }

  /**
   * @brief Fetches one community feed page.
   * @param symbol Ticker to read about.
   * @param source Community source.
   * @param page VOZ page, or `0` for the latest.
   * @return The normalized feed page.
   * @throws {MarketApiError} When the proxy fails or the body is malformed.
   */
  async feed(symbol: string, source: FeedSource, page = 0): Promise<FeedPayload> {
    const body = await this.get(
      `/api/market/feed?symbol=${encodeURIComponent(symbol)}&source=${encodeURIComponent(source)}&page=${page}`,
    );

    if (!Array.isArray(body.items)) throw new MarketApiError("BAD_PAYLOAD", "community feed is malformed");
    return {
      symbol: typeof body.symbol === "string" ? body.symbol : symbol,
      source: typeof body.source === "string" ? body.source : source,
      items: body.items as FeedPayload["items"],
      page: typeof body.page === "number" ? body.page : 1,
      maxPage: typeof body.maxPage === "number" ? body.maxPage : 1,
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
    };
  }

  /**
   * @brief Performs one JSON GET against the proxy.
   * @param path Path including the query string.
   * @return The decoded body as a record.
   * @throws {MarketApiError} When the request fails or the body is not JSON.
   */
  private async get(path: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, { headers: { accept: "application/json" } });
    } catch {
      throw new MarketApiError("NETWORK", "market proxy unreachable");
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      throw new MarketApiError("BAD_PAYLOAD", "market proxy returned no JSON");
    }

    if (!response.ok) {
      const code =
        typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string"
          ? (body as { code: string }).code
          : `HTTP_${response.status}`;
      throw new MarketApiError(code, `market proxy answered ${response.status}`);
    }

    if (typeof body !== "object" || body === null)
      throw new MarketApiError("BAD_PAYLOAD", "market proxy returned junk");
    return body as Record<string, unknown>;
  }
}
