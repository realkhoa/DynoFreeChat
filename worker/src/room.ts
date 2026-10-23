import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_COLOR,
  GAME_CAPACITY,
  GAME_REFILL_MS,
  HISTORY_LIMIT,
  HISTORY_REPLAY,
  HISTORY_TRIM_TO,
  MAX_CONNECTIONS,
  PASS_ATTEMPTS,
  makeExcerpt,
  makeMessageId,
  parseClientFrame,
  sanitizeColor,
  sanitizeNick,
  sanitizeSlug,
  sanitizeText,
  type ChatMessage,
  type ClientFrame,
  type ErrorCode,
  type ServerFrame,
} from "@dyno/shared/protocol";
import { newBucket, take, type Bucket } from "@dyno/shared/ratelimit";
import type { Env } from "./env";
import { json } from "./http";
import type { SqlRow } from "./sql";

interface Conn {
  slug: string;
  nick: string;
  color: string;
  /** Chat token bucket: persisted messages are the expensive ones. */
  bucket: Bucket;
  /** Game token bucket: ephemeral frames, much more headroom than chat. */
  gameBucket: Bucket;
  authed: boolean;
  locked: boolean;
  attempts: number;
}

type MessageRow = SqlRow<{
  id: string;
  ts: number;
  nick: string;
  color: string;
  text: string;
  reply_id: string | null;
  reply_nick: string | null;
  reply_text: string | null;
}>;

type ParentRow = SqlRow<{ nick: string; text: string }>;

type CountRow = SqlRow<{ n: number }>;

type VerifyResult =
  | { ok: true; locked: boolean }
  | { ok: false; code: "BAD_PASS" | "ROOM_NOT_FOUND" | "TRY_LATER" };

/**
 * One chat room: message history in SQLite storage plus a hibernatable
 * WebSocket fan-out. Passwords are never seen here — every join is verified by
 * the `Registry` object.
 */
export class ChatRoom extends DurableObject<Env> {
  private ready = false;
  private degraded = false;
  private rowCount = 0;
  private seq = 0;

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/ws") {
      return json({ code: "NOT_FOUND" }, 404);
    }

    const slug = sanitizeSlug(url.searchParams.get("r"));
    if (!slug.ok) return json({ code: "BAD_SLUG" }, 400);

    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return json({ code: "FULL" }, 503);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // C2 (cost guardrail): hibernation, so an idle room is not billed wall-clock
    // duration. Replacing this with `server.accept()` would cost ~11k GB-s/day
    // for one open socket and burn the free tier.
    this.ctx.acceptWebSocket(server);

    const conn: Conn = {
      slug: slug.slug,
      nick: "",
      color: DEFAULT_COLOR,
      bucket: newBucket(Date.now()),
      gameBucket: newBucket(Date.now(), GAME_CAPACITY),
      authed: false,
      locked: false,
      attempts: 0,
    };
    server.serializeAttachment(conn);

    try {
      this.ensureReady();
    } catch {
      this.markDegraded();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;

    const parsed = parseClientFrame(raw);
    if (!parsed.ok) {
      this.sendError(ws, "BAD_FRAME");
      return;
    }

    if (parsed.frame.t === "join") {
      await this.handleJoin(ws, parsed.frame);
      return;
    }

    if (parsed.frame.t === "game") {
      this.handleGame(ws, parsed.frame);
      return;
    }

    this.handleMessage(ws, parsed.frame);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already gone; presence recalculation below is all that matters.
    }
    this.broadcastPresence(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.broadcastPresence(ws);
  }

  // ---------------------------------------------------------------- handlers

  private async handleJoin(ws: WebSocket, frame: Extract<ClientFrame, { t: "join" }>): Promise<void> {
    const conn = this.readConn(ws);

    const nick = sanitizeNick(frame.nick);
    if (!nick.ok) {
      this.sendError(ws, "BAD_NICK");
      return;
    }

    if (!conn.authed) {
      const verified = await this.verify(conn.slug, frame.pass ?? "");
      if (!verified.ok) {
        conn.attempts += 1;
        ws.serializeAttachment(conn);
        this.sendError(ws, verified.code);
        if (verified.code === "ROOM_NOT_FOUND" || conn.attempts >= PASS_ATTEMPTS) {
          try {
            ws.close(4403, verified.code);
          } catch {
            // Closing a dead socket is not an error worth surfacing.
          }
        }
        return;
      }
      conn.authed = true;
      conn.locked = verified.locked;
    }

    conn.nick = nick.nick;
    conn.color = sanitizeColor(frame.color);
    ws.serializeAttachment(conn);

    this.send(ws, {
      t: "welcome",
      you: { nick: conn.nick, color: conn.color },
      room: { slug: conn.slug, locked: conn.locked },
      history: this.history(HISTORY_REPLAY),
      online: this.authedSockets().length,
      serverTs: Date.now(),
    });

    this.broadcastPresence();
  }

  private handleMessage(ws: WebSocket, frame: Extract<ClientFrame, { t: "msg" }>): void {
    const conn = this.readConn(ws);
    if (!conn.authed) {
      this.sendError(ws, "NOT_JOINED", frame.cid);
      return;
    }

    const text = sanitizeText(frame.text);
    if (!text.ok) {
      this.sendError(ws, text.code, frame.cid);
      return;
    }

    const rush = take(conn.bucket, Date.now());
    conn.bucket = rush.bucket;
    ws.serializeAttachment(conn);
    if (!rush.ok) {
      this.sendError(ws, "RATE_LIMIT", frame.cid, String(rush.retryInMs));
      return;
    }

    const ts = Date.now();
    this.seq = (this.seq + 1) % Number.MAX_SAFE_INTEGER;
    const message: ChatMessage = {
      id: makeMessageId(ts, this.seq),
      ts,
      nick: conn.nick,
      color: conn.color,
      text: text.text,
    };

    // A reply is quoted from the stored parent, so the excerpt survives even if
    // the parent is later trimmed out of history.
    if (frame.replyTo !== undefined) {
      try {
        this.ensureReady();
        const parent = this.sql
          .exec<ParentRow>("SELECT nick, text FROM messages WHERE id = ?", frame.replyTo)
          .toArray()[0];
        if (parent !== undefined) {
          message.replyTo = { id: frame.replyTo, nick: parent.nick, text: makeExcerpt(parent.text) };
        }
      } catch {
        this.markDegraded();
      }
    }

    this.persist(message);

    for (const peer of this.ctx.getWebSockets()) {
      this.send(peer, peer === ws ? { t: "append", m: message, cid: frame.cid } : { t: "append", m: message });
    }
  }

  /**
   * Ephemeral peer-to-peer relay used by the in-room games. Nothing here is
   * persisted, replayed in `history`, or counted as chat: a move is a transport
   * event, not a message. The sender is excluded because it already applied its
   * own move locally.
   */
  private handleGame(ws: WebSocket, frame: Extract<ClientFrame, { t: "game" }>): void {
    const conn = this.readConn(ws);
    if (!conn.authed) {
      this.sendError(ws, "NOT_JOINED");
      return;
    }

    const rush = take(conn.gameBucket, Date.now(), GAME_CAPACITY, GAME_REFILL_MS);
    conn.gameBucket = rush.bucket;
    ws.serializeAttachment(conn);
    if (!rush.ok) {
      this.sendError(ws, "RATE_LIMIT", undefined, String(rush.retryInMs));
      return;
    }

    const relay: ServerFrame = { t: "game", data: frame.data, nick: conn.nick };
    for (const peer of this.authedSockets(ws)) this.send(peer, relay);
  }

  /**
   * Sockets that finished joining. A socket is accepted before its `join` is
   * verified, and treating such a socket as a player would both inflate the
   * presence count and deliver frames to a client that cannot yet act on them.
   * @param excluded Socket to leave out, normally the sender.
   * @return Authenticated peers.
   */
  private authedSockets(excluded?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((peer) => peer !== excluded && this.readConn(peer).authed);
  }

  private async verify(slug: string, pass: string): Promise<VerifyResult> {
    try {
      const stub = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("registry"));
      const response = await stub.fetch("https://registry/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, pass }),
      });

      const body = (await response.json()) as { ok?: boolean; locked?: boolean; code?: string };
      if (response.ok && body.ok === true) return { ok: true, locked: body.locked === true };
      if (body.code === "BAD_PASS" || body.code === "ROOM_NOT_FOUND") {
        return { ok: false, code: body.code };
      }
      return { ok: false, code: "TRY_LATER" };
    } catch {
      return { ok: false, code: "TRY_LATER" };
    }
  }

  // ----------------------------------------------------------------- storage

  private ensureReady(): void {
    if (this.ready) return;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
         id TEXT PRIMARY KEY,
         ts INTEGER NOT NULL,
         nick TEXT NOT NULL,
         color TEXT NOT NULL,
         text TEXT NOT NULL
       )`,
    );
    // Reply columns were added after the first deploy: ALTER is idempotent here
    // because a duplicate column simply throws and is ignored.
    for (const column of ["reply_id TEXT", "reply_nick TEXT", "reply_text TEXT"]) {
      try {
        this.sql.exec(`ALTER TABLE messages ADD COLUMN ${column}`);
      } catch {
        // Already present.
      }
    }
    // C7: counted once per wake, never per message.
    this.rowCount = this.sql.exec<CountRow>("SELECT COUNT(*) AS n FROM messages").toArray()[0]?.n ?? 0;
    this.ready = true;
  }

  private history(limit: number): ChatMessage[] {
    try {
      this.ensureReady();
      return this.sql
        .exec<MessageRow>(
          "SELECT id, ts, nick, color, text, reply_id, reply_nick, reply_text FROM messages ORDER BY ts DESC LIMIT ?",
          limit,
        )
        .toArray()
        .reverse()
        .map((row) => {
          const message: ChatMessage = {
            id: row.id,
            ts: row.ts,
            nick: row.nick,
            color: row.color,
            text: row.text,
          };
          if (row.reply_id !== null && row.reply_nick !== null && row.reply_text !== null) {
            message.replyTo = { id: row.reply_id, nick: row.reply_nick, text: row.reply_text };
          }
          return message;
        });
    } catch {
      this.markDegraded();
      return [];
    }
  }

  private persist(message: ChatMessage): void {
    try {
      this.ensureReady();
      this.sql.exec(
        "INSERT INTO messages (id, ts, nick, color, text, reply_id, reply_nick, reply_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        message.id,
        message.ts,
        message.nick,
        message.color,
        message.text,
        message.replyTo?.id ?? null,
        message.replyTo?.nick ?? null,
        message.replyTo?.text ?? null,
      );
      this.rowCount += 1;
      this.trimIfNeeded();
    } catch {
      this.markDegraded();
    }
  }

  /** C5: deletes are billed as row writes, so remove in one amortised batch. */
  private trimIfNeeded(): void {
    if (this.rowCount <= HISTORY_LIMIT) return;
    const remove = this.rowCount - HISTORY_TRIM_TO;
    this.sql.exec(
      "DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY ts ASC LIMIT ?)",
      remove,
    );
    this.rowCount -= remove;
  }

  /** C8: keep chatting from memory when storage refuses writes. */
  private markDegraded(): void {
    if (this.degraded) return;
    this.degraded = true;
    const frame: ServerFrame = {
      t: "error",
      code: "DEGRADED",
      detail: "history storage unavailable; chat continues in memory",
    };
    for (const peer of this.ctx.getWebSockets()) this.send(peer, frame);
  }

  // ------------------------------------------------------------------ frames

  private readConn(ws: WebSocket): Conn {
    let stored: unknown;
    try {
      stored = ws.deserializeAttachment();
    } catch {
      stored = undefined;
    }

    const now = Date.now();
    const blank: Conn = {
      slug: "",
      nick: "",
      color: DEFAULT_COLOR,
      bucket: newBucket(now),
      gameBucket: newBucket(now, GAME_CAPACITY),
      authed: false,
      locked: false,
      attempts: 0,
    };

    if (typeof stored !== "object" || stored === null) return blank;

    // Attachments survive hibernation and upgrades, so an object written by an
    // older build may lack a bucket. Normalise instead of trusting the shape.
    const partial = stored as Partial<Conn>;
    return {
      slug: typeof partial.slug === "string" ? partial.slug : blank.slug,
      nick: typeof partial.nick === "string" ? partial.nick : blank.nick,
      color: typeof partial.color === "string" ? partial.color : blank.color,
      bucket: partial.bucket ?? blank.bucket,
      gameBucket: partial.gameBucket ?? blank.gameBucket,
      authed: partial.authed === true,
      locked: partial.locked === true,
      attempts: typeof partial.attempts === "number" ? partial.attempts : 0,
    };
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // Peer vanished between listing and sending; presence follows.
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, cid?: string, detail?: string): void {
    this.send(ws, cid === undefined ? { t: "error", code, detail } : { t: "error", code, cid, detail });
  }

  private broadcastPresence(excluded?: WebSocket): void {
    const peers = this.authedSockets(excluded);
    const frame: ServerFrame = { t: "presence", online: peers.length };
    for (const peer of peers) this.send(peer, frame);
  }
}
