/**
 * Wire protocol shared by the web client and the Cloudflare Worker/Durable Object.
 *
 * Rule: `id` and `ts` of a {@link ChatMessage} are minted on the server only.
 * The client never sends them; it sends a `cid` (correlation id) instead so the
 * server can echo the acknowledgement back to the sender alone.
 */

/** Maximum number of code points accepted in one chat message. */
export const MAX_TEXT = 500;

/** Maximum number of code points accepted in a nickname. */
export const MAX_NICK = 24;

/** Maximum length of the client correlation id. */
export const MAX_CID = 64;

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
}

export type ClientFrame =
  | { t: "join"; nick: string; color: string }
  | { t: "msg"; cid: string; text: string };

export type ErrorCode =
  | "BAD_NICK"
  | "EMPTY"
  | "TOO_LONG"
  | "RATE_LIMIT"
  | "NOT_JOINED"
  | "FULL"
  | "DEGRADED"
  | "BAD_FRAME";

export type ServerFrame =
  | {
      t: "welcome";
      you: { nick: string; color: string };
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
    return { ok: true, frame: { t: "join", nick: record.nick, color: record.color } };
  }

  if (record.t === "msg") {
    const cid = record.cid;
    if (typeof cid !== "string" || cid.length === 0 || cid.length > MAX_CID) return BAD_FRAME;
    if (typeof record.text !== "string") return BAD_FRAME;
    return { ok: true, frame: { t: "msg", cid, text: record.text } };
  }

  return BAD_FRAME;
}

/** Stable, sortable-by-prefix message id. */
export function makeMessageId(ts: number, seq: number): string {
  return `${ts.toString(36)}-${seq.toString(36)}`;
}
