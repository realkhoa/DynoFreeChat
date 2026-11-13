/**
 * @file hub-view.ts
 * @brief Collab game registry, rendered as a plain C# file.
 * @details The launcher reads as another source file: every game is a class block with
 * a code lens line, and the real game name is on that lens line so it is easy to find.
 * Adding a game is one entry in features/games/registry.ts plus its open handler.
 */

import type { GameDefinition } from "./registry";

/** Callbacks for the registry. */
export interface GamesHubHandlers {
  /**
   * Opens a game.
   * @param id Game id from {@link GameDefinition}.
   */
  onOpen: (id: string) => void;
}

/** DOM hosts owned by the registry document. */
export interface GamesHubElements {
  /** Container that receives the class blocks. */
  list: HTMLElement;
  /** Gutter that receives one number per rendered code line. */
  gutter: HTMLElement;
  /** Toolbar chip showing the game count. */
  chip: HTMLElement | null;
}

/**
 * @brief Renders and updates the game registry.
 */
export class GamesHubView {
  private entries: readonly GameDefinition[] = [];

  /**
   * @brief Stores the document hosts and callbacks.
   * @param elements Registry DOM hosts.
   * @param handlers Registry callbacks.
   */
  constructor(
    private readonly elements: GamesHubElements,
    private readonly handlers: GamesHubHandlers,
  ) {}

  /**
   * @brief Renders one clickable class block per game and renumbers the gutter.
   * @param entries Games to offer.
   */
  setGames(entries: readonly GameDefinition[]): void {
    this.entries = entries;
    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const block = document.createElement("button");
      block.type = "button";
      block.className = "module-row";
      block.dataset.gameId = entry.id;
      block.setAttribute("aria-label", `${entry.name} — ${entry.summary}`);

      // VS CodeLens style: the action line sits above the declaration and carries the
      // real game name, so it can be found at a glance.
      const lens = document.createElement("span");
      lens.className = "code-line indent1 module-lens";
      lens.append(text("// ▶ run ", "comment"));
      lens.append(text(`[ ${entry.hotkey} ]`, "kw"));
      lens.append(text(`  ${entry.name}`, "ident"));

      const declaration = document.createElement("span");
      declaration.className = "code-line indent1";
      declaration.append(text("public sealed class ", "kw"));
      declaration.append(text(entry.className, "type"));
      declaration.append(text(" : ", "ident"));
      declaration.append(text("IGameModule", "type"));

      const summary = document.createElement("span");
      summary.className = "code-line indent2 comment";
      summary.textContent = `// ${entry.summary}`;

      block.append(lens, declaration, summary);
      block.addEventListener("click", () => this.handlers.onOpen(entry.id));
      block.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.handlers.onOpen(entry.id);
      });

      fragment.append(block);
    }

    this.elements.list.replaceChildren(fragment);
    this.paintGutter(entries.length);
    if (this.elements.chip !== null) {
      this.elements.chip.textContent = `// registry: ${entries.length} game${entries.length === 1 ? "" : "s"}`;
    }
  }

  /**
   * @brief Focuses the first game, for tab activation.
   */
  focusFirst(): void {
    this.elements.list.querySelector<HTMLButtonElement>(".module-row")?.focus();
  }

  /**
   * @brief Currently offered games, for tests and diagnostics.
   * @return Copy of the entry list.
   */
  get games(): GameDefinition[] {
    return [...this.entries];
  }

  /**
   * @brief Renumbers the gutter from the static lines plus three lines per game.
   * @param moduleCount Number of rendered class blocks.
   * @details The gutter must match the rendered file or the disguise breaks, so it is
   * derived instead of hand-maintained.
   */
  private paintGutter(moduleCount: number): void {
    const content = this.elements.list.parentElement;
    const staticLines = content === null ? 0 : content.querySelectorAll(":scope > .code-line").length;
    const total = staticLines + moduleCount * 3;

    const fragment = document.createDocumentFragment();
    for (let line = 1; line <= total; line++) {
      const span = document.createElement("span");
      span.textContent = String(line).padStart(2, "0");
      fragment.append(span);
    }
    this.elements.gutter.replaceChildren(fragment);
  }
}

/**
 * @brief Builds a syntax-coloured text span.
 * @param value Text content.
 * @param className Syntax class from the code document styles.
 * @return Span element.
 */
function text(value: string, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = value;
  return span;
}
