/**
 * @file protocol.ts
 * @brief JSON messages exchanged through the Worker's opaque `game` frame relay.
 * @details The relay only carries a string between joined sockets, so the match
 * protocol rides on top: a hello handshake elects the host, the host picks the
 * seed and starts the game, and then both sides relay moves. Everything is
 * validated on receipt so a malformed or hostile frame cannot throw inside the
 * game loop.
 */

/** Protocol version; bump when a message shape changes. */
export const MATCH_PROTOCOL_VERSION = 1;

/** Hello: sent by both sides as soon as the room socket joins. */
export interface HelloMessage {
  k: "hello";
  v: number;
  /** Random per-session id; the lexicographically smaller id hosts. */
  id: string;
  /** Game id the player wants to play. */
  game: string;
  /** Display name of the player. */
  nick: string;
}

/** Start: sent by the host once both hellos arrived. */
export interface StartMessage {
  k: "start";
  v: number;
  /** Shared seed for the starting position. */
  seed: number;
  /** Game id being played. */
  game: string;
}

/** Move: one relayed local move. */
export interface MoveMessage {
  k: "move";
  /** Monotonic sequence number per sender. */
  seq: number;
  /** Game-specific payload. */
  payload: unknown;
}

/** Resign / leave notice. */
export interface ByeMessage {
  k: "bye";
}

/** Any message the protocol understands. */
export type MatchMessage = HelloMessage | StartMessage | MoveMessage | ByeMessage;

/**
 * @brief Encodes one message for the relay.
 * @param message Message to encode.
 * @return JSON string.
 */
export function encodeMessage(message: MatchMessage): string {
  return JSON.stringify(message);
}

/**
 * @brief Decodes one relayed frame, rejecting anything malformed.
 * @param raw Frame payload string.
 * @return The message, or `null` when it is not a valid protocol message.
 */
export function decodeMessage(raw: string): MatchMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const kind = record.k;

  if (kind === "hello") {
    if (typeof record.id !== "string" || record.id.length === 0) return null;
    if (typeof record.game !== "string" || record.game.length === 0) return null;
    if (typeof record.nick !== "string") return null;
    return {
      k: "hello",
      v: typeof record.v === "number" ? record.v : MATCH_PROTOCOL_VERSION,
      id: record.id,
      game: record.game,
      nick: record.nick,
    };
  }

  if (kind === "start") {
    if (typeof record.seed !== "number" || !Number.isFinite(record.seed)) return null;
    return {
      k: "start",
      v: typeof record.v === "number" ? record.v : MATCH_PROTOCOL_VERSION,
      seed: record.seed,
      game: typeof record.game === "string" ? record.game : "",
    };
  }

  if (kind === "move") {
    if (typeof record.seq !== "number" || !Number.isFinite(record.seq)) return null;
    return { k: "move", seq: record.seq, payload: record.payload };
  }

  if (kind === "bye") return { k: "bye" };

  return null;
}
