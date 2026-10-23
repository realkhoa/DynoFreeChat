/**
 * Wire protocol shared by the web client and the Cloudflare Worker/Durable Objects.
 *
 * Rule: `id` and `ts` of a {@link ChatMessage} are minted on the server only.
 * The client never sends them; it sends a `cid` (correlation id) instead so the
 * server can echo the acknowledgement back to the sender alone.
 *
 * Rule: a room password never travels in a URL. It is only ever a field of the
 * `join` frame (a JSON payload inside the WebSocket) or of a `POST /api/rooms`
 * body.
 */

/** Maximum number of code points accepted in one chat message. */
export const MAX_TEXT = 500;

/** Maximum number of code points accepted in a nickname. */
export const MAX_NICK = 24;

/** Maximum length of the client correlation id. */
export const MAX_CID = 64;

/** Longest excerpt kept for a quoted reply. */
export const REPLY_EXCERPT = 120;

/** Maximum number of mentions kept per message. */
export const MAX_MENTIONS = 8;

/** Maximum number of code points accepted in a room password. */
export const MAX_PASS = 64;

/** Wrong password attempts before the connection is closed. */
export const PASS_ATTEMPTS = 5;

/** Room slugs are lowercase, dash separated, 2..24 characters. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;

/** Hard cap on rooms so storage and the lobby stay bounded. */
export const MAX_ROOMS = 50;

/** Rooms idle for longer than this are pruned when the lobby is listed. */
export const ROOM_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

/** Room creations allowed per IP per window. */
export const CREATES_PER_WINDOW = 3;

/** Length of the creation rate-limit window. */
export const CREATE_WINDOW_MS = 60 * 60 * 1000;

/** Rows kept in Durable Object storage. */
export const HISTORY_LIMIT = 500;

/** Row count after a trim pass. Trimming is amortised on purpose: deletes are billed as row writes. */
export const HISTORY_TRIM_TO = 450;

/** Rows replayed to a freshly connected client. */
export const HISTORY_REPLAY = 200;

/** Hard connection cap per Durable Object. */
export const MAX_CONNECTIONS = 100;

/** Token bucket capacity per connection. */
export const RATE_CAPACITY = 5;

/** One token is refilled every this many milliseconds. */
export const RATE_REFILL_MS = 1500;

/** Colour assigned when a client sends something unparseable. */
export const DEFAULT_COLOR = "hsl(210 40% 70%)";

/** One line in the log. */
export interface ChatMessage {
  /** Server minted, `<ts base36>-<seq base36>`. */
  id: string;
  /** Server clock, milliseconds since epoch. */
  ts: number;
  nick: string;
  /** `hsl(<hue> <sat>% <light>%)`. */
  color: string;
  text: string;
  /** Denormalised snippet of the message this one answers. */
  replyTo?: ReplyRef;
}

/** Enough of the parent message to render a quote without another round-trip. */
export interface ReplyRef {
  id: string;
  nick: string;
  text: string;
}

/** One row of the public lobby. */
export interface RoomInfo {
  slug: string;
  locked: boolean;
  createdAt: number;
  lastSeen: number;
}

export type ClientFrame =
  | { t: "join"; nick: string; color: string; pass?: string }
  | { t: "msg"; cid: string; text: string; replyTo?: string };

export type ErrorCode =
  | "BAD_NICK"
  | "EMPTY"
  | "TOO_LONG"
  | "RATE_LIMIT"
  | "NOT_JOINED"
  | "FULL"
  | "DEGRADED"
  | "BAD_FRAME"
  | "BAD_SLUG"
  | "ROOM_EXISTS"
  | "ROOM_NOT_FOUND"
  | "TOO_MANY_ROOMS"
  | "TRY_LATER"
  | "BAD_PASS";

export type ServerFrame =
  | {
      t: "welcome";
      you: { nick: string; color: string };
      room: { slug: string; locked: boolean };
      history: ChatMessage[];
      online: number;
      serverTs: number;
    }
  | { t: "append"; m: ChatMessage; cid?: string }
  | { t: "presence"; online: number }
  | { t: "error"; code: ErrorCode; cid?: string; detail?: string };

export type NickResult = { ok: true; nick: string } | { ok: false; code: "BAD_NICK" };
export type TextResult = { ok: true; text: string } | { ok: false; code: "EMPTY" | "TOO_LONG" };
export type FrameResult = { ok: true; frame: ClientFrame } | { ok: false; code: "BAD_FRAME" };
export type SlugResult = { ok: true; slug: string } | { ok: false; code: "BAD_SLUG" };
export type PassResult = { ok: true; pass: string } | { ok: false; code: "TOO_LONG" };

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const TEXT_STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const COLOR_RE = /^hsl\((\d{1,3}) (\d{1,3})% (\d{1,3})%\)$/;
const BAD_FRAME: FrameResult = { ok: false, code: "BAD_FRAME" };

/** Counts Unicode code points, so an emoji counts as one character. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Drops control characters, collapses whitespace, trims, caps at {@link MAX_NICK}. */
export function sanitizeNick(raw: string): NickResult {
  const cleaned = Array.from(raw.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim())
    .slice(0, MAX_NICK)
    .join("");

  if (cleaned.length === 0) return { ok: false, code: "BAD_NICK" };
  return { ok: true, nick: cleaned };
}

/** Drops control characters except `\n`, trims, enforces {@link MAX_TEXT}. */
export function sanitizeText(raw: string): TextResult {
  const cleaned = raw.replace(TEXT_STRIP, "").trim();
  if (cleaned.length === 0) return { ok: false, code: "EMPTY" };
  if (codePointLength(cleaned) > MAX_TEXT) return { ok: false, code: "TOO_LONG" };
  return { ok: true, text: cleaned };
}

/** Accepts only `hsl(h s% l%)` with in-range components, else {@link DEFAULT_COLOR}. */
export function sanitizeColor(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_COLOR;
  const match = COLOR_RE.exec(raw.trim());
  if (!match) return DEFAULT_COLOR;

  const hue = Number(match[1]);
  const sat = Number(match[2]);
  const light = Number(match[3]);
  if (!Number.isFinite(hue) || !Number.isFinite(sat) || !Number.isFinite(light)) return DEFAULT_COLOR;
  if (hue > 360 || sat > 100 || light > 100) return DEFAULT_COLOR;

  return `hsl(${hue} ${sat}% ${light}%)`;
}

/** Lowercases, trims, and validates a room slug. */
export function sanitizeSlug(raw: unknown): SlugResult {
  if (typeof raw !== "string") return { ok: false, code: "BAD_SLUG" };
  const slug = raw.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return { ok: false, code: "BAD_SLUG" };
  return { ok: true, slug };
}

/**
 * A password is used verbatim (no trimming: a space can be intentional) and may
 * be empty, which means "open room".
 */
export function normalizePass(raw: unknown): PassResult {
  if (raw === undefined || raw === null) return { ok: true, pass: "" };
  if (typeof raw !== "string") return { ok: false, code: "TOO_LONG" };
  if (codePointLength(raw) > MAX_PASS) return { ok: false, code: "TOO_LONG" };
  return { ok: true, pass: raw };
}

/** Parses and shape-checks one client frame. Never throws. */
export function parseClientFrame(raw: string): FrameResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return BAD_FRAME;
  }

  if (typeof value !== "object" || value === null) return BAD_FRAME;
  const record = value as Record<string, unknown>;

  if (record.t === "join") {
    if (typeof record.nick !== "string") return BAD_FRAME;
    if (typeof record.color !== "string") return BAD_FRAME;
    if (record.pass !== undefined && typeof record.pass !== "string") return BAD_FRAME;
    return record.pass === undefined
      ? { ok: true, frame: { t: "join", nick: record.nick, color: record.color } }
      : { ok: true, frame: { t: "join", nick: record.nick, color: record.color, pass: record.pass } };
  }

  if (record.t === "msg") {
    const cid = record.cid;
    if (typeof cid !== "string" || cid.length === 0 || cid.length > MAX_CID) return BAD_FRAME;
    if (typeof record.text !== "string") return BAD_FRAME;
    if (record.replyTo !== undefined) {
      if (typeof record.replyTo !== "string") return BAD_FRAME;
      if (record.replyTo.length === 0 || record.replyTo.length > 40) return BAD_FRAME;
      return { ok: true, frame: { t: "msg", cid, text: record.text, replyTo: record.replyTo } };
    }
    return { ok: true, frame: { t: "msg", cid, text: record.text } };
  }

  return BAD_FRAME;
}

/** Stable, sortable-by-prefix message id. */
export function makeMessageId(ts: number, seq: number): string {
  return `${ts.toString(36)}-${seq.toString(36)}`;
}

/** Truncates a message to a quote-sized excerpt. */
export function makeExcerpt(text: string, limit = REPLY_EXCERPT): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= limit) return chars.join("");
  return `${chars.slice(0, limit - 1).join("")}…`;
}

/**
 * Nicknames cannot contain spaces, so a mention is `@` followed by letters,
 * digits, `_`, `.` or `-`. Anything else ends the mention.
 */
const MENTION_RE = /@([\p{L}\p{N}_](?:[\p{L}\p{N}_.-]{0,22}[\p{L}\p{N}_])?)/gu;

/** Unique nicknames mentioned in a message, in first-appearance order. */
export function extractMentions(text: string, limit = MAX_MENTIONS): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];

  for (const match of text.matchAll(MENTION_RE)) {
    const nick = match[1];
    if (nick === undefined) continue;
    const key = nick.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(nick);
    if (mentions.length >= limit) break;
  }

  return mentions;
}

/** True when `text` mentions `nick` (case-insensitive). */
export function mentionsNick(text: string, nick: string): boolean {
  const target = nick.trim().toLowerCase();
  if (target.length === 0) return false;
  return extractMentions(text).some((mention) => mention.toLowerCase() === target);
}

export type TextSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; nick: string };

/** Splits a message into plain runs and `@mention` runs for rendering. */
export function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MENTION_RE)) {
    const at = match.index ?? 0;
    if (at > cursor) segments.push({ kind: "text", value: text.slice(cursor, at) });
    const nick = match[1] ?? "";
    segments.push({ kind: "mention", value: `@${nick}`, nick });
    cursor = at + match[0].length;
  }

  if (cursor < text.length) segments.push({ kind: "text", value: text.slice(cursor) });
  return segments;
}