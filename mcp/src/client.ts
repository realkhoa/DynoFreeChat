/**
 * @file client.ts
 * @brief Thin HTTP client for the DynoFreeChat worker API.
 * @details Every call is a normal client request: the worker stays authoritative
 * and the MCP server never predicts an action result. Actions auto-read the
 * current revision unless the caller passes one explicitly.
 */

import type { McpConfig } from "./config.js";
import { isAuthHeader } from "./config.js";

/** JSON object returned by the API. */
export type ApiJson = Record<string, unknown>;

/** One garden action as sent on the wire. */
export interface GardenActionShape {
  /** Action kind, e.g. `harvest` or `water`. */
  readonly kind: string;
  /** Any action-specific fields. */
  readonly [field: string]: unknown;
}

/** Owner state plus season, as returned by `GET /api/garden/state`. */
export interface GardenStateResponse extends ApiJson {
  readonly rev: number;
}

/** Latest revision plus the action result, as returned by `POST /api/garden/act`. */
export interface GardenActResponse extends ApiJson {
  readonly rev: number;
}

/** Error thrown for a non-2xx worker response. */
export class ApiError extends Error {
  /** HTTP status code. */
  readonly status: number;
  /** Error code returned by the worker, when present. */
  readonly code: string | null;
  /** Raw response body for debugging. */
  readonly body: string;

  constructor(status: number, body: string) {
    let code: string | null = null;
    try {
      const parsed = JSON.parse(body) as { code?: unknown };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      code = null;
    }
    super(`DynoFreeChat API ${status}${code === null ? "" : ` (${code})`}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** @brief Mutable auth holder so a restore can upgrade the client in place. */
export interface AuthState {
  /** Current `playerId.token` header value, or `null`. */
  auth: string | null;
  /** Recovery key used when a token is still missing. */
  recovery: string | null;
}

/** @brief HTTP client for one player session. */
export class DynoApi {
  private readonly config: McpConfig;
  private auth: string | null;

  constructor(config: McpConfig) {
    this.config = config;
    this.auth = config.auth;
  }

  /** @brief Whether a token is configured. */
  hasAuth(): boolean {
    return this.auth !== null;
  }

  /** @brief Whether write actions are refused by configuration. */
  get readOnly(): boolean {
    return this.config.readOnly;
  }

  /** @brief Base URL actually used. */
  get apiBase(): string {
    return this.config.apiBase;
  }

  /** @brief Swaps in a fresh auth header (used after a restore). */
  setAuth(auth: string): void {
    if (!isAuthHeader(auth)) throw new Error("Auth must look like playerId.token");
    this.auth = auth;
  }

  /** @brief Mints a token from the configured recovery key. */
  async restore(recovery: string): Promise<{ playerId: string; token: string; state: ApiJson }> {
    const response = await fetch(`${this.config.apiBase}/api/garden/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recovery }),
    });
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, text);
    const payload = JSON.parse(text) as { playerId?: unknown; token?: unknown; state?: unknown };
    if (typeof payload.playerId !== "string" || typeof payload.token !== "string") {
      throw new ApiError(response.status, "restore response is missing credentials");
    }
    this.setAuth(`${payload.playerId}.${payload.token}`);
    return {
      playerId: payload.playerId,
      token: payload.token,
      state: (payload.state ?? {}) as ApiJson,
    };
  }

  /** @brief One raw request against the worker. */
  private async request<T extends ApiJson>(
    path: string,
    init: { method?: "GET" | "POST"; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.auth !== false) {
      const auth = this.auth;
      if (auth === null) {
        throw new ApiError(401, '{"code":"UNAUTHORIZED"} — set DYNO_GARDEN_AUTH or DYNO_RECOVERY');
      }
      headers["x-dyno-garden"] = auth;
    }
    const response = await fetch(`${this.config.apiBase}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, text);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, text);
    }
  }

  /** @brief Reads the owner state bundle. */
  async state(): Promise<GardenStateResponse> {
    return this.request<GardenStateResponse>("/api/garden/state");
  }

  /** @brief Sends one action, reading the latest revision when omitted. */
  async act(action: GardenActionShape, rev?: number): Promise<GardenActResponse> {
    if (this.config.readOnly) throw new Error("Server is read-only (DYNO_READ_ONLY is set)");
    let current = rev;
    if (current === undefined) {
      const state = await this.state();
      current = state.rev;
    }
    return this.request<GardenActResponse>("/api/garden/act", {
      method: "POST",
      body: { rev: current, action },
    });
  }

  /** @brief Sends actions sequentially, carrying the revision forward. */
  async actBatch(actions: readonly GardenActionShape[]): Promise<GardenActResponse[]> {
    const results: GardenActResponse[] = [];
    let rev: number | undefined;
    for (const action of actions) {
      const result = await this.act(action, rev);
      rev = result.rev;
      results.push(result);
    }
    return results;
  }

  /** @brief Public market snapshot. */
  async market(): Promise<ApiJson> {
    return this.request<ApiJson>("/api/garden/market", { auth: false });
  }

  /** @brief Season and shop snapshot. */
  async season(): Promise<ApiJson> {
    return this.request<ApiJson>("/api/garden/season", { auth: false });
  }

  /** @brief Bot garden summaries. */
  async bots(): Promise<ApiJson> {
    return this.request<ApiJson>("/api/garden/bots", { auth: false });
  }

  /** @brief Leaderboard rows. */
  async leaderboard(limit = 50): Promise<ApiJson> {
    return this.request<ApiJson>(`/api/garden/leaderboard?limit=${encodeURIComponent(String(limit))}`, {
      auth: false,
    });
  }

  /** @brief Global sale log. */
  async sales(limit = 100): Promise<ApiJson> {
    return this.request<ApiJson>(`/api/garden/sales?limit=${encodeURIComponent(String(limit))}`, {
      auth: false,
    });
  }

  /** @brief Weekly tournament standings. */
  async tournament(limit = 20): Promise<ApiJson> {
    return this.request<ApiJson>(`/api/garden/tournament?limit=${encodeURIComponent(String(limit))}`, {
      auth: false,
    });
  }

  /** @brief Public snapshot of another garden by share code. */
  async visit(code: string): Promise<ApiJson> {
    return this.request<ApiJson>(`/api/garden/visit/${encodeURIComponent(code)}`, { auth: false });
  }

  /** @brief Worker health probe. */
  async health(): Promise<ApiJson> {
    const response = await fetch(`${this.config.apiBase}/health`, { method: "GET" });
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, text);
    return JSON.parse(text) as ApiJson;
  }
}
