import { DurableObject } from "cloudflare:workers";
import {
  CREATES_PER_WINDOW,
  CREATE_WINDOW_MS,
  GAME_ROOM_IDLE_MS,
  MAX_ROOMS,
  ROOM_IDLE_MS,
  normalizePass,
  parseRoomKind,
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
  kind: string;
}>;

type ListRow = SqlRow<{
  slug: string;
  locked: number;
  createdAt: number;
  lastSeen: number;
  kind: string;
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
         lastSeen INTEGER NOT NULL,
         kind TEXT NOT NULL DEFAULT 'chat'
       )`,
    );
    // Rooms created before the chat/game split have no kind column yet.
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(rooms)").toArray();
    if (!columns.some((column) => column.name === "kind")) {
      this.sql.exec("ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'");
      // One-time backfill: slugs that look like the online games become game rooms.
      this.sql.exec(
        "UPDATE rooms SET kind = 'game' WHERE slug LIKE 'caro-%' OR slug LIKE 'battleship-%' OR slug LIKE 'chess-%' OR slug LIKE 'tienlen-%' OR slug LIKE 'gunny-%' OR slug LIKE 'shooter-%'",
      );
    }
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
    if (request.method === "GET" && url.pathname === "/list") return this.list(request);
    if (request.method === "POST" && url.pathname === "/purge") return this.purge(request);
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

  /** `CREATES_PER_WINDOW` rooms per IP per window. Keeps a bot from filling the
   * lobby with junk while still letting a group behind one NAT open rooms. */
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

    const kind = parseRoomKind(body.kind) ?? "chat";
    const salt = randomSalt();
    const locked = pass.pass.length > 0;
    const hash = locked ? await hashPass(salt, slug.slug, pass.pass) : "";

    this.sql.exec(
      "INSERT INTO rooms (slug, salt, hash, locked, createdAt, lastSeen, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
      slug.slug,
      salt,
      hash,
      locked ? 1 : 0,
      now,
      now,
      kind,
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
        "SELECT slug, salt, hash, locked, createdAt, lastSeen, kind FROM rooms WHERE slug = ?",
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

  /**
   * @brief Deletes rooms in bulk. Lock-gated in the router; used to clean test litter.
   * @param request JSON body: `kind` (optional), `keep` (slugs to preserve) and
   * `prefixes` (slug prefixes to preserve).
   * @return How many rooms were deleted.
   */
  private async purge(request: Request): Promise<Response> {
    const body = await readJson(request);
    const kind = parseRoomKind(body.kind);

    const keep: string[] = [];
    if (Array.isArray(body.keep)) {
      for (const entry of body.keep) {
        const slug = sanitizeSlug(entry);
        if (slug.ok) keep.push(slug.slug);
      }
    }

    const prefixes: string[] = [];
    if (Array.isArray(body.prefixes)) {
      for (const entry of body.prefixes) {
        if (typeof entry === "string" && /^[a-z0-9-]{1,16}$/.test(entry)) prefixes.push(entry);
      }
    }

    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (kind !== null) {
      conditions.push("kind = ?");
      params.push(kind);
    }
    if (keep.length > 0) {
      conditions.push(`slug NOT IN (${keep.map(() => "?").join(", ")})`);
      params.push(...keep);
    }
    if (prefixes.length > 0) {
      conditions.push(`NOT (${prefixes.map(() => "slug LIKE ?").join(" OR ")})`);
      params.push(...prefixes.map((prefix) => `${prefix}%`));
    }

    const before = this.roomCount();
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    this.sql.exec(`DELETE FROM rooms${where}`, ...params);
    const after = this.roomCount();
    return json({ deleted: before - after, remaining: after }, 200);
  }

  private list(request: Request): Response {
    const now = Date.now();
    // One statement per kind, so idle rooms cost one row write for the whole
    // prune pass and never a per-room request. Game rooms expire far sooner.
    this.sql.exec("DELETE FROM rooms WHERE kind = 'chat' AND lastSeen < ?", now - ROOM_IDLE_MS);
    this.sql.exec("DELETE FROM rooms WHERE kind = 'game' AND lastSeen < ?", now - GAME_ROOM_IDLE_MS);

    const filter = parseRoomKind(new URL(request.url).searchParams.get("kind"));
    const rows =
      filter === null
        ? this.sql
            .exec<ListRow>(
              "SELECT slug, locked, createdAt, lastSeen, kind FROM rooms ORDER BY lastSeen DESC LIMIT ?",
              MAX_ROOMS,
            )
            .toArray()
        : this.sql
            .exec<ListRow>(
              "SELECT slug, locked, createdAt, lastSeen, kind FROM rooms WHERE kind = ? ORDER BY lastSeen DESC LIMIT ?",
              filter,
              MAX_ROOMS,
            )
            .toArray();

    const rooms: RoomInfo[] = rows.map((row) => ({
      slug: row.slug,
      locked: row.locked === 1,
      createdAt: row.createdAt,
      lastSeen: row.lastSeen,
      kind: row.kind === "game" ? "game" : "chat",
    }));

    return json({ rooms }, 200);
  }

  private info(request: Request): Response {
    const url = new URL(request.url);
    const slug = sanitizeSlug(url.searchParams.get("slug"));
    if (!slug.ok) return json({ code: "BAD_SLUG" }, 400);

    const row = this.sql.exec<RoomRow>("SELECT locked FROM rooms WHERE slug = ?", slug.slug).toArray()[0];

    if (row === undefined) return json({ code: "ROOM_NOT_FOUND" }, 404);
    return json({ slug: slug.slug, locked: row.locked === 1 }, 200);
  }
}
