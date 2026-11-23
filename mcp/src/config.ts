/**
 * @file config.ts
 * @brief Environment configuration for the DynoFreeChat MCP server.
 * @details The server talks to the public worker API as the player, so it needs
 * the owner credentials. Everything is read from the environment; nothing is
 * written to disk.
 */

/** Default public worker URL. */
export const DEFAULT_API_BASE = "https://dynofreechat-api.nbk2124-z.workers.dev";

/** Resolved server configuration. */
export interface McpConfig {
  /** Worker base URL, without the trailing slash. */
  readonly apiBase: string;
  /** Owner auth header value `playerId.token`, or `null` when unauthenticated. */
  readonly auth: string | null;
  /** Recovery key used to mint a fresh token when `auth` is absent. */
  readonly recovery: string | null;
  /** When true, action tools refuse to run. */
  readonly readOnly: boolean;
}

/** @brief Reads one env value, treating blank strings as absent. */
function envValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

/**
 * @brief Builds the config from the environment.
 * @param env Environment map, defaults to `process.env`.
 * @details Auth accepts either `DYNO_GARDEN_AUTH` (`playerId.token`) or the split
 * `DYNO_GARDEN_PLAYER_ID` + `DYNO_GARDEN_TOKEN`. `DYNO_RECOVERY` lets the server
 * mint a token on first use.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const apiBase = (envValue(env, "DYNO_API_BASE") ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const direct = envValue(env, "DYNO_GARDEN_AUTH");
  const playerId = envValue(env, "DYNO_GARDEN_PLAYER_ID");
  const token = envValue(env, "DYNO_GARDEN_TOKEN");
  const auth = direct ?? (playerId !== null && token !== null ? `${playerId}.${token}` : null);
  return {
    apiBase,
    auth,
    recovery: envValue(env, "DYNO_RECOVERY"),
    readOnly: envValue(env, "DYNO_READ_ONLY") !== null,
  };
}

/**
 * @brief Validates the `playerId.token` auth shape.
 * @param auth Candidate header value.
 * @details The worker rejects malformed headers anyway; failing early gives a
 * clearer MCP error message.
 */
export function isAuthHeader(auth: string): boolean {
  const dot = auth.indexOf(".");
  if (dot <= 0 || dot === auth.length - 1) return false;
  return true;
}
