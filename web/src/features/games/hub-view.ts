/**
 * @file hub-view.ts
 * @brief Collab module registry, rendered as a plain C# file.
 * @details The launcher must read as another source file: every game is a class
 * declaration with a code lens line you can click, so the only thing on screen is a
 * module index. Adding a game is one entry plus its open handler.
 */

import { icon, type IconName } from "@/shared/ui/icons";

/** One module (game) offered by the registry. */
export interface GameEntry {
  /** Stable id used by the open handler. */
  id: string;
  /** Class name shown in the declaration, e.g. "MatrixInspector". */
  module: string;
  /** Comment describing the module's modes in technical wording. */
  summary: string;
  /** Function key shown in the lens line. */
  hotkey: string;
}

/** Callbacks for the registry. */
export interface GamesHubHandlers {
  /**
   * Runs a module.
   * @param id Module id from {@link GameEntry}.
   */
  onOpen: (id: string) => void;
}

/** DOM hosts owned by the registry document. */
export interface GamesHubElements {
  /** Container that receives the class blocks. */
  list: HTMLElement;
  /** Gutter that receives one number per rendered code line. */
  gutter: HTMLElement;
  /** Toolbar chip showing the module count. */
  chip: HTMLElement | null;
}

/**
 * @brief Renders and updates the module registry.
 */
export class GamesHubView {
  private entries: GameEntry[] = [];

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
   * @brief Renders one clickable class block per module and renumbers the gutter.
   * @param entries Modules to offer.
   */
  setGames(entries: GameEntry[]): void {
    this.entries = entries;
    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const block = document.createElement("button");
      block.type = "button";
      block.className = "module-row";
      block.dataset.gameId = entry.id;
      block.setAttribute("aria-label", `Run ${entry.module} — ${entry.summary}`);

      // VS CodeLens style: the action line sits above the declaration.
      const lens = document.createElement("span");
      lens.className = "code-line indent1 module-lens";
      lens.append(text("// ▶ run ", "comment"));
      lens.append(text(`[ ${entry.hotkey} ]`, "kw"));

      const declaration = document.createElement("span");
      declaration.className = "code-line indent1";
      declaration.append(text("public sealed class ", "kw"));
      declaration.append(text(entry.module, "type"));
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
      this.elements.chip.textContent = `// registry: ${entries.length} module${entries.length === 1 ? "" : "s"}`;
    }
  }

  /**
   * @brief Focuses the first module, for tab activation.
   */
  focusFirst(): void {
    this.elements.list.querySelector<HTMLButtonElement>(".module-row")?.focus();
  }

  /**
   * @brief Currently offered modules, for tests and diagnostics.
   * @return Copy of the entry list.
   */
  get games(): GameEntry[] {
    return [...this.entries];
  }

  /**
   * @brief Renumbers the gutter from the static lines plus three lines per module.
   * @param moduleCount Number of rendered module blocks.
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
 * @brief Builds a syntax-coloured text node holder.
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

/** Re-exported so callers do not import the icon module just for the type. */
export type { IconName };
