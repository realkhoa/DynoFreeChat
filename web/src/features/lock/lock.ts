/**
 * @file lock.ts
 * @brief Browser side of the Worker access gate.
 * @details The Worker exchanges the access token or PIN for a signed, expiring
 * session token. Only that signed token is stored in the browser; the real
 * secret never leaves the Worker. Chat traffic is not gated, so the client only
 * prompts when a market request is refused.
 */

/** Storage key holding the signed session token. */
export const LOCK_STORAGE_KEY = "dyno.lock.session";

/** Header the Worker expects on gated requests. */
export const LOCK_HEADER = "x-dyno-lock";

/** Gate state reported by `GET /api/auth/state`. */
export interface LockState {
  /** Whether the Worker has a gate configured at all. */
  required: boolean;
  /** Whether the stored token is still valid. */
  unlocked: boolean;
}

/** Credential the user can present. */
export interface Credential {
  /** Long access token from the Worker secret. */
  token?: string;
  /** Short numeric PIN. */
  pin?: string;
}

/**
 * @brief Owns the session token and the verify requests.
 */
export class LockClient {
  /**
   * @param base Worker origin.
   * @param storage Storage for the signed token, or `null`.
   * @param fetchImpl Fetch implementation; tests replace it.
   */
  constructor(
    private readonly base: string,
    private readonly storage: Storage | null,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  /** Signed session token, or `null` when signed out. */
  get token(): string | null {
    if (this.storage === null) return null;
    const token = this.storage.getItem(LOCK_STORAGE_KEY);
    return token === null || token.length === 0 ? null : token;
  }

  /**
   * @brief Reads the Worker gate state.
   * @return The state; a network failure reports an open gate so the app stays usable.
   */
  async state(): Promise<LockState> {
    try {
      const response = await this.fetchImpl(`${this.base}/api/auth/state`, {
        headers: this.token === null ? {} : { [LOCK_HEADER]: this.token },
      });
      if (!response.ok) return { required: false, unlocked: true };
      const body = (await response.json()) as Partial<LockState>;
      return { required: body.required === true, unlocked: body.unlocked === true };
    } catch {
      return { required: false, unlocked: true };
    }
  }

  /**
   * @brief Exchanges a credential for a signed session token.
   * @param credential Access token or PIN.
   * @return Whether the credential was accepted and stored.
   */
  async unlock(credential: Credential): Promise<boolean> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential),
      });
    } catch {
      return false;
    }

    if (!response.ok) return false;

    let token: unknown = null;
    try {
      const body = (await response.json()) as { token?: unknown };
      token = body.token;
    } catch {
      return false;
    }
    if (typeof token !== "string" || token.length === 0) return false;

    if (this.storage !== null) {
      try {
        this.storage.setItem(LOCK_STORAGE_KEY, token);
      } catch {
        // A blocked storage still allows the current page to use the token.
      }
    }
    return true;
  }

  /** @brief Drops the stored session token. */
  clear(): void {
    if (this.storage === null) return;
    try {
      this.storage.removeItem(LOCK_STORAGE_KEY);
    } catch {
      // Nothing to do when storage is blocked.
    }
  }
}
