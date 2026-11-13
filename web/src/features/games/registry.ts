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
];

/**
 * @brief Looks a game up by id.
 * @param id Game id.
 * @return The definition, or undefined when unknown.
 */
export function findGame(id: string): GameDefinition | undefined {
  return GAMES.find((game) => game.id === id);
}
