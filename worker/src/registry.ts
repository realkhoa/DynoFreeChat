import { DurableObject } from "cloudflare:workers";
import {
  CREATES_PER_WINDOW,
  CREATE_WINDOW_MS,
  MAX_ROOMS,
  ROOM_IDLE_MS,
  normalizePass,
  sanitizeSlug,
  type RoomInfo,
} from "@dyno/shared/protocol";
import type { Env } from "./env";
import { json, readJson } from "./http";
import { hashPass, randomSalt, timingSafeEqualHex } from "./pass";
import type { SqlRow } from "./sql";

type RoomRow = SqlRow<{
  slug: string;
  salt: string;
  hash: string;
  locked: number;
  createdAt: number;
  lastSeen: number;
}>;

type ListRow = SqlRow<{
  slug: string;
  locked: number;
  createdAt: number;
  lastSeen: number;
}>;

type CountRow = SqlRow<{ n: number }>;

type CreateRow = SqlRow<{ windowStart: number; count: number }>;

/**
 * The lobby: the single source of truth for which rooms exist and what their
 * password hash is. A `Room` never knows a password — it asks this object.
 */
export class Registry extends DurableObject<Env> {
  private ready = false;

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private ensureSchema(): void {
    if (this.ready) return;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS rooms (
         slug TEXT PRIMARY KEY,
         salt TEXT NOT NULL,
         hash TEXT NOT NULL,
         locked INTEGER NOT NULL,
         createdAt INTEGER NOT NULL,
         lastSeen INTEGER NOT NULL
       )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS creates (
         ip TEXT PRIMARY KEY,
         windowStart INTEGER NOT NULL,
         count INTEGER NOT NULL
       )`,
    );
    this.ready = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/create") return this.create(request);
    if (request.method === "POST" && url.pathname === "/verify") return this.verify(request);
    if (request.method === "GET" && url.pathname === "/list") return this.list();
    if (request.method === "GET" && url.pathname === "/info") return this.info(request);

    return json({ code: "NOT_FOUND" }, 404);
  }

  private roomCount(): number {
    const rows = this.sql.exec<CountRow>("SELECT COUNT(*) AS n FROM rooms").toArray();
    return rows[0]?.n ?? 0;
  }

  private exists(slug: string): boolean {
    return this.sql.exec<RoomRow>("SELECT slug FROM rooms WHERE slug = ?", slug).toArray().length > 0;
  }

  /** 3 rooms per IP per hour. Keeps a bot from filling the lobby with junk. */
  private allowCreate(ip: string, now: number): boolean {
    const row = this.sql
      .exec<CreateRow>("SELECT windowStart, count FROM creates WHERE ip = ?", ip)
      .toArray()[0];

    if (row === undefined || now - row.windowStart > CREATE_WINDOW_MS) {
      this.sql.exec(
        "INSERT INTO creates (ip, windowStart, count) VALUES (?, ?, 1) ON CONFLICT(ip) DO UPDATE SET windowStart = excluded.windowStart, count = 1",
        ip,
        now,
      );
      return true;
    }

    if (row.count >= CREATES_PER_WINDOW) return false;
    this.sql.exec("UPDATE creates SET count = count + 1 WHERE ip = ?", ip);
    return true;
  }

  private async create(request: Request): Promise<Response> {
    const body = await readJson(request);

    const slug = sanitizeSlug(body.slug);
    if (!slug.ok) return json({ code: "BAD_SLUG" }, 400);

    const pass = normalizePass(body.pass);
    if (!pass.ok) return json({ code: "TOO_LONG" }, 400);

    if (this.roomCount() >= MAX_ROOMS) return json({ code: "TOO_MANY_ROOMS" }, 507);
    if (this.exists(slug.slug)) return json({ code: "ROOM_EXISTS" }, 409);

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const now = Date.now();
    if (!this.allowCreate(ip, now)) return json({ code: "TRY_LATER" }, 429);

    const salt = randomSalt();
    const locked = pass.pass.length > 0;
    const hash = locked ? await hashPass(salt, slug.slug, pass.pass) : "";

    this.sql.exec(
      "INSERT INTO rooms (slug, salt, hash, locked, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?, ?)",
      slug.slug,
      salt,
      hash,
      locked ? 1 : 0,
      now,
      now,
    );

    return json({ slug: slug.slug }, 201);
  }

  private async verify(request: Request): Promise<Response> {
    const body = await readJson(request);

    const slug = sanitizeSlug(body.slug);
    if (!slug.ok) return json({ code: "BAD_SLUG" }, 400);

    const pass = normalizePass(body.pass);
    if (!pass.ok) return json({ code: "TOO_LONG" }, 400);

    const row = this.sql
      .exec<RoomRow>(
        "SELECT slug, salt, hash, locked, createdAt, lastSeen FROM rooms WHERE slug = ?",
        slug.slug,
      )
      .toArray()[0];

    if (row === undefined) return json({ code: "ROOM_NOT_FOUND" }, 404);

    if (row.locked === 1) {
      const candidate = await hashPass(row.salt, row.slug, pass.pass);
      if (!timingSafeEqualHex(candidate, row.hash)) return json({ code: "BAD_PASS" }, 403);
    }

    this.sql.exec("UPDATE rooms SET lastSeen = ? WHERE slug = ?", Date.now(), row.slug);
    return json({ ok: true, slug: row.slug, locked: row.locked === 1 }, 200);
  }

  private list(): Response {
    // One statement, so idle rooms cost one row write for the whole prune pass
    // and never a per-room request.
    this.sql.exec("DELETE FROM rooms WHERE lastSeen < ?", Date.now() - ROOM_IDLE_MS);

    const rows = this.sql
      .exec<ListRow>(
        "SELECT slug, locked, createdAt, lastSeen FROM rooms ORDER BY lastSeen DESC LIMIT ?",
        MAX_ROOMS,
      )
      .toArray();

    const rooms: RoomInfo[] = rows.map((row) => ({
      slug: row.slug,
      locked: row.locked === 1,
      createdAt: row.createdAt,
      lastSeen: row.lastSeen,
    }));

    return json({ rooms }, 200);
  }

  private info(request: Request): Response {
    const url = new URL(request.url);
    const slug = sanitizeSlug(url.searchParams.get("slug"));
    if (!slug.ok) return json({ code: "BAD_SLUG" }, 400);

    const row = this.sql
      .exec<RoomRow>("SELECT locked FROM rooms WHERE slug = ?", slug.slug)
      .toArray()[0];

    if (row === undefined) return json({ code: "ROOM_NOT_FOUND" }, 404);
    return json({ slug: slug.slug, locked: row.locked === 1 }, 200);
  }
}
