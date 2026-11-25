/**
 * @file api.ts
 * @brief Browser client for the ASCII Garden Worker API.
 * @details Owns the player credentials kept in `localStorage`, the server clock
 * offset used by countdowns, and the small request surface the views need. The
 * server is authoritative: this layer never predicts an action result.
 */

import type {
  GardenAction,
  GardenActResponse,
  GardenSnapshot,
  GuildSnapshot,
  HybridFishDefinition,
  RaidSnapshot,
  GlobalSaleEntry,
  GardenStateResponse,
  LeaderboardEntry,
  MarketSnapshot,
  SeasonSnapshot,
  StockQuote,
  VisitSnapshot,
} from "@dyno/shared/garden";
import { GARDEN_AUTH_HEADER, formatGardenAuth } from "@dyno/shared/garden";
import { LOCK_HEADER, LOCK_STORAGE_KEY } from "@/features/lock/lock";
import { apiBase } from "@/env";
import { loadIdentity, type Identity } from "@/shared/lib/identity";

/** Storage key for the player credentials. */
/** Storage key for the garden credentials. */
export const GARDEN_CREDENTIALS_KEY = "dyno.garden.credentials";

/** Storage key for the linked Cloudflare account session. */
export const GARDEN_ACCOUNT_KEY = "dyno.garden.account";

/** Header carrying the signed Cloudflare account session token. */
export const ACCOUNT_TOKEN_HEADER = "x-dyno-account-token";

/** Persisted Cloudflare account session stored locally on this device. */
export interface StoredGardenAccount {
  readonly username: string;
  readonly accountToken: string;
}

/** Response returned by `/api/garden/account/*` authentication and linking endpoints. */
export interface AccountAuthBundle {
  readonly accountToken: string;
  readonly username: string;
  readonly playerId: string | null;
  readonly token?: string;
  readonly state?: GardenSnapshot;
  readonly season?: SeasonSnapshot;
  readonly serverNow?: number;
}

/** Response returned by `GET /api/garden/account/me`. */
export interface AccountMePayload {
  readonly linked: boolean;
  readonly username?: string;
  readonly playerId?: string | null;
  readonly cfAccessEmail?: string | null;
  readonly accountToken?: string;
  readonly token?: string;
  readonly state?: GardenSnapshot;
  readonly season?: SeasonSnapshot;
  readonly serverNow?: number;
}

/** One bot garden row for the bots tab. */
export interface GardenBot {
  readonly code: string;
  readonly nick: string;
  readonly color: string;
  readonly coins: number;
  readonly earned: number;
  readonly harvested: number;
  readonly online: boolean;
  /** Carrot specialist marker. */
  readonly focus?: string;
  /** True for the five LLM-driven bots. */
  readonly ai?: boolean;
  /** Last AI decision, shown in the garden thought feed. */
  readonly thought?: {
    readonly at: number;
    readonly model?: string;
    readonly reasoning?: string;
    readonly cot?: string;
    readonly actions?: readonly string[];
    readonly fallback?: boolean;
    readonly error?: string;
  };
}

/** Credentials the browser keeps for this player. */
export interface StoredGardenCredentials {
  /** Stable player id. */
  readonly playerId: string;
  /** Current write token. */
  readonly token: string;
  /** Recovery key, kept locally so the player can copy it. */
  readonly recovery?: string;
}

/** Response of a register or restore call. */
export interface GardenAuthBundle {
  /** Stable player id. */
  readonly playerId: string;
  /** New write token. */
  readonly token: string;
  /** Recovery key; only present right after register/rotate. */
  readonly recovery?: string;
  /** Owner snapshot. */
  readonly state: GardenSnapshot;
  /** Season the server was on. */
  readonly season: SeasonSnapshot;
  /** Server clock. */
  readonly serverNow: number;
}

/** Response of one visit fetch. */
export interface GardenVisitBundle {
  /** Public snapshot. */
  readonly garden: VisitSnapshot;
  /** Season the server was on. */
  readonly season: SeasonSnapshot;
  /** Server clock. */
  readonly serverNow: number;
}

/** Error raised by the garden client; `code` maps to a localized message. */
export class GardenApiError extends Error {
  /**
   * @param code Machine readable reason.
   * @param status HTTP status, or `0` for a transport failure.
   */
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`garden api: ${code}`);
    this.name = "GardenApiError";
  }
}

/** Options for {@link GardenApi}. */
export interface GardenApiOptions {
  /** Worker origin; defaults to the app's API base. */
  readonly base?: string;
  /** Fetch implementation; tests replace it. */
  readonly fetchImpl?: typeof fetch;
  /** Storage for credentials; defaults to `localStorage`. */
  readonly storage?: Storage | null;
  /** Identity provider for registration. */
  readonly identity?: () => Identity;
}

/** @brief Reads `localStorage` when the browser allows it. */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** @brief Typed access to `/api/garden/*`. */
export class GardenApi {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly storage: Storage | null;
  private readonly identity: () => Identity;
  private credentials: StoredGardenCredentials | null;
  private accountInfo: StoredGardenAccount | null;
  private offsetMs = 0;

  constructor(options: GardenApiOptions = {}) {
    this.base = options.base ?? apiBase;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.storage = options.storage ?? safeStorage();
    this.identity = options.identity ?? (() => loadIdentity(this.storage));
    this.credentials = this.readCredentials();
    this.accountInfo = this.readAccount();
  }

  /** @brief Current credentials, or `null` for a fresh browser. */
  get session(): StoredGardenCredentials | null {
    return this.credentials;
  }

  /** @brief Current linked Cloudflare account session, or `null`. */
  get account(): StoredGardenAccount | null {
    return this.accountInfo;
  }

  /** @brief Server-clock estimate: `Date.now()` corrected by the last response. */
  now(): number {
    return Date.now() + this.offsetMs;
  }

  /** @brief Whether this browser already owns a garden. */
  hasSession(): boolean {
    return this.credentials !== null;
  }

  /** @brief Forgets the credentials, e.g. after the server rejects the token. */
  forget(): void {
    this.credentials = null;
    if (this.storage === null) return;
    try {
      this.storage.removeItem(GARDEN_CREDENTIALS_KEY);
    } catch {
      // Blocked storage: the in-memory clear still applies.
    }
  }

  /** @brief Registers a brand-new garden with the local identity. */
  async register(): Promise<GardenAuthBundle> {
    const identity = this.identity();
    const bundle = await this.request<GardenAuthBundle>("/api/garden/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nick: identity.nick, color: identity.color }),
    });
    this.adopt(bundle);
    return bundle;
  }

  /** @brief Restores the garden behind one recovery key. */
  async restore(recovery: string, nick?: string, color?: string): Promise<GardenAuthBundle> {
    const bundle = await this.request<GardenAuthBundle>("/api/garden/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recovery, nick, color }),
    });
    this.adopt(bundle);
    return bundle;
  }

  /**
   * @brief Registers a Cloudflare account without email verification and links the current or recovered garden.
   * @param username Username or email identifier.
   * @param password Account password (minimum 6 characters).
   * @param recovery Optional recovery key to link an older garden directly.
   * @return AccountAuthBundle with optional synced garden session.
   */
  async accountRegister(username: string, password: string, recovery?: string): Promise<AccountAuthBundle> {
    const bundle = await this.request<AccountAuthBundle>("/api/garden/account/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, recovery }),
    });
    this.adoptAccount(bundle);
    return bundle;
  }

  /**
   * @brief Signs into a Cloudflare account and syncs its linked garden to this device.
   * @param username Username or email identifier.
   * @param password Account password.
   * @param recovery Optional recovery key to link if the account has no garden yet.
   * @return AccountAuthBundle with multi-device garden session when linked.
   */
  async accountLogin(username: string, password: string, recovery?: string): Promise<AccountAuthBundle> {
    const bundle = await this.request<AccountAuthBundle>("/api/garden/account/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, recovery }),
    });
    this.adoptAccount(bundle);
    return bundle;
  }

  /**
   * @brief Links the currently signed-in account (or Cloudflare Access user) to the active or recovered garden.
   * @param recovery Optional recovery key for an older garden.
   * @return Updated AccountAuthBundle.
   */
  async accountLink(recovery?: string): Promise<AccountAuthBundle> {
    const bundle = await this.request<AccountAuthBundle>("/api/garden/account/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recovery }),
    });
    this.adoptAccount(bundle);
    return bundle;
  }

  /**
   * @brief Checks the current account / Cloudflare Access link status.
   * @return AccountMePayload describing link status and optional synced session.
   */
  async accountMe(): Promise<AccountMePayload> {
    const payload = await this.request<AccountMePayload>("/api/garden/account/me", { method: "GET" });
    if (
      typeof payload.accountToken === "string" &&
      typeof payload.username === "string" &&
      typeof payload.playerId === "string"
    ) {
      this.adoptAccount({
        accountToken: payload.accountToken,
        username: payload.username,
        playerId: payload.playerId,
        token: payload.token,
        state: payload.state,
        season: payload.season,
        serverNow: payload.serverNow,
      });
    }
    return payload;
  }

  /** @brief Clears the locally stored Cloudflare account session on this device only. */
  logoutAccount(): void {
    this.accountInfo = null;
    if (this.storage === null) return;
    try {
      this.storage.removeItem(GARDEN_ACCOUNT_KEY);
    } catch {
      // Blocked storage: in-memory clear still applies.
    }
  }

  /** @brief Reads the owner snapshot. */
  async state(): Promise<GardenStateResponse> {
    return this.request<GardenStateResponse>("/api/garden/state", { method: "GET" });
  }

  /** @brief Weekly tournament standings. */
  async tournament(): Promise<
    Array<{ nick: string; code: string; earned: number; harvested: number; weekKey: number }>
  > {
    const response = await this.request<{
      entries: Array<{ nick: string; code: string; earned: number; harvested: number; weekKey: number }>;
    }>("/api/garden/tournament", { method: "GET" });
    return Array.isArray(response.entries) ? response.entries : [];
  }

  /** @brief Lists the server-side bot gardens. */
  async bots(): Promise<{ bots: GardenBot[] }> {
    return this.request<{ bots: GardenBot[] }>("/api/garden/bots", { method: "GET" });
  }

  /** @brief Reads the caller's guild. */
  async guildMine(): Promise<{ guild: GuildSnapshot | null }> {
    return this.request<{ guild: GuildSnapshot | null }>("/api/garden/guild/mine", { method: "GET" });
  }

  /** @brief Reads the public guild board. */
  async guildList(): Promise<{
    guilds: Array<{ id: string; name: string; ownerId: string; members: number; createdAt: number }>;
  }> {
    return this.request<{
      guilds: Array<{ id: string; name: string; ownerId: string; members: number; createdAt: number }>;
    }>("/api/garden/guild/list", { method: "GET" });
  }

  /** @brief Creates a guild. */
  async guildCreate(name: string, nick: string, code: string): Promise<{ guild: GuildSnapshot }> {
    return this.request<{ guild: GuildSnapshot }>("/api/garden/guild/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, nick, code }),
    });
  }

  /** @brief Joins a guild. */
  async guildJoin(guildId: string, nick: string, code: string): Promise<{ guild: GuildSnapshot }> {
    return this.request<{ guild: GuildSnapshot }>("/api/garden/guild/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId, nick, code }),
    });
  }

  /** @brief Donates coins into the guild bank. */
  async guildDonate(amount: number): Promise<{ guild: GuildSnapshot }> {
    return this.request<{ guild: GuildSnapshot }>("/api/garden/guild/donate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount }),
    });
  }

  /**
   * @brief Contributes crafted products toward the guild's shared co-op project.
   * @param qty Quantity to contribute.
   * @return Updated guild snapshot and player coins.
   */
  async guildContribute(qty: number): Promise<{ guild: GuildSnapshot; coins: number }> {
    return this.request<{ guild: GuildSnapshot; coins: number }>("/api/garden/guild/contribute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qty }),
    });
  }

  /** @brief Leaves the current guild. */
  async guildLeave(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/api/garden/guild/leave", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  /**
   * @brief Fetches realtime Vietnamese and international stock quotes.
   * @param refresh When true, bypasses the 60s server cache.
   * @return List of StockQuote entries and server fetch timestamp.
   */
  async stocks(refresh = false): Promise<{ quotes: StockQuote[]; updatedAt: number }> {
    const query = refresh ? "?refresh=1" : "";
    return this.request<{ quotes: StockQuote[]; updatedAt: number }>(`/api/garden/stocks${query}`, {
      method: "GET",
    });
  }

  /**
   * @brief Executes a buy or sell stock order against live server quotes.
   * @param side Order side (`buy` or `sell`).
   * @param symbol Ticker symbol.
   * @param shares Share count.
   * @return Updated garden snapshot and live quotes.
   */
  async tradeStock(
    side: "buy" | "sell",
    symbol: string,
    shares: number,
  ): Promise<{ state: GardenSnapshot; quotes: StockQuote[] }> {
    return this.request<{ state: GardenSnapshot; quotes: StockQuote[] }>("/api/garden/stocks/trade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side, symbol, shares }),
    });
  }

  /** @brief Reads the shared locust raid. */
  async raid(): Promise<RaidSnapshot> {
    return this.request<RaidSnapshot>("/api/garden/raid", { method: "GET" });
  }

  /** @brief Spends one raid hit on the shared locust swarm. */
  async raidHit(): Promise<{ raid: RaidSnapshot & { defeated?: boolean }; coins: number }> {
    return this.request<{ raid: RaidSnapshot & { defeated?: boolean }; coins: number }>("/api/garden/raid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  /** @brief Asks Beam Free to invent a global recipe from ingredients. */
  async suggestRecipe(inputs: string[]): Promise<{
    valid: boolean;
    reason: string;
    recipe?: { id: string; inputs: string[]; output: string; price: number; createdAt?: number };
  }> {
    return this.request<{
      valid: boolean;
      reason: string;
      recipe?: { id: string; inputs: string[]; output: string; price: number; createdAt?: number };
    }>("/api/garden/recipe/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs }),
    });
  }

  /** @brief Reads the public global recipe list. */
  async globalRecipes(): Promise<{
    recipes: Array<{ id: string; inputs: string[]; output: string; price: number; createdAt: number }>;
  }> {
    return this.request<{
      recipes: Array<{ id: string; inputs: string[]; output: string; price: number; createdAt: number }>;
    }>("/api/garden/recipes", { method: "GET" });
  }

  /**
   * @brief Reads the public list of discovered hybrid fish definitions.
   * @return Promise resolving to array of global hybrid fish.
   */
  async globalHybrids(): Promise<{
    hybrids: HybridFishDefinition[];
  }> {
    return this.request<{
      hybrids: HybridFishDefinition[];
    }>("/api/garden/fish/hybrids", { method: "GET" });
  }

  /**
   * @brief Breeds two parent fish using AI generation on the server.
   * @param parentA Primary parent fish kind.
   * @param parentB Secondary parent fish kind.
   * @return Promise resolving to server-generated hybrid fish.
   */
  async breedHybridFish(
    parentA: string,
    parentB: string,
  ): Promise<{
    ok: boolean;
    hybrid: HybridFishDefinition;
  }> {
    return this.request<{
      ok: boolean;
      hybrid: HybridFishDefinition;
    }>("/api/garden/fish/breed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentA, parentB }),
    });
  }

  /** @brief Copies one global recipe into this garden. */
  async learnRecipe(recipe: { inputs: string[]; output: string; price: number }): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/api/garden/recipe/learn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipe),
    });
  }

  /** @brief Asks the recipe-lab model whether a combination makes sense. */
  async validateRecipe(
    inputs: string[],
    output: string,
  ): Promise<{
    valid: boolean;
    reason: string;
    suggestedPrice: number;
  }> {
    return this.request<{ valid: boolean; reason: string; suggestedPrice: number }>("/api/garden/recipe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs, output }),
    });
  }

  /**
   * @brief Reads the public global sale log for the log tab.
   * @param limit Maximum number of recent sale records to retrieve (default: 500).
   * @return Promise resolving to array of global sale entries.
   */
  async sales(limit = 500): Promise<{ entries: GlobalSaleEntry[] }> {
    return this.request<{ entries: GlobalSaleEntry[] }>(`/api/garden/sales?limit=${limit}`, {
      method: "GET",
    });
  }

  /** @brief Reads the global market board for the chart tab. */
  async market(): Promise<{ market: MarketSnapshot | null; serverNow: number }> {
    return this.request<{ market: MarketSnapshot | null; serverNow: number }>("/api/garden/market", {
      method: "GET",
    });
  }

  /** @brief Reads the current season snapshot. */
  async season(): Promise<{ season: SeasonSnapshot; serverNow: number }> {
    return this.request<{ season: SeasonSnapshot; serverNow: number }>("/api/garden/season", {
      method: "GET",
    });
  }

  /** @brief Applies one action against the current revision. */
  async act(rev: number, action: GardenAction): Promise<GardenActResponse> {
    return this.request<GardenActResponse>("/api/garden/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev, action }),
    });
  }

  /** @brief Renames the player without touching the garden identity. */
  async rename(nick: string, color: string): Promise<GardenStateResponse> {
    return this.request<GardenStateResponse>("/api/garden/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nick, color }),
    });
  }

  /** @brief Mints a new recovery key and returns it. */
  async rotateRecovery(): Promise<string> {
    const response = await this.request<{ recovery: string }>("/api/garden/recovery", {
      method: "POST",
    });
    if (this.credentials !== null) {
      this.credentials = { ...this.credentials, recovery: response.recovery };
      this.persist();
    }
    return response.recovery;
  }

  /** @brief Reads someone else's public garden. */
  async visit(code: string): Promise<GardenVisitBundle> {
    return this.request<GardenVisitBundle>(`/api/garden/visit/${encodeURIComponent(code)}`, {
      method: "GET",
    });
  }

  /**
   * @brief Waters one friend crop or fruit tree.
   * @param code Owner share code.
   * @param slot Slot inside the current patch.
   * @param tree Whether the slot is a fruit tree.
   */
  async waterVisit(code: string, slot: number, tree = false): Promise<GardenVisitBundle> {
    return this.request<GardenVisitBundle>(`/api/garden/visit/${encodeURIComponent(code)}/water`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot, tree }),
    });
  }

  /** @brief Leaves one cheer on a friend garden. */
  async cheerVisit(code: string): Promise<GardenVisitBundle> {
    return this.request<GardenVisitBundle>(`/api/garden/visit/${encodeURIComponent(code)}/cheer`, {
      method: "POST",
    });
  }

  /** @brief Reads the public leaderboard. */
  async leaderboard(limit = 20): Promise<LeaderboardEntry[]> {
    const response = await this.request<{ entries: LeaderboardEntry[] }>(
      `/api/garden/leaderboard?limit=${limit}`,
      { method: "GET" },
    );
    return Array.isArray(response.entries) ? response.entries : [];
  }

  /** @brief Stores one auth bundle and refreshes the clock offset. */
  private adopt(bundle: GardenAuthBundle): void {
    this.credentials = {
      playerId: bundle.playerId,
      token: bundle.token,
      recovery: bundle.recovery ?? this.credentials?.recovery,
    };
    this.persist();
    this.syncClock(bundle.serverNow);
  }

  /** @brief Persists the credentials, ignoring blocked storage. */
  private persist(): void {
    if (this.storage === null || this.credentials === null) return;
    try {
      this.storage.setItem(GARDEN_CREDENTIALS_KEY, JSON.stringify(this.credentials));
    } catch {
      // The session still works in memory.
    }
  }

  /** @brief Reads the stored credentials. */
  private readCredentials(): StoredGardenCredentials | null {
    if (this.storage === null) return null;
    try {
      const raw = this.storage.getItem(GARDEN_CREDENTIALS_KEY);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      if (typeof record.playerId !== "string" || typeof record.token !== "string") return null;
      return {
        playerId: record.playerId,
        token: record.token,
        recovery: typeof record.recovery === "string" ? record.recovery : undefined,
      };
    } catch {
      return null;
    }
  }

  /** @brief Adjusts the clock offset from one server timestamp. */
  private syncClock(serverNow: unknown): void {
    if (typeof serverNow === "number" && Number.isFinite(serverNow)) {
      this.offsetMs = serverNow - Date.now();
    }
  }

  /** @brief Builds the request headers: access gate, owner credentials, and optional account token. */
  private headers(extra: Record<string, string>, includeAccount = false): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.storage !== null) {
      try {
        const lock = this.storage.getItem(LOCK_STORAGE_KEY);
        if (lock !== null && lock.length > 0) headers[LOCK_HEADER] = lock;
      } catch {
        // No gate token available.
      }
    }
    if (this.credentials !== null) {
      headers[GARDEN_AUTH_HEADER] = formatGardenAuth(this.credentials);
    }
    if (includeAccount && this.accountInfo !== null) {
      headers[ACCOUNT_TOKEN_HEADER] = this.accountInfo.accountToken;
    }
    return headers;
  }

  /** @brief Persists an authenticated Cloudflare account and adopts any synced garden session. */
  private adoptAccount(bundle: AccountAuthBundle): void {
    this.accountInfo = { username: bundle.username, accountToken: bundle.accountToken };
    if (this.storage !== null) {
      try {
        this.storage.setItem(GARDEN_ACCOUNT_KEY, JSON.stringify(this.accountInfo));
      } catch {
        // Blocked storage: keep in-memory session.
      }
    }
    if (
      typeof bundle.playerId === "string" &&
      typeof bundle.token === "string" &&
      bundle.state !== undefined &&
      bundle.season !== undefined &&
      typeof bundle.serverNow === "number"
    ) {
      const existingRecovery =
        this.credentials?.playerId === bundle.playerId ? this.credentials.recovery : undefined;
      this.adopt({
        playerId: bundle.playerId,
        token: bundle.token,
        recovery: existingRecovery,
        state: bundle.state,
        season: bundle.season,
        serverNow: bundle.serverNow,
      });
    }
  }

  /** @brief Reads the persisted Cloudflare account session from storage. */
  private readAccount(): StoredGardenAccount | null {
    if (this.storage === null) return null;
    try {
      const raw = this.storage.getItem(GARDEN_ACCOUNT_KEY);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      if (typeof record.username !== "string" || typeof record.accountToken !== "string") return null;
      return { username: record.username, accountToken: record.accountToken };
    } catch {
      return null;
    }
  }

  /**
   * @brief Performs one request and normalizes failures.
   * @throws {GardenApiError} For transport failures and error codes.
   */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    const includeAccount = path.startsWith("/api/garden/account");
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        headers: this.headers((init.headers as Record<string, string> | undefined) ?? {}, includeAccount),
      });
    } catch {
      throw new GardenApiError("NETWORK", 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const code =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { code?: unknown }).code === "string"
          ? (payload as { code: string }).code
          : response.status === 401
            ? "UNAUTHORIZED"
            : "UNKNOWN";
      throw new GardenApiError(code, response.status);
    }

    const body = payload as Record<string, unknown>;
    this.syncClock(body.serverNow);
    return body as T;
  }
}
