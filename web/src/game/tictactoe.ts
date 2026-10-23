/**
 * @file tictactoe.ts
 * @brief Pure Tic-Tac-Toe game engine, winner evaluation, AI solver, and room code utilities.
 */

/**
 * @brief Player marks on the board ("X" or "O").
 */
export type PlayerMark = "X" | "O";

/**
 * @brief Cell value containing a player mark or null when empty.
 */
export type CellValue = PlayerMark | null;

/**
 * @brief Fixed 3x3 board array of 9 elements indexed 0 to 8.
 */
export type BoardState = [
  CellValue,
  CellValue,
  CellValue,
  CellValue,
  CellValue,
  CellValue,
  CellValue,
  CellValue,
  CellValue,
];

/**
 * @brief Supported game play modes.
 */
export type GameMode = "local" | "ai" | "online";

/**
 * @brief Evaluation outcome of a board state.
 */
export interface GameOutcome {
  /** The winner if game ended, 'draw' if tied, or null if still in progress. */
  winner: PlayerMark | "draw" | null;
  /** Winning line cell indices (0..8) when someone won. */
  line?: [number, number, number];
}

/**
 * @brief Score record tracking wins and ties.
 */
export interface GameScore {
  x: number;
  o: number;
  draws: number;
}

/**
 * @brief Wire message protocol for multiplayer synchronization over WebSockets.
 */
export type TttProtocolMessage =
  | { type: "join"; role: PlayerMark; nick: string }
  | { type: "move"; cell: number; player: PlayerMark }
  | { type: "reset"; starter: PlayerMark }
  | { type: "sync"; board: BoardState; turn: PlayerMark; scores: GameScore };

/**
 * @brief All 8 possible 3-in-a-row winning combinations on a 3x3 grid.
 */
export const WINNING_LINES: readonly [number, number, number][] = [
  // Rows
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  // Columns
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  // Diagonals
  [0, 4, 8],
  [2, 4, 6],
];

/**
 * @brief Creates an empty 3x3 Tic-Tac-Toe board.
 * @return An array of 9 null cells.
 */
export function createEmptyBoard(): BoardState {
  return [null, null, null, null, null, null, null, null, null];
}

/**
 * @brief Checks if a board has a winner or is a draw.
 * @param board Current 9-cell board state.
 * @return GameOutcome describing the winner, winning line, or draw state.
 */
export function evaluateBoard(board: BoardState): GameOutcome {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== null && mark !== undefined && mark === board[b] && mark === board[c]) {
      return { winner: mark as PlayerMark, line };
    }
  }

  const isFull = board.every((cell) => cell !== null);
  if (isFull) {
    return { winner: "draw" };
  }

  return { winner: null };
}

/**
 * @brief Returns list of available cell indices that can be played.
 * @param board Current 9-cell board state.
 * @return Array of empty cell indices (0..8).
 */
export function getAvailableMoves(board: BoardState): number[] {
  const moves: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null) moves.push(i);
  }
  return moves;
}

/**
 * @brief Checks if a player has an immediate winning move available.
 * @param board Current board state.
 * @param mark Player mark to check.
 * @return Winning cell index (0..8) or -1 if none exists.
 */
function findWinningMove(board: BoardState, mark: PlayerMark): number {
  for (const move of getAvailableMoves(board)) {
    const copy = [...board] as BoardState;
    copy[move] = mark;
    if (evaluateBoard(copy).winner === mark) return move;
  }
  return -1;
}

/**
 * @brief Computes the optimal move for an AI player using the Minimax algorithm.
 * @param board Current board state.
 * @param aiMark The mark assigned to the AI ("X" or "O").
 * @return Best cell index to play (0..8), or -1 if no moves available.
 */
export function computeBestMove(board: BoardState, aiMark: PlayerMark): number {
  const available = getAvailableMoves(board);
  if (available.length === 0) return -1;

  const opponentMark: PlayerMark = aiMark === "X" ? "O" : "X";

  // Immediate win or block check
  const winMove = findWinningMove(board, aiMark);
  if (winMove >= 0) return winMove;

  const blockMove = findWinningMove(board, opponentMark);
  if (blockMove >= 0) return blockMove;

  // Prefer center
  if (board[4] === null) return 4;

  // Prefer corners
  const corners = [0, 2, 6, 8].filter((c) => board[c] === null);
  if (corners.length > 0) {
    return corners[Math.floor(Math.random() * corners.length)] ?? corners[0] ?? 0;
  }

  // Minimax fallback for remaining moves
  let bestScore = -Infinity;
  let bestMove = available[0] ?? 0;

  for (const move of available) {
    const copy = [...board] as BoardState;
    copy[move] = aiMark;
    const score = minimax(copy, 0, false, aiMark, opponentMark, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

/**
 * @brief Evaluates maximizing branches for the Minimax algorithm.
 * @param board Board state.
 * @param depth Current recursion depth.
 * @param aiMark AI player mark.
 * @param oppMark Opponent player mark.
 * @param alpha Current alpha prune value.
 * @param beta Current beta prune value.
 * @return Best maximizing score.
 */
function evaluateMaximizing(
  board: BoardState,
  depth: number,
  aiMark: PlayerMark,
  oppMark: PlayerMark,
  alpha: number,
  beta: number,
): number {
  let maxEval = -Infinity;
  for (const move of getAvailableMoves(board)) {
    board[move] = aiMark;
    const score = minimax(board, depth + 1, false, aiMark, oppMark, alpha, beta);
    board[move] = null;
    maxEval = Math.max(maxEval, score);
    alpha = Math.max(alpha, score);
    if (beta <= alpha) break;
  }
  return maxEval;
}

/**
 * @brief Evaluates minimizing branches for the Minimax algorithm.
 * @param board Board state.
 * @param depth Current recursion depth.
 * @param aiMark AI player mark.
 * @param oppMark Opponent player mark.
 * @param alpha Current alpha prune value.
 * @param beta Current beta prune value.
 * @return Best minimizing score.
 */
function evaluateMinimizing(
  board: BoardState,
  depth: number,
  aiMark: PlayerMark,
  oppMark: PlayerMark,
  alpha: number,
  beta: number,
): number {
  let minEval = Infinity;
  for (const move of getAvailableMoves(board)) {
    board[move] = oppMark;
    const score = minimax(board, depth + 1, true, aiMark, oppMark, alpha, beta);
    board[move] = null;
    minEval = Math.min(minEval, score);
    beta = Math.min(beta, score);
    if (beta <= alpha) break;
  }
  return minEval;
}

/**
 * @brief Minimax recursive evaluation with alpha-beta pruning.
 * @param board Board state.
 * @param depth Current recursion depth.
 * @param isMaximizing True if maximizing player's turn, false if minimizing.
 * @param aiMark AI's mark.
 * @param oppMark Opponent's mark.
 * @param alpha Alpha value for pruning.
 * @param beta Beta value for pruning.
 * @return Evaluated score.
 */
function minimax(
  board: BoardState,
  depth: number,
  isMaximizing: boolean,
  aiMark: PlayerMark,
  oppMark: PlayerMark,
  alpha: number,
  beta: number,
): number {
  const outcome = evaluateBoard(board);
  if (outcome.winner === aiMark) return 10 - depth;
  if (outcome.winner === oppMark) return depth - 10;
  if (outcome.winner === "draw") return 0;
  if (depth >= 6) return 0;

  if (isMaximizing) {
    return evaluateMaximizing(board, depth, aiMark, oppMark, alpha, beta);
  }
  return evaluateMinimizing(board, depth, aiMark, oppMark, alpha, beta);
}

/**
 * @brief Generates a random human-friendly 4-character room code (e.g. "K9X2").
 * @param rand Optional random number generator for test determinism.
 * @return 4-character uppercase alphanumeric code.
 */
export function generateRoomCode(rand: () => number = Math.random): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // excludes confusing 0, 1, I, O
  let code = "";
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(rand() * chars.length);
    code += chars[idx];
  }
  return code;
}

/**
 * @brief Converts a user-entered room code into a valid DynoFreeChat room slug.
 * @param code Raw room code entered by user.
 * @return Lowercase valid slug prefixed with 'ttt-', e.g. 'ttt-k9x2'.
 */
export function roomSlugFromCode(code: string): string {
  const cleaned = code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `ttt-${cleaned || "game"}`;
}

/**
 * @brief Extracts the short game code from a full room slug (e.g. 'ttt-k9x2' -> 'K9X2').
 * @param slug Full room slug.
 * @return Uppercase room code without the 'ttt-' prefix.
 */
export function codeFromRoomSlug(slug: string): string {
  if (slug.startsWith("ttt-")) {
    return slug.slice(4).toUpperCase();
  }
  return slug.toUpperCase();
}

/**
 * @brief Serializes a Tic-Tac-Toe message into a chat text payload with prefix.
 * @param message Protocol message object.
 * @return String formatted with [TTT] prefix.
 */
export function serializeTttMessage(message: TttProtocolMessage): string {
  return `[TTT]${JSON.stringify(message)}`;
}

/**
 * @brief Deserializes a chat text message into a TttProtocolMessage if it carries the [TTT] prefix.
 * @param text Raw chat message text.
 * @return Deserialized message or null if not a valid game message.
 */
export function deserializeTttMessage(text: string): TttProtocolMessage | null {
  if (!text.startsWith("[TTT]")) return null;
  try {
    const raw = JSON.parse(text.slice(5)) as TttProtocolMessage;
    if (typeof raw === "object" && raw !== null && typeof raw.type === "string") {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}
