// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  allLegalMoves,
  applyMove,
  bestMove,
  createChessGame,
  createEmptyPosition,
  createInitialPosition,
  isCheckmate,
  isInCheck,
  legalMoves,
  moveToAlgebraic,
  squareIndex,
  squareName,
  type Color,
  type Move,
  type PieceCode,
  type PieceType,
  type Position,
} from "@/features/games/chess/game";

/** Builds a position from sparse placements. */
function withPieces(turn: Color, placements: readonly (readonly [string, PieceCode])[]): Position {
  const position = createEmptyPosition(turn);
  for (const [name, code] of placements) position.board[squareIndex(name)] = code;
  return position;
}

/** Finds a legal move, throwing when the test fixture is wrong. */
function play(position: Position, from: string, to: string, promo?: PieceType): Move {
  const move = legalMoves(position, squareIndex(from)).find(
    (candidate) => candidate.to === squareIndex(to) && (promo === undefined || candidate.promo === promo),
  );
  if (move === undefined) throw new Error(`illegal ${from}${to}`);
  return move;
}

/** Applies a move named in algebraic squares. */
function after(position: Position, from: string, to: string): Position {
  return applyMove(position, play(position, from, to));
}

/** Sorted destination names of the legal moves from one square. */
function targets(position: Position, from: string): string[] {
  return legalMoves(position, squareIndex(from))
    .map((move) => squareName(move.to))
    .sort();
}

describe("chess engine", () => {
  it("generates the 20 opening moves", () => {
    const position = createInitialPosition();
    expect(allLegalMoves(position)).toHaveLength(20);
    expect(targets(position, "e2")).toEqual(["e3", "e4"]);
    expect(targets(position, "b1")).toEqual(["a3", "c3"]);
    expect(targets(position, "d1")).toEqual([]);
    expect(position.turn).toBe("w");
    expect(position.board[squareIndex("e1")]).toBe("wK");
    expect(position.castling).toBe("KQkq");
    expect(position.fullmove).toBe(1);
  });

  it("updates the clocks, the turn and the en-passant square", () => {
    const start = createInitialPosition();
    const opened = after(start, "e2", "e4");
    expect(opened.turn).toBe("b");
    expect(opened.board[squareIndex("e4")]).toBe("wP");
    expect(opened.board[squareIndex("e2")]).toBeNull();
    expect(opened.ep).toBe(squareIndex("e3"));
    expect(opened.halfmove).toBe(0);

    const replied = after(opened, "a7", "a6");
    expect(replied.fullmove).toBe(2);
    expect(replied.ep).toBeNull();

    const developed = after(replied, "b1", "c3");
    expect(developed.halfmove).toBe(1);
    expect(developed.turn).toBe("b");
  });

  it("captures en passant and removes the passed pawn", () => {
    let position = createInitialPosition();
    position = after(position, "e2", "e4");
    position = after(position, "a7", "a6");
    position = after(position, "e4", "e5");
    position = after(position, "d7", "d5");
    expect(position.ep).toBe(squareIndex("d6"));

    const capture = play(position, "e5", "d6");
    expect(capture.enPassant).toBe(true);
    expect(capture.capture).toBe("p");
    expect(moveToAlgebraic(position, capture)).toBe("exd6");

    const taken = applyMove(position, capture);
    expect(taken.board[squareIndex("d5")]).toBeNull();
    expect(taken.board[squareIndex("d6")]).toBe("wP");
  });

  it("allows castling and moves the rook with the king", () => {
    const position = withPieces("w", [
      ["e1", "wK"],
      ["h1", "wR"],
      ["e8", "bK"],
    ]);
    position.castling = "K";
    const castle = play(position, "e1", "g1");
    expect(castle.castle).toBe("k");
    expect(moveToAlgebraic(position, castle)).toBe("O-O");

    const done = applyMove(position, castle);
    expect(done.board[squareIndex("g1")]).toBe("wK");
    expect(done.board[squareIndex("f1")]).toBe("wR");
    expect(done.board[squareIndex("h1")]).toBeNull();
    expect(done.castling).not.toContain("K");
  });

  it("rejects castling through check, out of check and when blocked", () => {
    const blocked = withPieces("w", [
      ["e1", "wK"],
      ["h1", "wR"],
      ["f1", "wN"],
      ["e8", "bK"],
    ]);
    blocked.castling = "K";
    expect(legalMoves(blocked, squareIndex("e1")).some((move) => move.castle === "k")).toBe(false);

    const throughCheck = withPieces("w", [
      ["e1", "wK"],
      ["h1", "wR"],
      ["e8", "bK"],
      ["f8", "bR"],
    ]);
    throughCheck.castling = "K";
    expect(legalMoves(throughCheck, squareIndex("e1")).some((move) => move.castle === "k")).toBe(false);

    const inCheck = withPieces("w", [
      ["e1", "wK"],
      ["h1", "wR"],
      ["a8", "bK"],
      ["e8", "bR"],
    ]);
    inCheck.castling = "K";
    expect(isInCheck(inCheck, "w")).toBe(true);
    expect(legalMoves(inCheck, squareIndex("e1")).some((move) => move.castle === "k")).toBe(false);
  });

  it("offers all four promotions and applies the chosen piece", () => {
    const position = withPieces("w", [
      ["a1", "wK"],
      ["b7", "wP"],
      ["h8", "bK"],
    ]);
    const options = legalMoves(position, squareIndex("b7")).filter((move) => move.to === squareIndex("b8"));
    expect(options).toHaveLength(4);
    expect(options.map((move) => move.promo).sort()).toEqual(["b", "n", "q", "r"]);

    const queen = play(position, "b7", "b8", "q");
    expect(moveToAlgebraic(position, queen)).toBe("b8=Q+");
    const promoted = applyMove(position, queen);
    expect(promoted.board[squareIndex("b8")]).toBe("wQ");
    expect(promoted.board[squareIndex("b7")]).toBeNull();
  });

  it("detects check and pins", () => {
    const checked = withPieces("b", [
      ["e8", "bK"],
      ["e1", "wR"],
      ["a1", "wK"],
    ]);
    expect(isInCheck(checked, "b")).toBe(true);
    expect(isInCheck(checked, "w")).toBe(false);
    expect(isCheckmate(checked)).toBe(false);

    const pinned = withPieces("w", [
      ["e1", "wK"],
      ["e2", "wR"],
      ["e8", "bR"],
      ["a8", "bK"],
    ]);
    const escapes = legalMoves(pinned, squareIndex("e2"));
    expect(escapes.length).toBeGreaterThan(0);
    for (const move of escapes) expect(move.to % 8).toBe(4);
  });

  it("finds fool's mate and treats it as a finished game", () => {
    let position = createInitialPosition();
    position = after(position, "f2", "f3");
    position = after(position, "e7", "e5");
    position = after(position, "g2", "g4");
    const mate = play(position, "d8", "h4");
    expect(moveToAlgebraic(position, mate)).toBe("Qh4#");

    position = applyMove(position, mate);
    expect(isInCheck(position, "w")).toBe(true);
    expect(isCheckmate(position)).toBe(true);
    expect(allLegalMoves(position)).toHaveLength(0);
    expect(bestMove(position, 2)).toBeNull();
  });

  it("detects stalemate", () => {
    const position = withPieces("b", [
      ["a8", "bK"],
      ["c7", "wQ"],
      ["c6", "wK"],
    ]);
    expect(isInCheck(position, "b")).toBe(false);
    expect(isCheckmate(position)).toBe(false);
    expect(allLegalMoves(position)).toHaveLength(0);
  });

  it("searches a mate in one with alpha-beta", () => {
    const position = withPieces("w", [
      ["h6", "wK"],
      ["g6", "wQ"],
      ["h8", "bK"],
    ]);
    const move = bestMove(position, 2);
    expect(move).not.toBeNull();
    if (move === null) throw new Error("no move");
    expect(isCheckmate(applyMove(position, move))).toBe(true);
    expect(moveToAlgebraic(position, move)).toMatch(/#$/);
  });

  it("writes SAN for quiet moves and answers inside the budget", () => {
    const position = createInitialPosition();
    expect(moveToAlgebraic(position, play(position, "e2", "e4"))).toBe("e4");
    expect(moveToAlgebraic(position, play(position, "g1", "f3"))).toBe("Nf3");

    const started = performance.now();
    const move = bestMove(createInitialPosition(), 2);
    const elapsed = performance.now() - started;
    expect(move).not.toBeNull();
    expect(allLegalMoves(createInitialPosition())).toContainEqual(move);
    expect(elapsed).toBeLessThan(300);
  });

  it("treats an empty board as having no legal moves", () => {
    const position = createEmptyPosition("w");
    expect(allLegalMoves(position)).toHaveLength(0);
    expect(bestMove(position, 2)).toBeNull();
    expect(isCheckmate(position)).toBe(false);
    expect(isInCheck(position, "w")).toBe(false);
  });
});

describe("chess view", () => {
  /** Re-queries one board cell by algebraic name (the board is rebuilt on render). */
  function cell(host: HTMLElement, name: string): HTMLButtonElement | null {
    return host.querySelectorAll<HTMLButtonElement>(".stage-cell")[squareIndex(name)] ?? null;
  }

  it("mounts 64 squares, plays e2-e4 and unmounts cleanly", () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      const game = createChessGame();
      game.mount(host);
      expect(host.children.length).toBeGreaterThan(0);

      expect(host.querySelectorAll(".stage-cell")).toHaveLength(64);
      expect(cell(host, "e2")?.getAttribute("aria-label")).toContain("white pawn");
      expect(host.querySelector(".stage-status")?.textContent).toContain("Your move");

      cell(host, "e2")?.click();
      expect(cell(host, "e3")?.textContent).toBe("·");
      expect(cell(host, "e4")?.textContent).toBe("·");

      const before = host.querySelector(".stage-status")?.textContent ?? "";
      cell(host, "e4")?.click();
      const afterMove = host.querySelector(".stage-status")?.textContent ?? "";
      expect(afterMove).not.toBe(before);
      expect(afterMove).toContain("AI thinking");
      expect(cell(host, "e4")?.textContent).toBe("\u2659");

      vi.advanceTimersByTime(2000);
      expect(host.querySelector(".stage-status")?.textContent).toContain("Your move");
      expect(host.querySelector(".stage-hud")?.textContent).toContain("1.");

      expect(() => game.unmount()).not.toThrow();
      game.mount(host);
      expect(host.querySelectorAll(".stage-cell")).toHaveLength(64);
      expect(host.querySelector(".stage-status")?.textContent).toContain("Your move");
      game.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
