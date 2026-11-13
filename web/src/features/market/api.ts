/**
 * @file api.ts
 * @brief Browser client for the Worker market proxy.
 * @details The Worker normalizes the undocumented upstream payloads, so this
 * layer only performs the request and rejects bodies that do not match the
 * shared contract. A rejected request surfaces as {@link MarketApiError} so the
 * board can tell a dead upstream from a bad payload.
 */

import type { IndicesPayload, QuotesPayload } from "@dyno/shared/market";

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
