// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  codeFromRoomSlug,
  computeBestMove,
  createEmptyBoard,
  deserializeTttMessage,
  evaluateBoard,
  generateRoomCode,
  getAvailableMoves,
  roomSlugFromCode,
  serializeTttMessage,
  type BoardState,
  type TttProtocolMessage,
} from "../src/game/tictactoe";

describe("tictactoe logic", () => {
  it("initializes an empty board of 9 cells", () => {
    const board = createEmptyBoard();
    expect(board).toHaveLength(9);
    expect(board.every((c) => c === null)).toBe(true);
  });

  it("detects row wins", () => {
    const board: BoardState = ["X", "X", "X", null, "O", null, "O", null, null];
    const outcome = evaluateBoard(board);
    expect(outcome.winner).toBe("X");
    expect(outcome.line).toEqual([0, 1, 2]);
  });

  it("detects column wins", () => {
    const board: BoardState = ["O", "X", null, "O", "X", null, "O", null, null];
    const outcome = evaluateBoard(board);
    expect(outcome.winner).toBe("O");
    expect(outcome.line).toEqual([0, 3, 6]);
  });

  it("detects diagonal wins", () => {
    const board: BoardState = ["X", "O", null, null, "X", "O", null, null, "X"];
    const outcome = evaluateBoard(board);
    expect(outcome.winner).toBe("X");
    expect(outcome.line).toEqual([0, 4, 8]);

    const board2: BoardState = [null, null, "O", null, "O", null, "O", "X", "X"];
    const outcome2 = evaluateBoard(board2);
    expect(outcome2.winner).toBe("O");
    expect(outcome2.line).toEqual([2, 4, 6]);
  });

  it("detects draws when board is full without a 3-in-a-row", () => {
    const board: BoardState = ["X", "O", "X", "X", "O", "O", "O", "X", "X"];
    const outcome = evaluateBoard(board);
    expect(outcome.winner).toBe("draw");
    expect(outcome.line).toBeUndefined();
  });

  it("returns null winner when board is in progress", () => {
    const board: BoardState = ["X", "O", null, null, null, null, null, null, null];
    const outcome = evaluateBoard(board);
    expect(outcome.winner).toBeNull();
  });

  it("lists available empty moves", () => {
    const board: BoardState = ["X", "O", null, null, "X", null, null, null, "O"];
    expect(getAvailableMoves(board)).toEqual([2, 3, 5, 6, 7]);
  });

  it("AI takes immediate winning move", () => {
    const board: BoardState = ["O", "O", null, "X", "X", null, null, null, null];
    // AI is O, should choose cell 2 to win immediately
    const bestMove = computeBestMove(board, "O");
    expect(bestMove).toBe(2);
  });

  it("AI blocks immediate opponent winning move", () => {
    const board: BoardState = ["X", "X", null, "O", null, null, null, null, null];
    // Opponent is X about to win at cell 2, AI is O, must block cell 2
    const bestMove = computeBestMove(board, "O");
    expect(bestMove).toBe(2);
  });

  it("AI chooses center on empty board", () => {
    const board = createEmptyBoard();
    const move = computeBestMove(board, "X");
    expect(move).toBe(4);
  });

  it("generates deterministic room codes with a fake RNG", () => {
    let call = 0;
    const fakeRand = () => {
      call++;
      return (call * 0.1) % 1;
    };
    const code = generateRoomCode(fakeRand);
    expect(code).toHaveLength(4);
    expect(code).toBe(code.toUpperCase());
  });

  it("formats room slug from code and extracts code back", () => {
    expect(roomSlugFromCode("Ab9X")).toBe("ttt-ab9x");
    expect(roomSlugFromCode("")).toBe("ttt-game");
    expect(codeFromRoomSlug("ttt-ab9x")).toBe("AB9X");
    expect(codeFromRoomSlug("room123")).toBe("ROOM123");
  });

  it("serializes and deserializes game protocol messages", () => {
    const msg: TttProtocolMessage = {
      type: "move",
      cell: 4,
      player: "X",
    };
    const serialized = serializeTttMessage(msg);
    expect(serialized.startsWith("[TTT]")).toBe(true);

    const deserialized = deserializeTttMessage(serialized);
    expect(deserialized).toEqual(msg);

    expect(deserializeTttMessage("Hello world")).toBeNull();
    expect(deserializeTttMessage("[TTT]not-json")).toBeNull();
  });
});
