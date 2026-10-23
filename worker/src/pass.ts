/**
 * Room password hashing.
 *
 * Deliberately a single salted SHA-256 and not PBKDF2/scrypt: the Workers Free
 * plan allows 10 ms of CPU per request, and a real KDF would push a join over
 * that budget and fail the request. This is a door key for a chat room, not
 * protection for a secret — the README says so out loud.
 */

const SALT_BYTES = 16;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Cryptographically random 16 byte salt, hex encoded. */
export function randomSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** SHA-256(salt ‖ NUL ‖ slug ‖ NUL ‖ pass), hex encoded. */
export async function hashPass(salt: string, slug: string, pass: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${salt}\u0000${slug}\u0000${pass}`),
  );
  return toHex(new Uint8Array(digest));
}

/** Compares two hex digests without an early exit. */
export function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
