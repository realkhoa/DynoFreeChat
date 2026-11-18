/**
 * @file secrets.ts
 * @brief Server-side random material and digests for garden credentials.
 * @details Tokens and recovery keys are bearer secrets, so only their SHA-256
 * digest is stored. Codes are short, human-shareable public keys and need no
 * digest: the Hub keeps them in a unique column.
 */

const encoder = new TextEncoder();

/** Uppercase Crockford base32: no I, L, O or U to avoid read-aloud mistakes. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** @brief Hex-encodes a byte array. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** @brief Cryptographically random lowercase hex of `byteLength` bytes. */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** @brief SHA-256 of one UTF-8 string, hex encoded. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

/** @brief Random public share code of `length` uppercase base32 characters. */
export function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length);
  return out;
}

/** @brief Random recovery key in the `ABCD-EFGH-JKMN` shape. */
export function randomRecoveryKey(): string {
  return `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
}

/** @brief Random write token: 32 bytes as 64 hex characters. */
export function randomToken(): string {
  return randomHex(32);
}
