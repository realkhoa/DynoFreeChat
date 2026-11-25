/**
 * @file auth.ts
 * @brief Worker-verified access gate for the market routes.
 * @details The source app shipped a hardcoded token in its HTML. Here the secret
 * lives in Worker secrets and the browser only ever holds a signed, expiring
 * session token: `POST /api/auth/verify` exchanges the access token or PIN for
 * `<expiresAt>.<hmac>`, and the proxy checks that signature on every market
 * request. Chat traffic is deliberately not gated, so a shared room keeps
 * working for guests.
 */

import { LOCK_HEADER } from "@dyno/shared/market";
import { json } from "./http";

/** Re-exported so the router does not import the shared module twice. */
export { LOCK_HEADER };

/** How long a verified session stays valid. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Failed verification attempts allowed per IP inside one window. */
export const VERIFY_CAPACITY = 5;

/** Length of the verification rate-limit window. */
export const VERIFY_WINDOW_MS = 5 * 60 * 1000;

/** Secrets the gate needs; both unset means the gate is disabled. */
export interface LockSecrets {
  /** Long random access token the user types once per device. */
  token: string;
  /** SHA-256 hex of the access PIN. */
  pinHash: string;
}

/** Body accepted by `POST /api/auth/verify`. */
export interface VerifyBody {
  token?: unknown;
  pin?: unknown;
}

/** Per-IP verification windows. */
const attempts = new Map<string, { start: number; count: number }>();

/**
 * @brief Reads the gate configuration from the environment.
 * @param env Worker bindings.
 * @return The secrets, or `null` when the gate is not configured (open access).
 */
export function lockSecrets(env: { LOCK_TOKEN?: string; LOCK_PIN_HASH?: string }): LockSecrets | null {
  const token = (env.LOCK_TOKEN ?? "").trim();
  const pinHash = (env.LOCK_PIN_HASH ?? "").trim().toLowerCase();
  if (token.length === 0 || pinHash.length === 0) return null;
  return { token, pinHash };
}

/**
 * @brief Hex-encodes an ArrayBuffer.
 * @param buffer Raw digest or signature bytes.
 * @return Lower-case hex string.
 */
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @brief Computes the SHA-256 hex digest of a string.
 * @param value Input string.
 * @return Lower-case hex digest.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(digest);
}

/**
 * @brief Signs a payload with the gate token.
 * @param secret Gate access token.
 * @param payload Payload to sign.
 * @return Lower-case hex HMAC-SHA256.
 */
async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

/**
 * @brief Compares two strings without leaking their common prefix length.
 * @param left First string.
 * @param right Second string.
 * @return Whether they are equal.
 */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * @brief Issues a signed session token.
 * @param secrets Gate secrets.
 * @param now Current epoch milliseconds.
 * @return `<expiresAt>.<signature>`.
 */
export async function issueSession(secrets: LockSecrets, now: number): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS;
  const signature = await sign(secrets.token, `dyno-lock:${expiresAt}`);
  return `${expiresAt}.${signature}`;
}

/**
 * @brief Validates a session token.
 * @param secrets Gate secrets.
 * @param token Raw header value.
 * @param now Current epoch milliseconds.
 * @return Whether the token is authentic and unexpired.
 */
export async function verifySession(
  secrets: LockSecrets,
  token: string | null,
  now: number,
): Promise<boolean> {
  if (token === null || token.length === 0) return false;

  const [rawExpires, signature] = token.split(".");
  if (rawExpires === undefined || signature === undefined) return false;

  const expiresAt = Number(rawExpires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  const expected = await sign(secrets.token, `dyno-lock:${expiresAt}`);
  return timingSafeEqual(expected, signature);
}

/**
 * @brief Checks the access token or PIN from a verify request.
 * @param secrets Gate secrets.
 * @param body Parsed request body.
 * @return Whether the credential matches.
 */
export async function verifyCredential(secrets: LockSecrets, body: VerifyBody): Promise<boolean> {
  if (typeof body.token === "string" && body.token.length > 0) {
    return timingSafeEqual(body.token, secrets.token);
  }
  if (typeof body.pin === "string" && body.pin.length > 0) {
    return timingSafeEqual(await sha256Hex(body.pin), secrets.pinHash);
  }
  return false;
}

/**
 * @brief Consumes one verification attempt for an IP.
 * @param ip Client IP.
 * @param now Current epoch milliseconds.
 * @return Whether the attempt may proceed.
 */
export function takeVerifyAttempt(ip: string, now: number): boolean {
  const current = attempts.get(ip);
  if (current === undefined || now - current.start >= VERIFY_WINDOW_MS) {
    attempts.set(ip, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= VERIFY_CAPACITY;
}

/**
 * @brief Answers `POST /api/auth/verify`.
 * @param request Incoming request.
 * @param env Worker bindings.
 * @return The signed session token, or a refusal.
 */
export async function verifyResponse(
  request: Request,
  env: { LOCK_TOKEN?: string; LOCK_PIN_HASH?: string },
): Promise<Response> {
  const secrets = lockSecrets(env);
  if (secrets === null) return json({ code: "LOCK_DISABLED" }, 404);

  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const now = Date.now();
  if (!takeVerifyAttempt(ip, now)) return json({ code: "TOO_MANY_ATTEMPTS" }, 429, { "retry-after": "300" });

  let body: VerifyBody = {};
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === "object" && parsed !== null) body = parsed as VerifyBody;
  } catch {
    body = {};
  }

  if (!(await verifyCredential(secrets, body))) return json({ code: "BAD_CREDENTIAL" }, 401);

  return json({ ok: true, token: await issueSession(secrets, now), expiresIn: SESSION_TTL_MS });
}

/**
 * @brief Answers `GET /api/auth/state` so the client knows whether to prompt.
 * @param request Incoming request.
 * @param env Worker bindings.
 * @return `{ required, unlocked }`.
 */
export async function stateResponse(
  request: Request,
  env: { LOCK_TOKEN?: string; LOCK_PIN_HASH?: string },
): Promise<Response> {
  const secrets = lockSecrets(env);
  if (secrets === null) return json({ required: false, unlocked: true });

  const unlocked = await verifySession(secrets, request.headers.get(LOCK_HEADER), Date.now());
  return json({ required: true, unlocked });
}

/** How long a linked Cloudflare account session stays valid (30 days). */
export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PBKDF2_ITERATIONS = 100_000;

/**
 * @brief Converts a hex string back into a Uint8Array.
 * @param hex Lower-case hexadecimal string.
 * @return Decoded byte buffer.
 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * @brief Derives a salted PBKDF2-SHA256 password hash using Cloudflare WebCrypto.
 * @param password Plaintext password provided by the user.
 * @param existingSaltHex Optional hex salt for verification; generates random 16 bytes when omitted.
 * @return Encoded hash string `pbkdf2$<saltHex>$<digestHex>`.
 */
export async function hashPasswordPBKDF2(password: string, existingSaltHex?: string): Promise<string> {
  const saltBytes = existingSaltHex ? fromHex(existingSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const saltHex = existingSaltHex ?? toHex(saltBytes.buffer as ArrayBuffer);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return `pbkdf2$${saltHex}$${toHex(derived)}`;
}

/**
 * @brief Verifies a plaintext password against a stored `pbkdf2$<salt>$<hash>` string.
 * @param password Plaintext password to check.
 * @param stored Stored password hash record.
 * @return True if the password matches.
 */
export async function verifyPasswordPBKDF2(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const saltHex = parts[1];
  if (!saltHex || !/^[0-9a-f]{32}$/.test(saltHex)) return false;
  const recomputed = await hashPasswordPBKDF2(password, saltHex);
  return timingSafeEqual(recomputed, stored);
}

/**
 * @brief Resolves the HMAC signing secret for Cloudflare account tokens.
 * @param env Worker environment bindings.
 * @return Non-empty HMAC secret string.
 */
export function accountSigningSecret(env: { LOCK_TOKEN?: string; OPENCODE_API_KEY?: string }): string {
  const lock = (env.LOCK_TOKEN ?? "").trim();
  if (lock.length > 0) return lock;
  const apiKey = (env.OPENCODE_API_KEY ?? "").trim();
  if (apiKey.length > 0) return apiKey;
  return "dyno-garden-cf-account-v1";
}

/**
 * @brief Issues a signed multi-device account session token (`<accountId>.<expiresAt>.<sig>`).
 * @param secret HMAC signing secret.
 * @param accountId Unique account UUID.
 * @param now Current epoch milliseconds.
 * @return Signed token string.
 */
export async function issueAccountSession(secret: string, accountId: string, now: number): Promise<string> {
  const expiresAt = now + ACCOUNT_SESSION_TTL_MS;
  const sig = await sign(secret, `dyno-acct:${accountId}:${expiresAt}`);
  return `${accountId}.${expiresAt}.${sig}`;
}

/**
 * @brief Verifies a signed account session token and extracts its accountId.
 * @param secret HMAC signing secret.
 * @param token Raw token string.
 * @param now Current epoch milliseconds.
 * @return Validated accountId, or null if invalid or expired.
 */
export async function verifyAccountSession(
  secret: string,
  token: string | null,
  now: number,
): Promise<string | null> {
  if (token === null || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [accountId, rawExpires, sig] = parts;
  if (!accountId || !rawExpires || !sig) return null;
  const expiresAt = Number(rawExpires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const expected = await sign(secret, `dyno-acct:${accountId}:${expiresAt}`);
  return timingSafeEqual(expected, sig) ? accountId : null;
}
