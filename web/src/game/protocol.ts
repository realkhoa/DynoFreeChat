/**
 * @file protocol.ts
 * @brief Wire format for the in-room Tic-Tac-Toe channel carried by ephemeral `game` frames.
 * @details The worker relays these payloads verbatim to the other peers in the room and
 * forgets them: they never become chat history. Every field is therefore re-validated on
 * receipt, because a peer's payload is untrusted input.
 */

import type { BoardState, GameScore, PlayerMark } from "./tictactoe";

/** Hard cap mirrored from the shared protocol so a bad payload never reaches JSON.parse. */
export const MAX_PAYLOAD = 2048;

/** Board width, used by the shape checks below. */
const CELLS = 9;

/** A complete, authoritative snapshot of one round. */
export interface GameSnapshot {
  board: BoardState;
  turn: PlayerMark;
  scores: GameScore;
  starter: PlayerMark;
  /** Number of moves applied in this round; lets a peer detect a gap. */
  seq: number;
}

/** Opening handshake, sent on every (re)connect by both sides. */
export interface HelloMessage {
  k: "hello";
  /** Stable per session instance, so a reconnect does not re-roll a role. */
  clientId: string;
  role: PlayerMark;
  nick: string;
}

/** Authoritative state, only ever sent by the room's host. */
export interface StateMessage extends GameSnapshot {
  k: "state";
}

/** One move. */
export interface MoveMessage {
  k: "move";
  cell: number;
  player: PlayerMark;
  /** Must equal the receiver's `seq + 1` when it arrives. */
  seq: number;
}

/** A rematch request carrying the starter both sides should adopt. */
export interface RematchMessage {
  k: "rematch";
  starter: PlayerMark;
}

/** "I am out of sync, send me `state`". */
export interface ResyncMessage {
  k: "resync";
}

/** Every payload this channel understands. */
export type GameMessage = HelloMessage | StateMessage | MoveMessage | RematchMessage | ResyncMessage;

/** @return True when `value` is exactly a nine-cell board of `"X" | "O" | null`. */
export function isBoardState(value: unknown): value is BoardState {
  if (!Array.isArray(value) || value.length !== CELLS) return false;
  return value.every((cell) => cell === null || cell === "X" || cell === "O");
}

/** @return True when `value` is a `PlayerMark`. */
export function isMark(value: unknown): value is PlayerMark {
  return value === "X" || value === "O";
}

/** @return True when `value` is a non-negative finite integer. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** @return True when `value` is a cell index inside the board. */
export function isCellIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < CELLS;
}

/** @return True when `value` is a well-formed score record. */
export function isScores(value: unknown): value is GameScore {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isCount(record.x) && isCount(record.o) && isCount(record.draws);
}

/**
 * @brief Serializes a game message for the `game` frame payload.
 * @param message Message to encode.
 * @return JSON string shorter than {@link MAX_PAYLOAD}.
 */
export function encodeGameMessage(message: GameMessage): string {
  return JSON.stringify(message);
}

/**
 * @brief Parses and fully validates a `game` frame payload.
 * @param text Raw payload from the worker.
 * @return The message, or null when the payload is malformed or out of bounds.
 */
export function decodeGameMessage(text: string): GameMessage | null {
  if (text.length === 0 || text.length > MAX_PAYLOAD) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  const record = raw as Record<string, unknown>;
  switch (record.k) {
    case "hello": {
      if (typeof record.clientId !== "string" || record.clientId.length === 0) return null;
      if (record.clientId.length > 64) return null;
      if (typeof record.nick !== "string" || record.nick.length === 0) return null;
      if (!isMark(record.role)) return null;
      return {
        k: "hello",
        clientId: record.clientId,
        role: record.role,
        nick: record.nick.slice(0, 64),
      };
    }

    case "state": {
      if (!isBoardState(record.board)) return null;
      if (!isMark(record.turn)) return null;
      if (!isMark(record.starter)) return null;
      if (!isScores(record.scores)) return null;
      if (!isCount(record.seq)) return null;
      return {
        k: "state",
        board: record.board,
        turn: record.turn,
        starter: record.starter,
        scores: record.scores,
        seq: record.seq,
      };
    }

    case "move": {
      if (!isCellIndex(record.cell)) return null;
      if (!isMark(record.player)) return null;
      if (!isCount(record.seq)) return null;
      return { k: "move", cell: record.cell, player: record.player, seq: record.seq };
    }

    case "rematch": {
      if (!isMark(record.starter)) return null;
      return { k: "rematch", starter: record.starter };
    }

    case "resync":
      return { k: "resync" };

    default:
      return null;
  }
}
