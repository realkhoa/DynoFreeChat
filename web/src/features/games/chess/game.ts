/**
 * @file chess/game.ts
 * @brief Full-rules chess against a depth-limited search AI.
 * @details Pure engine (move generation, legality, check/mate detection, SAN,
 * alpha-beta search with material and piece-square evaluation) plus the vanilla
 * DOM view. Mutable view state lives in the {@link createChessGame} closure.
 * When an online bridge is supplied the search AI is switched off: the local
 * seat plays White or Black and the opponent's moves arrive as validated
 * `{ from, to, promotion? }` payloads.
 */

import type { GameContext, GameMount } from "../mount";
import type { OnlineBridge } from "../online/bridge";

/** @brief Side to move. */
export type Color = "w" | "b";
/** @brief Piece kind, lowercase. */
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
/** @brief Board cell: a coloured piece like "wQ" or null. */
export type PieceCode = `${Color}${"P" | "N" | "B" | "R" | "Q" | "K"}`;
/** @brief 64 cells, index 0 = a8, index 63 = h1. */
export type Board = (PieceCode | null)[];

/** @brief One legal or pseudo-legal move. */
export interface Move {
  from: number;
  to: number;
  piece: PieceType;
  capture?: PieceType;
  promo?: PieceType;
  /** Castling side, when the king castles. */
  castle?: "k" | "q";
  /** True for an en-passant capture. */
  enPassant?: boolean;
}

/** @brief Complete game state. */
export interface Position {
  board: Board;
  turn: Color;
  /** Castling rights subset of "KQkq". */
  castling: string;
  /** En-passant target square index, or null. */
  ep: number | null;
  halfmove: number;
  fullmove: number;
}

/** Row/column delta. */
type Step = readonly [number, number];
const FILES = "abcdefgh";
const KNIGHT_STEPS: readonly Step[] = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];
const KING_STEPS: readonly Step[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const ROOK_STEPS: readonly Step[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const BISHOP_STEPS: readonly Step[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const QUEEN_STEPS: readonly Step[] = [...ROOK_STEPS, ...BISHOP_STEPS];
const PIECE_VALUE: Readonly<Record<PieceType, number>> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

/** Simplified evaluation tables, written rank 8 to rank 1 from White's side. */
const PST_TEXT: Readonly<Record<PieceType, string>> = {
  p:
    "0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5," +
    "0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0",
  n:
    "-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30," +
    "-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50",
  b:
    "-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10," +
    "-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20",
  r:
    "0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5," +
    "-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0",
  q:
    "-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5," +
    "0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20",
  k:
    "-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30," +
    "-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20",
};

/** Decoded piece-square tables, indexed by board square for White. */
const PST: Readonly<Record<PieceType, readonly number[]>> = {
  p: PST_TEXT.p.split(",").map(Number),
  n: PST_TEXT.n.split(",").map(Number),
  b: PST_TEXT.b.split(",").map(Number),
  r: PST_TEXT.r.split(",").map(Number),
  q: PST_TEXT.q.split(",").map(Number),
  k: PST_TEXT.k.split(",").map(Number),
};

/** Score that dominates any material evaluation. */
const MATE_SCORE = 100_000;

function boardAt(board: Board, index: number): PieceCode | null {
  return board[index] ?? null;
}
function colorOf(piece: PieceCode): Color {
  return piece.charAt(0) === "b" ? "b" : "w";
}
function typeOf(piece: PieceCode): PieceType {
  return piece.charAt(1).toLowerCase() as PieceType;
}
function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}
function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}
function indexAt(row: number, col: number): number {
  return row * 8 + col;
}
function pieceAt(board: Board, row: number, col: number): PieceCode | null {
  return onBoard(row, col) ? boardAt(board, indexAt(row, col)) : null;
}

/**
 * @brief Converts an algebraic square name to an index.
 * @param name Square name like "e2".
 * @return Index 0..63, or -1 when the name is invalid.
 */
export function squareIndex(name: string): number {
  if (name.length !== 2) return -1;
  const col = FILES.indexOf(name.charAt(0).toLowerCase());
  const rank = Number(name.charAt(1));
  if (col < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) return -1;
  return indexAt(8 - rank, col);
}

/**
 * @brief Converts a square index to its algebraic name.
 * @param index Square index.
 * @return Name like "e2".
 */
export function squareName(index: number): string {
  return `${FILES.charAt(index % 8)}${8 - Math.floor(index / 8)}`;
}

/** Builds a move, attaching the capture when there is one. */
function makeMove(from: number, to: number, piece: PieceType, capture: PieceType | null): Move {
  const move: Move = { from, to, piece };
  if (capture !== null) move.capture = capture;
  return move;
}

/**
 * @brief Creates the standard starting position.
 * @return Fresh position with all castling rights and White to move.
 */
export function createInitialPosition(): Position {
  const board: Board = Array<PieceCode | null>(64).fill(null);
  const backRank = ["r", "n", "b", "q", "k", "b", "n", "r"] as const;
  for (let col = 0; col < 8; col++) {
    const kind = backRank[col];
    if (kind === undefined) continue;
    const upper = kind.toUpperCase();
    board[indexAt(0, col)] = `b${upper}` as PieceCode;
    board[indexAt(1, col)] = "bP";
    board[indexAt(6, col)] = "wP";
    board[indexAt(7, col)] = `w${upper}` as PieceCode;
  }
  return { board, turn: "w", castling: "KQkq", ep: null, halfmove: 0, fullmove: 1 };
}

/**
 * @brief Creates a piece-less position for tests and fixtures.
 * @param turn Side to move.
 * @return Empty position without castling rights.
 */
export function createEmptyPosition(turn: Color = "w"): Position {
  const board: Board = Array<PieceCode | null>(64).fill(null);
  return { board, turn, castling: "", ep: null, halfmove: 0, fullmove: 1 };
}

/** Tests whether a square is attacked by one colour. */
function attacked(board: Board, target: number, byColor: Color): boolean {
  const row = Math.floor(target / 8);
  const col = target % 8;
  const pawnRow = row + (byColor === "w" ? 1 : -1);
  for (const dc of [-1, 1] as const) {
    const pawn = pieceAt(board, pawnRow, col + dc);
    if (pawn !== null && colorOf(pawn) === byColor && typeOf(pawn) === "p") return true;
  }
  for (const [dr, dc] of KNIGHT_STEPS) {
    const knight = pieceAt(board, row + dr, col + dc);
    if (knight !== null && colorOf(knight) === byColor && typeOf(knight) === "n") return true;
  }
  for (const [dr, dc] of KING_STEPS) {
    const king = pieceAt(board, row + dr, col + dc);
    if (king !== null && colorOf(king) === byColor && typeOf(king) === "k") return true;
  }
  for (const [dr, dc] of QUEEN_STEPS) {
    let r = row + dr;
    let c = col + dc;
    while (onBoard(r, c)) {
      const piece = pieceAt(board, r, c);
      if (piece !== null) {
        if (colorOf(piece) === byColor) {
          const kind = typeOf(piece);
          const straight = dr === 0 || dc === 0;
          if (kind === "q" || (straight ? kind === "r" : kind === "b")) return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return false;
}

/**
 * @brief Tests whether one side's king is attacked.
 * @param position Position to test.
 * @param color Side to test.
 * @return True when the king of that colour is in check.
 */
export function isInCheck(position: Position, color: Color): boolean {
  for (let i = 0; i < 64; i++) {
    const piece = boardAt(position.board, i);
    if (piece !== null && colorOf(piece) === color && typeOf(piece) === "k") {
      return attacked(position.board, i, opposite(color));
    }
  }
  return false;
}

/** One pawn target, expanded into four moves on the promotion rank. */
function pawnTargets(from: number, to: number, capture: PieceType | null, promoRow: number): Move[] {
  const base = makeMove(from, to, "p", capture);
  if (Math.floor(to / 8) !== promoRow) return [base];
  return (["q", "r", "b", "n"] as const).map((promo) => ({ ...base, promo }));
}

/** Candidate pawn moves including double push, en passant and promotions. */
function pawnMoves(position: Position, from: number, color: Color, row: number, col: number): Move[] {
  const moves: Move[] = [];
  const dir = color === "w" ? -1 : 1;
  const startRow = color === "w" ? 6 : 1;
  const promoRow = color === "w" ? 0 : 7;
  const oneRow = row + dir;
  if (onBoard(oneRow, col) && boardAt(position.board, indexAt(oneRow, col)) === null) {
    moves.push(...pawnTargets(from, indexAt(oneRow, col), null, promoRow));
    const twoRow = row + 2 * dir;
    if (row === startRow && onBoard(twoRow, col) && boardAt(position.board, indexAt(twoRow, col)) === null) {
      moves.push({ from, to: indexAt(twoRow, col), piece: "p" });
    }
  }
  for (const dc of [-1, 1] as const) {
    if (!onBoard(oneRow, col + dc)) continue;
    const to = indexAt(oneRow, col + dc);
    const target = boardAt(position.board, to);
    if (target !== null) {
      if (colorOf(target) !== color) moves.push(...pawnTargets(from, to, typeOf(target), promoRow));
    } else if (position.ep === to) {
      moves.push({ from, to, piece: "p", capture: "p", enPassant: true });
    }
  }
  return moves;
}

/** Castling candidates for a king on its home square. */
function castleMoves(position: Position, from: number, color: Color): Move[] {
  const homeRow = color === "w" ? 7 : 0;
  if (from !== indexAt(homeRow, 4)) return [];
  const enemy = opposite(color);
  const rights = position.castling;
  const empty = (file: number): boolean => boardAt(position.board, indexAt(homeRow, file)) === null;
  const safe = (file: number): boolean => !attacked(position.board, indexAt(homeRow, file), enemy);
  const rookAt = (file: number): boolean => {
    const piece = pieceAt(position.board, homeRow, file);
    return piece !== null && colorOf(piece) === color && typeOf(piece) === "r";
  };
  const moves: Move[] = [];
  const kingSide = rights.includes(color === "w" ? "K" : "k");
  const queenSide = rights.includes(color === "w" ? "Q" : "q");
  if (kingSide && empty(5) && empty(6) && rookAt(7) && safe(4) && safe(5) && safe(6)) {
    moves.push({ from, to: indexAt(homeRow, 6), piece: "k", castle: "k" });
  }
  if (queenSide && empty(1) && empty(2) && empty(3) && rookAt(0) && safe(4) && safe(3) && safe(2)) {
    moves.push({ from, to: indexAt(homeRow, 2), piece: "k", castle: "q" });
  }
  return moves;
}

/** Pseudo-legal moves from one square; {@link legalMoves} applies king safety. */
function pseudoMoves(position: Position, from: number): Move[] {
  const piece = boardAt(position.board, from);
  if (piece === null) return [];
  const color = colorOf(piece);
  const kind = typeOf(piece);
  const row = Math.floor(from / 8);
  const col = from % 8;
  const moves: Move[] = [];

  if (kind === "p") {
    moves.push(...pawnMoves(position, from, color, row, col));
  } else if (kind === "n" || kind === "k") {
    for (const [dr, dc] of kind === "n" ? KNIGHT_STEPS : KING_STEPS) {
      if (!onBoard(row + dr, col + dc)) continue;
      const to = indexAt(row + dr, col + dc);
      const target = boardAt(position.board, to);
      if (target !== null && colorOf(target) === color) continue;
      moves.push(makeMove(from, to, kind, target === null ? null : typeOf(target)));
    }
    if (kind === "k") moves.push(...castleMoves(position, from, color));
  } else {
    const steps = kind === "b" ? BISHOP_STEPS : kind === "r" ? ROOK_STEPS : QUEEN_STEPS;
    for (const [dr, dc] of steps) {
      let r = row + dr;
      let c = col + dc;
      while (onBoard(r, c)) {
        const to = indexAt(r, c);
        const target = boardAt(position.board, to);
        if (target === null) {
          moves.push(makeMove(from, to, kind, null));
        } else {
          if (colorOf(target) !== color) moves.push(makeMove(from, to, kind, typeOf(target)));
          break;
        }
        r += dr;
        c += dc;
      }
    }
  }
  return moves;
}

/**
 * @brief Applies a move and returns the resulting position.
 * @param position Position before the move.
 * @param move Move to apply.
 * @return New position; the input is never mutated.
 */
export function applyMove(position: Position, move: Move): Position {
  const board = position.board.slice();
  const moving = boardAt(position.board, move.from);
  const color: Color = moving === null ? position.turn : colorOf(moving);
  const fromRow = Math.floor(move.from / 8);
  const toRow = Math.floor(move.to / 8);

  board[move.from] = null;
  if (move.enPassant) board[indexAt(fromRow, move.to % 8)] = null;
  if (move.castle !== undefined) {
    const homeRow = color === "w" ? 7 : 0;
    const rookFrom = move.castle === "k" ? 7 : 0;
    const rookTo = move.castle === "k" ? 5 : 3;
    board[indexAt(homeRow, rookTo)] = boardAt(position.board, indexAt(homeRow, rookFrom));
    board[indexAt(homeRow, rookFrom)] = null;
  }
  board[move.to] = move.promo === undefined ? moving : (`${color}${move.promo.toUpperCase()}` as PieceCode);

  let castling = position.castling;
  const drop = (flag: string): void => {
    castling = castling.replace(flag, "");
  };
  if (move.piece === "k") {
    drop(color === "w" ? "K" : "k");
    drop(color === "w" ? "Q" : "q");
  }
  for (const [square, flag] of [
    [63, "K"],
    [56, "Q"],
    [7, "k"],
    [0, "q"],
  ] as const) {
    if (move.from === square || move.to === square) drop(flag);
  }

  const doublePush = move.piece === "p" && Math.abs(toRow - fromRow) === 2;
  const resetClock = move.piece === "p" || move.capture !== undefined;
  return {
    board,
    turn: opposite(color),
    castling,
    ep: doublePush ? indexAt((fromRow + toRow) / 2, move.to % 8) : null,
    halfmove: resetClock ? 0 : position.halfmove + 1,
    fullmove: color === "b" ? position.fullmove + 1 : position.fullmove,
  };
}

/**
 * @brief Lists the legal moves of the piece on one square.
 * @param position Position to read.
 * @param from Source square.
 * @return Moves that leave the mover's own king safe.
 */
export function legalMoves(position: Position, from: number): Move[] {
  const piece = boardAt(position.board, from);
  if (piece === null) return [];
  const color = colorOf(piece);
  return pseudoMoves(position, from).filter((move) => !isInCheck(applyMove(position, move), color));
}

/**
 * @brief Lists every legal move for the side to move.
 * @param position Position to read.
 * @return Legal moves.
 */
export function allLegalMoves(position: Position): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < 64; i++) {
    const piece = boardAt(position.board, i);
    if (piece === null || colorOf(piece) !== position.turn) continue;
    moves.push(...legalMoves(position, i));
  }
  return moves;
}

/**
 * @brief Tests whether the side to move is checkmated.
 * @param position Position to test.
 * @return True when in check and without legal moves.
 */
export function isCheckmate(position: Position): boolean {
  return allLegalMoves(position).length === 0 && isInCheck(position, position.turn);
}

/** Static evaluation in centipawns from White's point of view. */
function evaluate(position: Position): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const piece = boardAt(position.board, i);
    if (piece === null) continue;
    const kind = typeOf(piece);
    const mirrored = colorOf(piece) === "w" ? i : i ^ 56;
    const value = PIECE_VALUE[kind] + (PST[kind][mirrored] ?? 0);
    score += colorOf(piece) === "w" ? value : -value;
  }
  return score;
}

/** Orders moves so captures and promotions are searched first. */
function orderMoves(moves: readonly Move[]): Move[] {
  const score = (move: Move): number => {
    let value = 0;
    if (move.capture !== undefined) value += 10 * PIECE_VALUE[move.capture] - PIECE_VALUE[move.piece];
    if (move.promo !== undefined) value += PIECE_VALUE[move.promo];
    return value;
  };
  return [...moves].sort((a, b) => score(b) - score(a));
}

/** Negamax with alpha-beta pruning; mate scores prefer faster mates. */
function negamax(position: Position, depth: number, alpha: number, beta: number, ply: number): number {
  if (depth === 0) {
    if (isInCheck(position, position.turn) && allLegalMoves(position).length === 0) {
      return -MATE_SCORE + ply;
    }
    const score = evaluate(position);
    return position.turn === "w" ? score : -score;
  }
  const moves = allLegalMoves(position);
  if (moves.length === 0) return isInCheck(position, position.turn) ? -MATE_SCORE + ply : 0;

  let best = -Infinity;
  for (const move of orderMoves(moves)) {
    const score = -negamax(applyMove(position, move), depth - 1, -beta, -alpha, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * @brief Picks the best move for the side to move with a depth-limited
 * alpha-beta search.
 * @param position Position to move in.
 * @param depth Search depth in plies, clamped to 1..4.
 * @return The chosen move, or null when the position is already decided.
 */
export function bestMove(position: Position, depth = 3): Move | null {
  const moves = orderMoves(allLegalMoves(position));
  if (moves.length === 0) return null;
  const limit = Math.max(1, Math.min(4, Math.trunc(depth)));
  let best: Move | null = null;
  let alpha = -Infinity;
  for (const move of moves) {
    const score = -negamax(applyMove(position, move), limit - 1, -Infinity, -alpha, 1);
    if (best === null || score > alpha) {
      alpha = score;
      best = move;
    }
  }
  return best;
}

/**
 * @brief Formats a move in standard algebraic notation (SAN).
 * @param position Position before the move.
 * @param move Move to describe.
 * @return Notation such as "Nf3", "exd6", "O-O", "e8=Q+" or "Qh4#".
 */
export function moveToAlgebraic(position: Position, move: Move): string {
  const piece = boardAt(position.board, move.from);
  const kind = piece === null ? move.piece : typeOf(piece);
  let text = "";
  if (move.castle !== undefined) {
    text = move.castle === "k" ? "O-O" : "O-O-O";
  } else if (kind === "p") {
    if (move.capture !== undefined) text += `${FILES.charAt(move.from % 8)}x`;
    text += squareName(move.to);
    if (move.promo !== undefined) text += `=${move.promo.toUpperCase()}`;
  } else {
    text += kind.toUpperCase();
    const rivals: Move[] = [];
    for (let i = 0; i < 64; i++) {
      const other = boardAt(position.board, i);
      if (other === null || colorOf(other) !== position.turn || typeOf(other) !== kind) continue;
      for (const candidate of legalMoves(position, i)) {
        if (candidate.to === move.to && candidate.from !== move.from) rivals.push(candidate);
      }
    }
    if (rivals.length > 0) {
      const sameFile = rivals.some((other) => other.from % 8 === move.from % 8);
      const sameRank = rivals.some((other) => Math.floor(other.from / 8) === Math.floor(move.from / 8));
      if (!sameFile) text += FILES.charAt(move.from % 8);
      else if (!sameRank) text += String(8 - Math.floor(move.from / 8));
      else text += squareName(move.from);
    }
    if (move.capture !== undefined) text += "x";
    text += squareName(move.to);
  }
  const next = applyMove(position, move);
  if (isInCheck(next, next.turn)) text += allLegalMoves(next).length === 0 ? "#" : "+";
  return text;
}

const GLYPHS: Readonly<Record<PieceCode, string>> = {
  wK: "♔",
  wQ: "♕",
  wR: "♖",
  wB: "♗",
  wN: "♘",
  wP: "♙",
  bK: "♚",
  bQ: "♛",
  bR: "♜",
  bB: "♝",
  bN: "♞",
  bP: "♟",
};
const PIECE_NAMES: Readonly<Record<PieceType, string>> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Search depth used by the built-in AI: fast enough for the ~300 ms budget. */
const AI_DEPTH = 3;

/** Game result, or null while the game is still running. */
type Outcome = "win" | "lose" | "draw";

/** One move request as relayed through the online bridge. */
interface MoveRequest {
  /** Source square index 0..63. */
  from: number;
  /** Target square index 0..63. */
  to: number;
  /** Promotion piece; present only when the move promotes. */
  promotion?: PieceType;
}

/**
 * @brief Narrows an untrusted payload to a plain object.
 * @param value Value received from the bridge.
 * @return The object, or null for primitives and null.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * @brief Tests whether a value is a usable square index.
 * @param value Candidate value.
 * @return True for integers inside 0..63.
 */
function isSquareIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 64;
}

/**
 * @brief Tests whether a value is a promotion piece the engine understands.
 * @param value Candidate value.
 * @return True for "q", "r", "b" or "n".
 */
function isPromotion(value: unknown): value is PieceType {
  return value === "q" || value === "r" || value === "b" || value === "n";
}

/**
 * @brief Decodes one relayed move payload, rejecting anything malformed.
 * @param payload Untrusted payload from the opponent.
 * @return The request, or null when the payload is not a move.
 */
function decodeMoveRequest(payload: unknown): MoveRequest | null {
  const record = asRecord(payload);
  if (record === null) return null;
  const from = record.from;
  const to = record.to;
  if (!isSquareIndex(from) || !isSquareIndex(to)) return null;
  const promotion = record.promotion;
  if (promotion === undefined) return { from, to };
  if (!isPromotion(promotion)) return null;
  return { from, to, promotion };
}

/** Formats the SAN history as numbered move pairs, keeping the tail. */
function formatMoves(san: readonly string[]): string {
  const pairs: string[] = [];
  for (let i = 0; i < san.length; i += 2) {
    const white = san[i] ?? "";
    const black = san[i + 1] ?? "";
    pairs.push(`${i / 2 + 1}. ${white}${black === "" ? "" : ` ${black}`}`);
  }
  return pairs.slice(-6).join("  ");
}

/**
 * @brief Creates the chess game module.
 * @return Mountable game with closure-private state.
 */
export function createChessGame(): GameMount {
  let position: Position = createInitialPosition();
  let selected: number | null = null;
  let selectedMoves: Move[] = [];
  let lastMove: Move | null = null;
  let promotion: Move[] | null = null;
  let pastPositions: Position[] = [];
  let pastMoves: Move[] = [];
  let pastSan: string[] = [];
  let over: Outcome | null = null;
  let thinking = false;
  let note = "";
  let timer: number | null = null;
  let online: OnlineBridge | null = null;
  let peerLeft = false;
  let unsubscribeMove: (() => void) | null = null;
  let unsubscribePeer: (() => void) | null = null;
  let refs: { hud: HTMLElement; promo: HTMLElement; board: HTMLElement; status: HTMLElement } | null = null;

  /**
   * @brief Colour the local player owns; White against the AI.
   * @return "w" for seat 1 and for the local game, "b" for seat 2.
   */
  function localColor(): Color {
    return online !== null && online.seat === 2 ? "b" : "w";
  }

  /**
   * @brief Who played the last move, for the status note.
   * @param byPlayer True when the local player made the move.
   * @return "You", "Opponent" or "AI".
   */
  function actorName(byPlayer: boolean): string {
    if (byPlayer) return "You";
    return online !== null ? "Opponent" : "AI";
  }

  /**
   * @brief Maps a finished game onto the local perspective.
   * @param stuck Colour that has no legal move left.
   * @return "lose" when the local side is stuck, otherwise "win".
   */
  function outcomeFor(stuck: Color): Outcome {
    return stuck === localColor() ? "lose" : "win";
  }

  function clearTimer(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }
  function button(text: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "stage-btn";
    el.textContent = text;
    el.addEventListener("click", onClick);
    return el;
  }
  function label(text: string): HTMLElement {
    const el = document.createElement("span");
    el.textContent = text;
    return el;
  }
  function checkSuffix(): string {
    return isInCheck(position, position.turn) ? " Check." : "";
  }
  function statusText(): string {
    if (over === "win") {
      return online === null ? "Checkmate — you win. Press Restart for a new game." : "Checkmate — you win.";
    }
    if (over === "lose") {
      return online === null ? "Checkmate — the AI wins. Undo or Restart." : "Checkmate — the opponent wins.";
    }
    if (over === "draw") {
      return online === null ? "Stalemate — draw. Press Restart for a new game." : "Stalemate — draw.";
    }
    if (peerLeft) return "Opponent left the match.";
    if (promotion !== null) return "Promote your pawn: choose queen, rook, bishop or knight.";
    if (thinking) return `AI thinking…${checkSuffix()}`;
    if (online !== null) {
      const colour = localColor() === "w" ? "White" : "Black";
      const whose = position.turn === localColor() ? "Your move" : "Opponent's move";
      return `${whose} — you are ${colour}.${checkSuffix()}`;
    }
    const turnInfo = position.turn === "w" ? "Your move." : "AI to move.";
    if (note !== "") return `${note} ${turnInfo}${checkSuffix()}`;
    return `Your move — you are White.${checkSuffix()}`;
  }

  function commit(move: Move, byPlayer: boolean): void {
    const san = moveToAlgebraic(position, move);
    pastPositions.push(position);
    pastMoves.push(move);
    pastSan.push(san);
    position = applyMove(position, move);
    lastMove = move;
    selected = null;
    selectedMoves = [];
    promotion = null;
    note = `${actorName(byPlayer)} played ${san}.`;
    settleTurn();
  }

  /**
   * @brief Builds the wire payload for one move.
   * @param move Move to relay.
   * @return `{ from, to }` plus `promotion` when the move promotes.
   */
  function movePayload(move: Move): MoveRequest {
    return move.promo === undefined
      ? { from: move.from, to: move.to }
      : { from: move.from, to: move.to, promotion: move.promo };
  }

  /**
   * @brief Commits one move and repaints, relaying it when the local player made it.
   * @param move Move to commit.
   * @param byPlayer True when the local player made the move.
   */
  function playMove(move: Move, byPlayer: boolean): void {
    commit(move, byPlayer);
    render();
    if (byPlayer && online !== null) online.sendMove(movePayload(move));
  }

  /**
   * @brief Applies one opponent move received from the bridge.
   * @param payload Untrusted payload from the opponent.
   */
  function applyRemote(payload: unknown): void {
    if (online === null || peerLeft || over !== null || promotion !== null) return;
    const foe = opposite(localColor());
    if (position.turn !== foe) return;

    const request = decodeMoveRequest(payload);
    if (request === null) return;
    const piece = boardAt(position.board, request.from);
    if (piece === null || colorOf(piece) !== foe) return;

    const candidates = legalMoves(position, request.from).filter((move) => move.to === request.to);
    if (candidates.length === 0) return;
    const move =
      request.promotion === undefined
        ? candidates[0]
        : candidates.find((candidate) => candidate.promo === request.promotion);
    if (move === undefined) return;

    commit(move, false);
    render();
  }

  function settleTurn(): void {
    const moves = allLegalMoves(position);
    if (moves.length === 0) {
      over = isInCheck(position, position.turn) ? outcomeFor(position.turn) : "draw";
      thinking = false;
      return;
    }
    if (online !== null) {
      thinking = false;
      return;
    }
    if (position.turn === "b") {
      thinking = true;
      clearTimer();
      timer = window.setTimeout(aiTurn, 160);
    } else {
      thinking = false;
    }
  }

  function aiTurn(): void {
    timer = null;
    if (online !== null || over !== null) return;
    const move = bestMove(position, AI_DEPTH);
    if (move === null) {
      over = isInCheck(position, position.turn) ? outcomeFor(position.turn) : "draw";
      thinking = false;
      render();
      return;
    }
    thinking = false;
    commit(move, false);
    render();
  }

  function onCellClick(index: number): void {
    if (over !== null || thinking || promotion !== null || peerLeft) return;
    const mine = localColor();
    if (position.turn !== mine) return;
    const piece = boardAt(position.board, index);
    const candidates = selectedMoves.filter((move) => move.to === index);
    if (selected !== null && candidates.length > 0) {
      if (candidates.length > 1) {
        promotion = candidates;
        render();
        return;
      }
      const move = candidates[0];
      if (move !== undefined) playMove(move, true);
      return;
    }
    if (piece !== null && colorOf(piece) === mine) {
      selected = index;
      selectedMoves = legalMoves(position, index);
      note = selectedMoves.length === 0 ? `${PIECE_NAMES[typeOf(piece)]} has no legal moves.` : "";
    } else {
      selected = null;
      selectedMoves = [];
      note = piece === null ? "Select one of your pieces first." : "That piece is not yours.";
    }
    render();
  }

  function undo(): void {
    if (online !== null) return;
    clearTimer();
    if (pastPositions.length === 0) {
      note = "Nothing to undo.";
      render();
      return;
    }
    position = pastPositions.pop() ?? position;
    pastMoves.pop();
    pastSan.pop();
    while (position.turn !== "w" && pastPositions.length > 0) {
      position = pastPositions.pop() ?? position;
      pastMoves.pop();
      pastSan.pop();
    }
    selected = null;
    selectedMoves = [];
    promotion = null;
    over = null;
    thinking = false;
    note = "";
    lastMove = pastMoves[pastMoves.length - 1] ?? null;
    render();
  }

  /** @brief Clears every mutable field back to the starting position. */
  function resetState(): void {
    clearTimer();
    position = createInitialPosition();
    selected = null;
    selectedMoves = [];
    lastMove = null;
    promotion = null;
    pastPositions = [];
    pastMoves = [];
    pastSan = [];
    over = null;
    thinking = false;
    note = "";
  }

  /** @brief Restarts the local game; a no-op while an online match is attached. */
  function restart(): void {
    if (online !== null) return;
    resetState();
    render();
  }

  function buildBoard(inCheck: boolean): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "stage-board";
    grid.style.gridTemplateColumns = "repeat(8, 44px)";
    const targets = new Set(selectedMoves.map((move) => move.to));
    for (let index = 0; index < 64; index++) {
      const piece = boardAt(position.board, index);
      const isTarget = targets.has(index);
      const isSelected = selected === index;
      const isLast = lastMove !== null && (lastMove.from === index || lastMove.to === index);
      const isCheckedKing =
        inCheck && piece !== null && typeOf(piece) === "k" && colorOf(piece) === position.turn;

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "stage-cell";
      cell.style.fontSize = "22px";
      let glyph = piece === null ? "" : GLYPHS[piece];
      if (isCheckedKing) cell.classList.add("is-warn");
      else if (isSelected) cell.classList.add("is-primary");
      else if (isLast) cell.classList.add("is-good");
      else if (isTarget && piece !== null) cell.classList.add("is-warn");
      if (glyph === "" && isTarget) glyph = "·";
      cell.textContent = glyph;

      const content =
        piece === null
          ? "empty"
          : `${colorOf(piece) === "w" ? "white" : "black"} ${PIECE_NAMES[typeOf(piece)]}`;
      cell.setAttribute("aria-label", `${squareName(index)}, ${content}${isTarget ? ", legal move" : ""}`);
      cell.addEventListener("click", () => onCellClick(index));
      grid.append(cell);
    }
    return grid;
  }

  function render(): void {
    const view = refs;
    if (view === null) return;
    const moves = formatMoves(pastSan);
    view.hud.replaceChildren(
      label(`turn: ${position.turn === "w" ? "white" : "black"}`),
      label(`plies: ${pastSan.length}`),
      label(moves === "" ? "moves: —" : `moves: ${moves}`),
    );
    view.promo.replaceChildren();
    if (promotion !== null) {
      for (const kind of ["q", "r", "b", "n"] as const) {
        const move = promotion.find((candidate) => candidate.promo === kind);
        if (move === undefined) continue;
        view.promo.append(
          button(`${PIECE_NAMES[kind]} (${kind.toUpperCase()})`, () => {
            playMove(move, true);
          }),
        );
      }
    }
    view.board.replaceChildren(buildBoard(isInCheck(position, position.turn)));
    view.status.textContent = statusText();
  }

  /**
   * @brief Mounts the game, resetting any previous state.
   * @param host Host element owned by the game stage.
   * @param context Optional mount context; an online bridge switches to PvP.
   */
  function mount(host: HTMLElement, context?: GameContext): void {
    clearTimer();
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = context?.online ?? null;
    peerLeft = false;
    resetState();
    host.replaceChildren();

    const bar = document.createElement("div");
    bar.className = "stage-bar";
    const restartBtn = button("Restart", restart);
    const undoBtn = button("Undo", undo);
    restartBtn.disabled = online !== null;
    undoBtn.disabled = online !== null;
    const hint = label(
      online === null
        ? "you: white · ai: black"
        : `online · ${online.peerNick ?? "opponent"} · you are ${localColor() === "w" ? "white" : "black"}`,
    );
    bar.append(restartBtn, undoBtn, hint);

    const hud = document.createElement("div");
    hud.className = "stage-hud";
    const promo = document.createElement("div");
    promo.className = "stage-bar";
    const board = document.createElement("div");
    const status = document.createElement("div");
    status.className = "stage-status";
    refs = { hud, promo, board, status };
    host.append(bar, hud, promo, status, board);

    if (online !== null) {
      const bridge = online;
      unsubscribeMove = bridge.onMove((payload) => applyRemote(payload));
      unsubscribePeer = bridge.onPeerLeft(() => {
        peerLeft = true;
        render();
      });
    }
    render();
  }

  /** @brief Releases the timer, the bridge subscriptions and DOM references. */
  function unmount(): void {
    clearTimer();
    unsubscribeMove?.();
    unsubscribePeer?.();
    unsubscribeMove = null;
    unsubscribePeer = null;
    online = null;
    peerLeft = false;
    refs = null;
  }

  return { mount, unmount };
}
