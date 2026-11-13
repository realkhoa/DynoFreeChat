/**
 * @file hub.ts
 * @brief Market hub document: the registry of feed modules, dressed as C#.
 * @details Same pattern as the games hub: one clickable class block per module,
 * so the ribbon stays a single entry point while the modules open their own
 * document tabs.
 */

/** One market module the hub can open. */
export interface FeedModule {
  /** Stable id used by the opener map. */
  id: string;
  /** Real module name, shown in the lens line. */
  name: string;
  /** C# class name used by the declaration line. */
  className: string;
  /** Document title of the tab the module opens. */
  documentTitle: string;
  /** One-line summary comment. */
  summary: string;
  /** Keyboard hint shown in the lens line. */
  hotkey: string;
}

/** Every market module, in display order. */
export const FEED_MODULES: FeedModule[] = [
  {
    id: "quotes",
    name: "Quotes",
    className: "Quotes",
    documentTitle: "MarketFeed.cpp",
    summary: "live quotes | index basket | watchlist",
    hotkey: "F7",
  },
  {
    id: "orderbook",
    name: "OrderBook",
    className: "OrderBook",
    documentTitle: "OrderBook.cpp",
    summary: "volume profile | 24h session | price buckets",
    hotkey: "F8",
  },
  {
    id: "chart",
    name: "Chart",
    className: "Chart",
    documentTitle: "Chart.cs",
    summary: "candles | 1m 5m 15m 1D | canvas",
    hotkey: "F9",
  },
  {
    id: "feed",
    name: "Feed",
    className: "Feed",
    documentTitle: "Feed.cs",
    summary: "FireAnt | F247 | VOZ club",
    hotkey: "F10",
  },
];

/** DOM hosts the hub paints into. */
export interface MarketHubElements {
  list: HTMLElement;
  gutter: HTMLElement;
  chip: HTMLElement;
}

/** Callbacks the hub needs from the host. */
export interface MarketHubHandlers {
  /** Opens one module document. */
  onOpen: (id: string) => void;
}

/**
 * @brief Renders the market module registry.
 */
export class MarketHubView {
  private modules: FeedModule[] = [];

  /**
   * @param elements DOM hosts.
   * @param handlers Host callbacks.
   */
  constructor(
    private readonly elements: MarketHubElements,
    private readonly handlers: MarketHubHandlers,
  ) {}

  /** Modules currently listed. */
  get entries(): FeedModule[] {
    return [...this.modules];
  }

  /**
   * @brief Replaces the module list and repaints.
   * @param modules Modules to show.
   */
  setModules(modules: FeedModule[]): void {
    this.modules = [...modules];
    this.render();
  }

  /** @brief Focuses the first module row. */
  focusFirst(): void {
    this.elements.list.querySelector<HTMLButtonElement>(".module-row")?.focus();
  }

  /** @brief Repaints the registry. */
  private render(): void {
    const list = this.elements.list;
    list.replaceChildren();

    for (const module of this.modules) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "module-row";
      row.dataset.moduleId = module.id;
      row.setAttribute("aria-label", `Open ${module.name} (${module.hotkey})`);

      const lens = document.createElement("div");
      lens.className = "code-line module-lens";
      lens.append(text("// ▶ open "), span("kw", `[ ${module.hotkey} ]`), text(`  ${module.name}`));

      const declaration = document.createElement("div");
      declaration.className = "code-line";
      declaration.append(
        span("kw", "public sealed struct"),
        text(` ${module.className}Module`),
        span("kw", " : "),
        text("IFeedModule"),
      );

      const summary = document.createElement("div");
      summary.className = "code-line comment";
      summary.textContent = `// ${module.summary}`;

      row.append(lens, declaration, summary);
      row.addEventListener("click", () => this.handlers.onOpen(module.id));
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.handlers.onOpen(module.id);
      });
      list.append(row);
    }

    this.elements.chip.textContent = `// modules: ${this.modules.length}`;
    this.paintGutter();
  }

  /** @brief Numbers every line in the document. */
  private paintGutter(): void {
    const count =
      this.elements.list.closest(".game-code-content")?.querySelectorAll(".code-line").length ?? 0;
    const numbers: HTMLSpanElement[] = [];
    for (let index = 0; index < count; index += 1) {
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      numbers.push(number);
    }
    this.elements.gutter.replaceChildren(...numbers);
  }
}

/**
 * @brief Creates a text node.
 * @param value Text content.
 * @return The text node.
 */
function text(value: string): Text {
  return document.createTextNode(value);
}

/**
 * @brief Creates a syntax span.
 * @param className Syntax class.
 * @param value Text content.
 * @return The span element.
 */
function span(className: string, value: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = value;
  return element;
}
