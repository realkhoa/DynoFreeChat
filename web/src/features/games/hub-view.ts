/**
 * @file hub-view.ts
 * @brief Games hub document: one large, clearly labelled entry per game.
 * @details The Collab tab is a launcher, not a game: each entry is a whole-row button
 * with a title, a one-line description and a hint, so it is obvious what it opens and
 * easy to hit. Adding a game means adding one entry plus its open handler.
 */

import { icon, type IconName } from "@/shared/ui/icons";

/** One game offered by the hub. */
export interface GameEntry {
  /** Stable id used by the open handler. */
  id: string;
  /** Human title, e.g. "Cờ Caro". */
  title: string;
  /** One line describing modes, e.g. "online, với máy, 2 người". */
  subtitle: string;
  /** Icon shown on the left. */
  icon: IconName;
  /** Keyboard shortcut hint shown on the right. */
  shortcut: string;
}

/** Callbacks for the hub. */
export interface GamesHubHandlers {
  /**
   * Opens a game.
   * @param id Game id from {@link GameEntry}.
   */
  onOpen: (id: string) => void;
}

/**
 * @brief Renders the game launcher list.
 */
export class GamesHubView {
  private entries: GameEntry[] = [];

  /**
   * @brief Stores the list container and the open callback.
   * @param list Container receiving one button per game.
   * @param handlers Hub callbacks.
   */
  constructor(
    private readonly list: HTMLElement,
    private readonly handlers: GamesHubHandlers,
  ) {}

  /**
   * @brief Renders the entries exactly once per call; safe to call again.
   * @param entries Games to offer.
   */
  setGames(entries: GameEntry[]): void {
    this.entries = entries;
    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "game-card";
      card.dataset.gameId = entry.id;
      card.setAttribute("aria-label", `${entry.title} — ${entry.subtitle}`);

      const iconWrap = document.createElement("span");
      iconWrap.className = "game-card-icon";
      iconWrap.setAttribute("aria-hidden", "true");
      iconWrap.append(icon(entry.icon, 20));

      const body = document.createElement("span");
      body.className = "game-card-body";

      const title = document.createElement("span");
      title.className = "game-card-title";
      title.textContent = entry.title;

      const subtitle = document.createElement("span");
      subtitle.className = "game-card-subtitle";
      subtitle.textContent = entry.subtitle;

      body.append(title, subtitle);

      const hint = document.createElement("span");
      hint.className = "game-card-hint";
      hint.textContent = entry.shortcut;

      card.append(iconWrap, body, hint);
      card.addEventListener("click", () => this.handlers.onOpen(entry.id));
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.handlers.onOpen(entry.id);
      });

      fragment.append(card);
    }

    this.list.replaceChildren(fragment);
  }

  /**
   * @brief Puts keyboard focus on the first game, for tab activation.
   */
  focusFirst(): void {
    this.list.querySelector<HTMLButtonElement>(".game-card")?.focus();
  }

  /**
   * @brief Currently offered games, for tests and diagnostics.
   * @return Copy of the entry list.
   */
  get games(): GameEntry[] {
    return [...this.entries];
  }
}
