/**
 * @file factories.ts
 * @brief Static map from registry id to the game module factory.
 * @details The registry stays data-only; this map is the one place that knows
 * how to build each game. Adding a game means one registry entry, one import
 * here, and the module itself — the stage and the hub stay untouched.
 */

import { create2048Game } from "./2048/game";
import { createBattleshipGame } from "./battleship/game";
import { createCaroGame } from "./caro/game";
import { createChessGame } from "./chess/game";
import { createGunnyGame } from "./gunny/game";
import { createMinesweeperGame } from "./minesweeper/game";
import { createPinpointGame } from "./pinpoint/game";
import { createQueensGame } from "./queens/game";
import { createShooterGame } from "./shooter/game";
import { createSokobanGame } from "./sokoban/game";
import { createSudokuGame } from "./sudoku/game";
import { createTangoGame } from "./tango/game";
import { createTienLenGame } from "./tienlen/game";
import type { GameFactory } from "./mount";

/** Every game the stage can mount, keyed by registry id. */
export const GAME_FACTORIES: Record<string, GameFactory> = {
  "2048": create2048Game,
  battleship: createBattleshipGame,
  caro: createCaroGame,
  chess: createChessGame,
  gunny: createGunnyGame,
  minesweeper: createMinesweeperGame,
  pinpoint: createPinpointGame,
  queens: createQueensGame,
  shooter: createShooterGame,
  sokoban: createSokobanGame,
  sudoku: createSudokuGame,
  tango: createTangoGame,
  tienlen: createTienLenGame,
};
