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
  GardenStateResponse,
  LeaderboardEntry,
  SeasonSnapshot,
  VisitSnapshot,
} from "@dyno/shared/garden";
import { GARDEN_AUTH_HEADER, formatGardenAuth } from "@dyno/shared/garden";
import { LOCK_HEADER, LOCK_STORAGE_KEY } from "@/features/lock/lock";
import { apiBase } from "@/env";
import { loadIdentity, type Identity } from "@/shared/lib/identity";

/** Storage key for the player credentials. */
export const GARDEN_CREDENTIALS_KEY = "dyno.garden.credentials";

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
  private offsetMs = 0;

  constructor(options: GardenApiOptions = {}) {
    this.base = options.base ?? apiBase;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.storage = options.storage ?? safeStorage();
    this.identity = options.identity ?? (() => loadIdentity(this.storage));
    this.credentials = this.readCredentials();
  }

  /** @brief Current credentials, or `null` for a fresh browser. */
  get session(): StoredGardenCredentials | null {
    return this.credentials;
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

  /** @brief Reads the owner snapshot. */
  async state(): Promise<GardenStateResponse> {
    return this.request<GardenStateResponse>("/api/garden/state", { method: "GET" });
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

  /** @brief Builds the request headers: access gate plus owner credentials. */
  private headers(extra: Record<string, string>): Record<string, string> {
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
    return headers;
  }

  /**
   * @brief Performs one request and normalizes failures.
   * @throws {GardenApiError} For transport failures and error codes.
   */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        headers: this.headers((init.headers as Record<string, string> | undefined) ?? {}),
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
