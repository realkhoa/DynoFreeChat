// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { LockClient, LOCK_STORAGE_KEY } from "@/features/lock/lock";

/** In-memory storage stand-in. */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/**
 * @brief Builds a fetch stand-in that answers one scripted response.
 * @param body Response body.
 * @param status HTTP status.
 * @return The fetch function plus its spy.
 */
function fetchReturning(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return { fetchImpl: spy as unknown as typeof fetch, spy };
}

describe("LockClient", () => {
  it("reads the gate state without a token", async () => {
    const { fetchImpl, spy } = fetchReturning({ required: true, unlocked: false });
    const client = new LockClient("https://api.example", new MemoryStorage(), fetchImpl);

    await expect(client.state()).resolves.toEqual({ required: true, unlocked: false });
    expect(spy).toHaveBeenCalledWith("https://api.example/api/auth/state", { headers: {} });
  });

  it("sends the stored token when checking the state", async () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCK_STORAGE_KEY, "999.sig");
    const { fetchImpl, spy } = fetchReturning({ required: true, unlocked: true });
    const client = new LockClient("https://api.example", storage, fetchImpl);

    await client.state();
    expect(spy).toHaveBeenCalledWith("https://api.example/api/auth/state", {
      headers: { "x-dyno-lock": "999.sig" },
    });
  });

  it("stores the signed token after a successful unlock", async () => {
    const storage = new MemoryStorage();
    const { fetchImpl } = fetchReturning({ ok: true, token: "123.sig" });
    const client = new LockClient("https://api.example", storage, fetchImpl);

    await expect(client.unlock({ pin: "1234" })).resolves.toBe(true);
    expect(storage.getItem(LOCK_STORAGE_KEY)).toBe("123.sig");
    expect(client.token).toBe("123.sig");
  });

  it("keeps the previous token when the credential is refused", async () => {
    const storage = new MemoryStorage();
    const { fetchImpl } = fetchReturning({ code: "BAD_CREDENTIAL" }, 401);
    const client = new LockClient("https://api.example", storage, fetchImpl);

    await expect(client.unlock({ token: "nope" })).resolves.toBe(false);
    expect(client.token).toBeNull();
  });

  it("reports an open gate when the Worker is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("failed to fetch");
    }) as unknown as typeof fetch;
    const client = new LockClient("https://api.example", new MemoryStorage(), fetchImpl);
    await expect(client.state()).resolves.toEqual({ required: false, unlocked: true });
  });

  it("clears the stored token on sign out", () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCK_STORAGE_KEY, "123.sig");
    const client = new LockClient("https://api.example", storage, fetchReturning({}).fetchImpl);

    client.clear();
    expect(client.token).toBeNull();
  });

  it("works without storage (private mode)", async () => {
    const { fetchImpl } = fetchReturning({ ok: true, token: "123.sig" });
    const client = new LockClient("https://api.example", null, fetchImpl);
    await expect(client.unlock({ token: "abc" })).resolves.toBe(true);
    expect(client.token).toBeNull();
  });
});
