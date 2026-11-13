/**
 * @file registry.ts
 * @brief Single source of truth for the games the Collab section offers.
 * @details Adding a game means adding one entry here, one open handler in main.ts and
 * its document view. The registry is data only, so the launcher and the tab titles
 * stay derived from it.
 */

import type { IconName } from "@/shared/ui/icons";

/** Everything the launcher and the tab strip need to know about one game. */
export interface GameDefinition {
  /** Stable id used by open handlers and tests. */
  id: string;
  /** Display name, e.g. "Tic-Tac-Toe". Shown in the launcher so it is findable. */
  name: string;
  /** C# class name rendered in the registry, e.g. "TicTacToe". */
  className: string;
  /** Document title the game opens as, e.g. "TicTacToe.cs". */
  documentTitle: string;
  /** One technical line describing the available modes. */
  summary: string;
  /** Function key shown in the lens line. */
  hotkey: string;
  /** Icon shown next to the entry. */
  icon: IconName;
}

/**
 * @brief Games available in this build.
 * @details Keep ids, class names and document titles unique: the registry tests enforce
 * it, and the tab strip relies on the title being unique per game.
 */
export const GAMES: readonly GameDefinition[] = [
  {
    id: "tictactoe",
    name: "Tic-Tac-Toe",
    className: "TicTacToe",
    documentTitle: "TicTacToe.cs",
    summary: "online session | local simulation | dual-thread",
    hotkey: "F6",
    icon: "hash",
  },
  {
    id: "caro",
    name: "Caro",
    className: "Caro",
    documentTitle: "Caro.cs",
    summary: "gomoku 15x15 | AI opponent | undo",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "battleship",
    name: "Battleship",
    className: "Battleship",
    documentTitle: "Battleship.cs",
    summary: "10x10 fleet | hunt/target AI | random placement",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "chess",
    name: "Chess",
    className: "Chess",
    documentTitle: "Chess.cs",
    summary: "full rules | minimax AI | move list",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "tienlen",
    name: "Tien Len",
    className: "TienLen",
    documentTitle: "TienLen.cpp",
    summary: "13-card shedding | two AI players | he plays highest",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "gunny",
    name: "Gunny",
    className: "Gunny",
    documentTitle: "Gunny.cpp",
    summary: "artillery duel | seeded terrain | AI aim",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "shooter",
    name: "Shooter",
    className: "Shooter",
    documentTitle: "Shooter.cpp",
    summary: "canvas waves | 3 lives | fixed timestep",
    hotkey: "↵",
    icon: "play",
  },
  {
    id: "2048",
    name: "2048",
    className: "Game2048",
    documentTitle: "Game2048.cs",
    summary: "4x4 merges | arrow keys | 2048 goal",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "minesweeper",
    name: "Minesweeper",
    className: "Minesweeper",
    documentTitle: "Minesweeper.cs",
    summary: "9x9 | 10 mines | safe first click",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "sokoban",
    name: "Sokoban",
    className: "Sokoban",
    documentTitle: "Sokoban.cs",
    summary: "crate pushing | undo stack | 4 levels",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "pinpoint",
    name: "Pinpoint",
    className: "Pinpoint",
    documentTitle: "Pinpoint.cs",
    summary: "word deduction | 6 tries | keyboard",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "queens",
    name: "Queens",
    className: "Queens",
    documentTitle: "Queens.cs",
    summary: "N-queens | conflict hints | sizes 4-8",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "tango",
    name: "Tango",
    className: "Tango",
    documentTitle: "Tango.cs",
    summary: "sun/moon grid | balance rules | seeded puzzles",
    hotkey: "↵",
    icon: "hash",
  },
  {
    id: "sudoku",
    name: "Sudoku",
    className: "Sudoku",
    documentTitle: "Sudoku.cs",
    summary: "unique-solution puzzles | 3 difficulties | hints",
    hotkey: "↵",
    icon: "hash",
  },
];

/**
 * @brief Looks a game up by id.
 * @param id Game id.
 * @return The definition, or undefined when unknown.
 */
export function findGame(id: string): GameDefinition | undefined {
  return GAMES.find((game) => game.id === id);
}
