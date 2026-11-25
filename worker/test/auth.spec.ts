import { SELF } from "cloudflare:test";
import { GARDEN_AUTH_HEADER, formatGardenAuth } from "@dyno/shared/garden";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SESSION_TTL_MS,
  LOCK_HEADER,
  SESSION_TTL_MS,
  VERIFY_CAPACITY,
  VERIFY_WINDOW_MS,
  hashPasswordPBKDF2,
  issueAccountSession,
  issueSession,
  lockSecrets,
  sha256Hex,
  takeVerifyAttempt,
  timingSafeEqual,
  verifyAccountSession,
  verifyCredential,
  verifyPasswordPBKDF2,
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

describe("cloudflare account auth & multi-device sync", () => {
  it("hashes and verifies passwords via PBKDF2 and signs account sessions", async () => {
    const hash = await hashPasswordPBKDF2("secret-pass");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
    await expect(verifyPasswordPBKDF2("secret-pass", hash)).resolves.toBe(true);
    await expect(verifyPasswordPBKDF2("wrong-pass", hash)).resolves.toBe(false);

    const now = 1_700_000_000_000;
    const token = await issueAccountSession("test-secret", "acct-1", now);
    await expect(verifyAccountSession("test-secret", token, now)).resolves.toBe("acct-1");
    await expect(
      verifyAccountSession("test-secret", token, now + ACCOUNT_SESSION_TTL_MS + 1),
    ).resolves.toBeNull();
  });

  it("links an account to an existing garden without email verification and keeps multiple devices authorized", async () => {
    const ip = uniqueIp();
    const regRes = await SELF.fetch(`${BASE}/api/garden/register`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ nick: "OldFarmer", color: "#5f8" }),
    });
    expect(regRes.status).toBe(201);
    const oldGarden = (await regRes.json()) as { playerId: string; token: string };
    const oldAuth = formatGardenAuth(oldGarden);

    const acctReg = await SELF.fetch(`${BASE}/api/garden/account/register`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        [GARDEN_AUTH_HEADER]: oldAuth,
      },
      body: JSON.stringify({ username: "farmer@example.com", password: "password123" }),
    });
    expect(acctReg.status).toBe(201);
    const linked = (await acctReg.json()) as {
      accountToken: string;
      username: string;
      playerId: string;
      token: string;
    };
    expect(linked.username).toBe("farmer@example.com");
    expect(linked.playerId).toBe(oldGarden.playerId);

    // Second device logs in with username/password -> gets its own token for the same garden
    const device2Login = await SELF.fetch(`${BASE}/api/garden/account/login`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username: "farmer@example.com", password: "password123" }),
    });
    expect(device2Login.status).toBe(200);
    const device2 = (await device2Login.json()) as { playerId: string; token: string };
    expect(device2.playerId).toBe(oldGarden.playerId);
    expect(device2.token).not.toBe(oldGarden.token);

    // Both Device 1 and Device 2 can still access /api/garden/state simultaneously
    const s1 = await SELF.fetch(`${BASE}/api/garden/state`, {
      headers: { origin: ORIGIN, [GARDEN_AUTH_HEADER]: oldAuth },
    });
    const s2 = await SELF.fetch(`${BASE}/api/garden/state`, {
      headers: { origin: ORIGIN, [GARDEN_AUTH_HEADER]: formatGardenAuth(device2) },
    });
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(200);
  });
});
