// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD,
  decodeGameMessage,
  encodeGameMessage,
  isBoardState,
  isCellIndex,
  type GameMessage,
} from "../src/game/protocol";
import type { BoardState } from "../src/game/tictactoe";

const BOARD: BoardState = ["X", "O", null, null, "X", null, null, null, "O"];

describe("game protocol", () => {
  it("round-trips every message kind", () => {
    const messages: GameMessage[] = [
      { k: "hello", clientId: "abc123", role: "X", nick: "khoan" },
      { k: "state", board: BOARD, turn: "O", scores: { x: 1, o: 2, draws: 3 }, starter: "X", seq: 5 },
      { k: "move", cell: 4, player: "X", seq: 6 },
      { k: "rematch", starter: "O" },
      { k: "resync" },
    ];

    for (const message of messages) {
      expect(decodeGameMessage(encodeGameMessage(message))).toEqual(message);
    }
  });

  it("rejects payloads that are not json, not objects, or unknown kinds", () => {
    expect(decodeGameMessage("")).toBeNull();
    expect(decodeGameMessage("không phải json")).toBeNull();
    expect(decodeGameMessage("null")).toBeNull();
    expect(decodeGameMessage("[]")).toBeNull();
    expect(decodeGameMessage('{"k":"nope"}')).toBeNull();
    expect(decodeGameMessage(String(JSON.stringify({ k: "move" })))).toBeNull();
  });

  it("rejects a payload longer than the cap", () => {
    expect(decodeGameMessage("x".repeat(MAX_PAYLOAD + 1))).toBeNull();
  });

  it("rejects a board of the wrong shape", () => {
    expect(decodeGameMessage(JSON.stringify({ k: "state", board: BOARD.slice(0, 8), turn: "X", starter: "X", scores: { x: 0, o: 0, draws: 0 }, seq: 0 }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "state", board: [...BOARD.slice(0, 8), "Z"], turn: "X", starter: "X", scores: { x: 0, o: 0, draws: 0 }, seq: 0 }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "state", board: "XO", turn: "X", starter: "X", scores: { x: 0, o: 0, draws: 0 }, seq: 0 }))).toBeNull();
  });

  it("rejects out-of-range cells, non-integer seq and bad marks", () => {
    expect(decodeGameMessage(JSON.stringify({ k: "move", cell: 9, player: "X", seq: 1 }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "move", cell: -1, player: "X", seq: 1 }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "move", cell: 1.5, player: "X", seq: 1 }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "move", cell: 1, player: "X", seq: -1 }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "move", cell: 1, player: "Y", seq: 1 }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "rematch", starter: "Z" }))).toBeNull();
  });

  it("rejects negative or fractional scores", () => {
    expect(
      decodeGameMessage(
        JSON.stringify({ k: "state", board: BOARD, turn: "X", starter: "X", scores: { x: -1, o: 0, draws: 0 }, seq: 0 }),
      ),
    ).toBeNull();
    expect(
      decodeGameMessage(
        JSON.stringify({ k: "state", board: BOARD, turn: "X", starter: "X", scores: { x: 0, o: 1.5, draws: 0 }, seq: 0 }),
      ),
    ).toBeNull();
  });

  it("rejects a hello without an id, a nick, or a valid role", () => {
    expect(decodeGameMessage(JSON.stringify({ k: "hello", clientId: "", role: "X", nick: "a" }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "hello", clientId: "a", role: "X", nick: "" }))).toBeNull();
    expect(decodeGameMessage(JSON.stringify({ k: "hello", clientId: "a", role: "Q", nick: "a" }))).toBeNull();
  });

  it("guards board and cell shapes", () => {
    expect(isBoardState(BOARD)).toBe(true);
    expect(isBoardState(["X"])).toBe(false);
    expect(isBoardState(BOARD.map(() => "X"))).toBe(true);
    expect(isCellIndex(0)).toBe(true);
    expect(isCellIndex(8)).toBe(true);
    expect(isCellIndex(9)).toBe(false);
  });
});
