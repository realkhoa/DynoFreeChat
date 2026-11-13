import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  LOCK_HEADER,
  SESSION_TTL_MS,
  VERIFY_CAPACITY,
  VERIFY_WINDOW_MS,
  issueSession,
  lockSecrets,
  sha256Hex,
  takeVerifyAttempt,
  timingSafeEqual,
  verifyCredential,
  verifySession,
  type LockSecrets,
} from "../src/auth";
import { BASE, ORIGIN, uniqueIp } from "./helpers";

/** Fixed secrets so the tests never depend on the deployment environment. */
const SECRETS: LockSecrets = { token: "access-token-for-tests", pinHash: "" };

describe("lockSecrets", () => {
  it("is disabled until both secrets exist", () => {
    expect(lockSecrets({})).toBeNull();
    expect(lockSecrets({ LOCK_TOKEN: "abc" })).toBeNull();
    expect(lockSecrets({ LOCK_PIN_HASH: "def" })).toBeNull();
    expect(lockSecrets({ LOCK_TOKEN: "abc", LOCK_PIN_HASH: "DEF" })).toEqual({
      token: "abc",
      pinHash: "def",
    });
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("timingSafeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("sessions", () => {
  it("round-trips a freshly issued token", async () => {
    const now = 1_700_000_000_000;
    const token = await issueSession(SECRETS, now);
    await expect(verifySession(SECRETS, token, now + 1000)).resolves.toBe(true);
  });

  it("refuses an expired token", async () => {
    const now = 1_700_000_000_000;
    const token = await issueSession(SECRETS, now);
    await expect(verifySession(SECRETS, token, now + SESSION_TTL_MS + 1)).resolves.toBe(false);
  });

  it("refuses a tampered expiry or signature", async () => {
    const now = 1_700_000_000_000;
    const token = await issueSession(SECRETS, now);
    const [expires, signature] = token.split(".");
    expect(expires).toBeDefined();
    expect(signature).toBeDefined();

    await expect(verifySession(SECRETS, `${Number(expires) + 1000}.${signature}`, now)).resolves.toBe(false);
    await expect(verifySession(SECRETS, `${expires}.deadbeef`, now)).resolves.toBe(false);
    await expect(verifySession(SECRETS, "junk", now)).resolves.toBe(false);
    await expect(verifySession(SECRETS, null, now)).resolves.toBe(false);
  });

  it("refuses a token signed with another secret", async () => {
    const now = 1_700_000_000_000;
    const token = await issueSession(SECRETS, now);
    await expect(verifySession({ ...SECRETS, token: "other" }, token, now)).resolves.toBe(false);
  });
});

describe("verifyCredential", () => {
  it("accepts the exact access token", async () => {
    await expect(verifyCredential(SECRETS, { token: SECRETS.token })).resolves.toBe(true);
    await expect(verifyCredential(SECRETS, { token: "nope" })).resolves.toBe(false);
  });

  it("accepts a PIN whose hash matches", async () => {
    const pinHash = await sha256Hex("2468");
    const secrets: LockSecrets = { token: "abc", pinHash };
    await expect(verifyCredential(secrets, { pin: "2468" })).resolves.toBe(true);
    await expect(verifyCredential(secrets, { pin: "1111" })).resolves.toBe(false);
  });

  it("refuses an empty body", async () => {
    await expect(verifyCredential(SECRETS, {})).resolves.toBe(false);
  });
});

describe("verification rate limit", () => {
  it("allows a short burst and then refuses", () => {
    const ip = uniqueIp();
    for (let index = 0; index < VERIFY_CAPACITY; index += 1) expect(takeVerifyAttempt(ip, 1000)).toBe(true);
    expect(takeVerifyAttempt(ip, 1000)).toBe(false);
    expect(takeVerifyAttempt(ip, 1000 + VERIFY_WINDOW_MS)).toBe(true);
  });
});

describe("auth routes", () => {
  it("reports an open gate when the Worker has no secrets", async () => {
    const response = await SELF.fetch(`${BASE}/api/auth/state`, { headers: { origin: ORIGIN } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ required: false, unlocked: true });
  });

  it("404s verify while the gate is disabled", async () => {
    const response = await SELF.fetch(`${BASE}/api/auth/verify`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ token: "abc" }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: "LOCK_DISABLED" });
  });

  it("exposes the lock header name for the client", () => {
    expect(LOCK_HEADER).toBe("x-dyno-lock");
  });
});
