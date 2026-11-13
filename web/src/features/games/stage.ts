/**
 * @file stage.ts
 * @brief Generic game document: one panel that hosts whichever game is open.
 * @details The stage owns the tab chrome (file name, restart button, status
 * line) and swaps the mounted module. Games never touch the tab strip, so the
 * games hub stays the single entry point.
 */

import type { GameFactory, GameMount } from "./mount";

/** DOM hosts the stage paints into. */
export interface StageElements {
  /** Document panel, used for visibility checks. */
  panel: HTMLElement;
  /** Empty container the active game fills. */
  host: HTMLElement;
  /** Toolbar file name, e.g. `Caro.cs`. */
  title: HTMLElement;
  /** Toolbar chip, e.g. `// local simulation`. */
  chip: HTMLElement;
  /** Status bar text. */
  status: HTMLElement;
  /** Restart button. */
  restart: HTMLButtonElement;
}

/**
 * @brief Owns the single game document and the currently mounted module.
 */
export class GameStage {
  private active: { id: string; mount: GameMount } | null = null;

  /**
   * @param elements DOM hosts.
   * @param factories Lazily created game modules keyed by registry id.
   */
  constructor(
    private readonly elements: StageElements,
    private readonly factories: Record<string, GameFactory>,
  ) {
    elements.restart.addEventListener("click", () => {
      const id = this.active?.id;
      if (id !== undefined) this.open(id, elements.title.textContent ?? id, elements.chip.textContent ?? "");
    });
  }

  /** Registry id of the mounted game, if any. */
  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  /**
   * @brief Mounts one game, replacing whatever was mounted before.
   * @param id Registry id.
   * @param title Document title for the toolbar.
   * @param summary One-line description for the toolbar chip.
   * @return Whether the game id is known.
   */
  open(id: string, title: string, summary: string): boolean {
    const factory = this.factories[id];
    if (factory === undefined) return false;

    this.unmountActive();
    this.elements.title.textContent = title;
    this.elements.chip.textContent = `// ${summary}`;
    this.elements.status.textContent = "Ready";

    const mount = factory();
    this.elements.host.replaceChildren();
    mount.mount(this.elements.host);
    this.active = { id, mount };
    return true;
  }

  /**
   * @brief Unmounts the active game, if any.
   */
  close(): void {
    this.unmountActive();
  }

  /**
   * @brief Updates the status bar text.
   * @param text Message to show.
   */
  setStatus(text: string): void {
    this.elements.status.textContent = text;
  }

  /** @brief Tears down the active module without touching the panel. */
  private unmountActive(): void {
    if (this.active === null) return;
    try {
      this.active.mount.unmount();
    } catch {
      // A broken unmount must never block opening the next game.
    }
    this.elements.host.replaceChildren();
    this.active = null;
  }
}
