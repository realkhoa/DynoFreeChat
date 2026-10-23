import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_COLOR,
  HISTORY_LIMIT,
  HISTORY_REPLAY,
  HISTORY_TRIM_TO,
  MAX_CONNECTIONS,
  PASS_ATTEMPTS,
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
  bucket: Bucket;
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
}>;

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
      online: this.ctx.getWebSockets().length,
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

    this.persist(message);

    for (const peer of this.ctx.getWebSockets()) {
      this.send(peer, peer === ws ? { t: "append", m: message, cid: frame.cid } : { t: "append", m: message });
    }
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
    // C7: counted once per wake, never per message.
    this.rowCount = this.sql.exec<CountRow>("SELECT COUNT(*) AS n FROM messages").toArray()[0]?.n ?? 0;
    this.ready = true;
  }

  private history(limit: number): ChatMessage[] {
    try {
      this.ensureReady();
      return this.sql
        .exec<MessageRow>(
          "SELECT id, ts, nick, color, text FROM messages ORDER BY ts DESC LIMIT ?",
          limit,
        )
        .toArray()
        .reverse();
    } catch {
      this.markDegraded();
      return [];
    }
  }

  private persist(message: ChatMessage): void {
    try {
      this.ensureReady();
      this.sql.exec(
        "INSERT INTO messages (id, ts, nick, color, text) VALUES (?, ?, ?, ?, ?)",
        message.id,
        message.ts,
        message.nick,
        message.color,
        message.text,
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
    if (typeof stored === "object" && stored !== null) return stored as Conn;

    return {
      slug: "",
      nick: "",
      color: DEFAULT_COLOR,
      bucket: newBucket(Date.now()),
      authed: false,
      locked: false,
      attempts: 0,
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
    const peers = this.ctx.getWebSockets().filter((peer) => peer !== excluded);
    const frame: ServerFrame = { t: "presence", online: peers.length };
    for (const peer of peers) this.send(peer, frame);
  }
}
