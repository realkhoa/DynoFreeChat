import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, createRoom, uniqueIp, uniqueSlug } from "./helpers";

describe("worker router", () => {
  it("answers /health", async () => {
    const response = await SELF.fetch(`${BASE}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("404s an unknown path", async () => {
    const response = await SELF.fetch(`${BASE}/nope`);
    expect(response.status).toBe(404);
  });

  it("403s a foreign origin", async () => {
    const response = await SELF.fetch(`${BASE}/api/rooms`, {
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("handles CORS preflight from the allowed origin", async () => {
    const response = await SELF.fetch(`${BASE}/api/rooms`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("426s /ws without an upgrade header", async () => {
    const response = await SELF.fetch(`${BASE}/ws?r=abc`, { headers: { origin: ORIGIN } });
    expect(response.status).toBe(426);
  });

  it("400s /ws with an invalid slug", async () => {
    const response = await SELF.fetch(`${BASE}/ws?r=NOPE_!`, {
      headers: { upgrade: "websocket", origin: ORIGIN },
    });
    expect(response.status).toBe(400);
  });
});

describe("room api", () => {
  it("creates a room and lists it", async () => {
    const slug = uniqueSlug();
    const created = await createRoom({ slug });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ slug });

    const list = await SELF.fetch(`${BASE}/api/rooms`, { headers: { origin: ORIGIN } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { rooms: Array<{ slug: string; locked: boolean }> };
    const found = body.rooms.find((room) => room.slug === slug);
    expect(found).toMatchObject({ slug, locked: false });
  });

  it("marks a room with a password as locked and never returns the password", async () => {
    const slug = uniqueSlug();
    const response = await createRoom({ slug, pass: "hunter2" });
    expect(response.status).toBe(201);
    expect(await response.text()).not.toContain("hunter2");

    const list = await SELF.fetch(`${BASE}/api/rooms`, { headers: { origin: ORIGIN } });
    const body = (await list.json()) as { rooms: Array<{ slug: string; locked: boolean }> };
    expect(body.rooms.find((room) => room.slug === slug)?.locked).toBe(true);
  });

  it("409s a duplicate slug", async () => {
    const slug = uniqueSlug();
    expect((await createRoom({ slug })).status).toBe(201);
    expect((await createRoom({ slug })).status).toBe(409);
  });

  it("400s an invalid slug", async () => {
    expect((await createRoom({ slug: "Bad Slug!" })).status).toBe(400);
    expect((await createRoom({ slug: "x" })).status).toBe(400);
  });

  it("429s the fourth room from one ip within the window", async () => {
    const ip = uniqueIp();
    const post = () =>
      SELF.fetch(`${BASE}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip, origin: ORIGIN },
        body: JSON.stringify({ slug: uniqueSlug() }),
      });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
  });
});
