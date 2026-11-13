/**
 * @file hub-view.ts
 * @brief Collab hub: every feature and game module, rendered as a plain C# file.
 * @details The launcher reads as another source file: each module is a class or
 * struct block with a code lens line carrying the real name and hotkey, so it is
 * easy to find. The hub lists the non-game feature documents (quotes, order book,
 * chart, feed, workspace) first, then every playable game.
 * Adding a game is one entry in features/games/registry.ts plus its factory; adding
 * a feature is one entry in the feature list plus its open handler.
 */

import type { GameDefinition } from "./registry";

/** One non-game module listed at the top of the hub. */
export interface FeatureModule {
  /** Stable id used by the open handler. */
  id: string;
  /** Display name shown in the lens line. */
  name: string;
  /** One technical line describing the document. */
  summary: string;
  /** Hotkey hint shown in the lens line. */
  hotkey: string;
}

/** Callbacks for the registry. */
export interface GamesHubHandlers {
  /**
   * Opens a game.
   * @param id Game id from {@link GameDefinition}.
   */
  onOpen: (id: string) => void;

  /**
   * Opens a feature document.
   * @param id Feature id from {@link FeatureModule}.
   */
  onOpenFeature: (id: string) => void;
}

/** DOM hosts owned by the registry document. */
export interface GamesHubElements {
  /** Container that receives the feature blocks. */
  features: HTMLElement;
  /** Container that receives the game class blocks. */
  list: HTMLElement;
  /** Gutter that receives one number per rendered code line. */
  gutter: HTMLElement;
  /** Toolbar chip showing the module counts. */
  chip: HTMLElement | null;
}

/**
 * @brief Renders and updates the collab hub.
 */
export class GamesHubView {
  private gameEntries: readonly GameDefinition[] = [];
  private featureEntries: readonly FeatureModule[] = [];

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
   * @brief Renders one clickable struct per feature document.
   * @param entries Feature modules to offer.
   */
  setFeatures(entries: readonly FeatureModule[]): void {
    this.featureEntries = entries;
    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const block = document.createElement("button");
      block.type = "button";
      block.className = "module-row";
      block.dataset.featureId = entry.id;
      block.setAttribute("aria-label", `${entry.name} — ${entry.summary}`);

      const lens = document.createElement("span");
      lens.className = "code-line indent1 module-lens";
      lens.append(text("// ▶ open ", "comment"));
      lens.append(text(`[ ${entry.hotkey} ]`, "kw"));
      lens.append(text(`  ${entry.name}`, "ident"));

      const declaration = document.createElement("span");
      declaration.className = "code-line indent1";
      declaration.append(text("public sealed struct ", "kw"));
      declaration.append(text(`${entry.name}Module`, "type"));
      declaration.append(text(" : ", "ident"));
      declaration.append(text("IFeatureModule", "type"));

      const summary = document.createElement("span");
      summary.className = "code-line indent2 comment";
      summary.textContent = `// ${entry.summary}`;

      block.append(lens, declaration, summary);
      block.addEventListener("click", () => this.handlers.onOpenFeature(entry.id));
      block.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.handlers.onOpenFeature(entry.id);
      });
      fragment.append(block);
    }

    this.elements.features.replaceChildren(fragment);
    this.refresh();
  }

  /**
   * @brief Renders one clickable class block per game.
   * @param entries Games to offer.
   */
  setGames(entries: readonly GameDefinition[]): void {
    this.gameEntries = entries;
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
    this.refresh();
  }

  /**
   * @brief Focuses the first module, for tab activation.
   */
  focusFirst(): void {
    const first =
      this.elements.features.querySelector<HTMLButtonElement>(".module-row") ??
      this.elements.list.querySelector<HTMLButtonElement>(".module-row");
    first?.focus();
  }

  /**
   * @brief Currently offered games, for tests and diagnostics.
   * @return Copy of the game list.
   */
  get games(): GameDefinition[] {
    return [...this.gameEntries];
  }

  /**
   * @brief Currently offered feature modules, for tests and diagnostics.
   * @return Copy of the feature list.
   */
  get modules(): FeatureModule[] {
    return [...this.featureEntries];
  }

  /**
   * @brief Renumbers the gutter and refreshes the toolbar chip.
   * @details The gutter is derived from the rendered document so the disguise
   * cannot drift when modules are added.
   */
  private refresh(): void {
    const content = this.elements.list.closest(".game-code-content");
    const total = content === null ? 0 : content.querySelectorAll(".code-line").length;

    const fragment = document.createDocumentFragment();
    for (let line = 1; line <= total; line++) {
      const span = document.createElement("span");
      span.textContent = String(line).padStart(2, "0");
      fragment.append(span);
    }
    this.elements.gutter.replaceChildren(fragment);

    if (this.elements.chip !== null) {
      const games = this.gameEntries.length;
      this.elements.chip.textContent = `// modules: ${this.featureEntries.length} features | ${games} game${games === 1 ? "" : "s"}`;
    }
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
