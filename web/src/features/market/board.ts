/**
 * @file board.ts
 * @brief Market feed document: quotes and index levels rendered as a C++ file.
 * @details The document is the monitor's only surface — a watchlist line, an
 * index basket, and one struct block per ticker. It polls the Worker proxy every
 * three seconds while the tab is visible, keeps the last good snapshot on
 * screen, and persists the watchlist in the browser.
 */

import type { IndicesPayload, MarketIndex, Quote, QuotesPayload } from "@dyno/shared/market";
import { formatTime } from "@/shared/lib/format";

/** The subset of the market client the board needs; tests provide a fake. */
export interface MarketClient {
  quotes(symbols: string[]): Promise<QuotesPayload>;
  indices(): Promise<IndicesPayload>;
}

/** Browser storage key holding the ticker list. */
const STORAGE_KEY = "dyno.market.watchlist";

/** Tickers a fresh browser starts with, picked from the VN30 basket. */
const DEFAULT_WATCHLIST = ["FPT", "HPG", "SSI", "VNM", "MWG", "ACB", "VIC"];

/** Largest watchlist the document accepts. */
export const MAX_WATCHLIST = 12;

/** Poll interval while the document is visible. */
export const POLL_MS = 3000;

/** Ticker shape accepted from the add box. */
const TICKER_PATTERN = /^[A-Z0-9]{1,12}$/;

/** How long an input error stays in the footer. */
const ERROR_TTL_MS = 4000;

/** DOM hosts the board paints into. */
export interface MarketElements {
  /** The document panel; used to pause polling when hidden or closed. */
  panel: HTMLElement;
  /** Code area that receives the lines. */
  content: HTMLElement;
  /** Line-number gutter. */
  gutter: HTMLElement;
  /** Toolbar chip, e.g. `// watchlist: 7 symbols`. */
  chip: HTMLElement;
  /** Ticker input in the toolbar. */
  search: HTMLInputElement;
  /** Button that commits the ticker input. */
  addButton: HTMLButtonElement;
  /** Status bar symbol counter. */
  count: HTMLElement;
  /** Status bar refresh clock. */
  clock: HTMLElement;
  /** Status bar live/stale/offline label. */
  state: HTMLElement;
  /** Footer line for input and network errors. */
  error: HTMLElement;
}

/** Collaborators the board cannot build itself. */
export interface MarketBoardDeps {
  /** Worker proxy client. */
  api: MarketClient;
  /** Storage for the watchlist, or `null` when the browser blocks it. */
  storage: Storage | null;
  /** Poll interval override; tests shrink it. */
  pollMs?: number;
}

/**
 * @brief Creates one code line element.
 * @param extra Optional extra classes, e.g. `indent1`.
 * @return The line element.
 */
function makeLine(extra = ""): HTMLElement {
  const line = document.createElement("div");
  line.className = extra.length > 0 ? `code-line ${extra}` : "code-line";
  return line;
}

/**
 * @brief Creates a syntax span.
 * @param className Syntax class from the editor palette.
 * @param value Text content.
 * @return The span element.
 */
function span(className: string, value: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = value;
  return element;
}

/**
 * @brief Formats a price with two decimals.
 * @param value Price in thousands of VND.
 * @return The fixed-precision string.
 */
function formatPrice(value: number): string {
  return value.toFixed(2);
}

/**
 * @brief Formats a signed number.
 * @param value Raw number.
 * @return The string with an explicit `+` when positive.
 */
function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

/**
 * @brief Formats a signed percentage.
 * @param value Percent value.
 * @return The string with an explicit `+` when positive.
 */
function formatPercent(value: number): string {
  return `${formatSigned(value)}%`;
}

/**
 * @brief Formats a volume without separators, so it reads as a C++ literal.
 * @param value Share count.
 * @return The rounded integer as a string.
 */
function formatVolume(value: number): string {
  return Math.round(value).toString();
}

/**
 * @brief CSS class for a signed value: teal up, red down.
 * @param value Raw number.
 * @return `market-up`, `market-down`, or `market-flat`.
 */
function directionClass(value: number): string {
  if (value > 0) return "market-up";
  if (value < 0) return "market-down";
  return "market-flat";
}

/**
 * @brief Reads the watchlist from storage, falling back to the defaults.
 * @param storage Browser storage, or `null`.
 * @return A valid, deduplicated ticker list.
 */
function loadWatchlist(storage: Storage | null): string[] {
  if (storage === null) return [...DEFAULT_WATCHLIST];

  let raw: unknown = null;
  try {
    raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return [...DEFAULT_WATCHLIST];
  }
  if (!Array.isArray(raw)) return [...DEFAULT_WATCHLIST];

  const symbols: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const symbol = value.trim().toUpperCase();
    if (!TICKER_PATTERN.test(symbol) || symbols.includes(symbol)) continue;
    symbols.push(symbol);
    if (symbols.length >= MAX_WATCHLIST) break;
  }
  return symbols.length > 0 ? symbols : [...DEFAULT_WATCHLIST];
}

/**
 * @brief Renders the market feed document and owns its polling loop.
 */
export class MarketBoard {
  private quoteList: Quote[] = [];
  private indexList: MarketIndex[] = [];
  private watchlist: string[];
  private stale = false;
  private lastTs = 0;
  private failure: string | null = null;
  private inFlight = false;
  private timer: number | null = null;
  private errorTimer: number | null = null;
  private readonly pollMs: number;

  /**
   * @param elements DOM hosts.
   * @param deps API client and storage.
   */
  constructor(
    private readonly elements: MarketElements,
    private readonly deps: MarketBoardDeps,
  ) {
    this.watchlist = loadWatchlist(deps.storage);
    this.pollMs = deps.pollMs ?? POLL_MS;

    elements.addButton.addEventListener("click", () => this.commitInput());
    elements.search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.commitInput();
    });
    elements.content.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const ticker = target.closest<HTMLElement>(".market-ticker");
      const symbol = ticker?.dataset.symbol;
      if (symbol !== undefined) this.removeSymbol(symbol);
    });
  }

  /** Tickers currently watched, in display order. */
  get watchlistSymbols(): string[] {
    return [...this.watchlist];
  }

  /** Last quote batch, possibly empty. */
  get quotes(): Quote[] {
    return [...this.quoteList];
  }

  /** Last index basket, possibly empty. */
  get indices(): MarketIndex[] {
    return [...this.indexList];
  }

  /** Whether the last batch came from the stale fallback. */
  get isStale(): boolean {
    return this.stale;
  }

  /**
   * @brief Paints the initial document and starts polling.
   */
  start(): void {
    if (this.timer !== null) return;
    this.render();
    void this.refresh();
    this.timer = window.setInterval(() => this.tick(), this.pollMs);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /**
   * @brief Stops polling and drops listeners. Safe to call twice.
   */
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.errorTimer !== null) window.clearTimeout(this.errorTimer);
    this.errorTimer = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /**
   * @brief Moves keyboard focus to the ticker box.
   */
  focus(): void {
    this.elements.search.focus();
    this.elements.search.select();
  }

  /**
   * @brief Adds one ticker to the watchlist.
   * @param raw Text from the input box.
   * @return Whether the ticker was added.
   */
  addSymbol(raw: string): boolean {
    const symbol = raw.trim().toUpperCase();
    if (!TICKER_PATTERN.test(symbol)) {
      this.showError(`// unknown ticker: ${raw.trim().length > 0 ? raw.trim() : "(empty)"}`);
      return false;
    }
    if (this.watchlist.includes(symbol)) {
      this.showError(`// ${symbol} is already in the watchlist`);
      return false;
    }
    if (this.watchlist.length >= MAX_WATCHLIST) {
      this.showError(`// watchlist is full (${MAX_WATCHLIST} symbols) - remove one first`);
      return false;
    }

    this.watchlist = [...this.watchlist, symbol];
    this.persist();
    this.elements.search.value = "";
    this.render();
    void this.refresh();
    return true;
  }

  /**
   * @brief Removes one ticker from the watchlist.
   * @param symbol Ticker to drop.
   */
  removeSymbol(symbol: string): void {
    const next = this.watchlist.filter((candidate) => candidate !== symbol);
    if (next.length === this.watchlist.length) return;

    this.watchlist = next;
    this.persist();
    this.render();
    void this.refresh();
  }

  /**
   * @brief Fetches both feed endpoints and repaints.
   * @return Resolves when the repaint is done; never rejects.
   */
  async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    const quotesRequest = this.watchlist.length > 0 ? this.deps.api.quotes(this.watchlist) : null;
    const [quotesResult, indicesResult] = await Promise.allSettled([
      quotesRequest ?? Promise.resolve(null),
      this.deps.api.indices(),
    ]);

    let failure: string | null = null;
    if (quotesResult.status === "fulfilled" && quotesResult.value !== null) {
      this.quoteList = quotesResult.value.quotes;
      this.stale = quotesResult.value.stale;
      this.lastTs = quotesResult.value.ts;
    } else if (quotesResult.status === "rejected") {
      failure = "// [error] quote feed unavailable - retrying every 3s";
    }

    if (indicesResult.status === "fulfilled") {
      this.indexList = indicesResult.value.indices;
      if (indicesResult.value.ts > this.lastTs) this.lastTs = indicesResult.value.ts;
    } else if (failure === null) {
      failure = "// [error] index feed unavailable - retrying every 3s";
    }

    this.failure = failure;
    this.inFlight = false;
    this.render();
  }

  /** @brief One polling tick; pauses while the document is not visible. */
  private tick(): void {
    if (!this.elements.panel.isConnected) {
      this.stop();
      return;
    }
    if (this.elements.panel.hidden || document.hidden) return;
    void this.refresh();
  }

  /** @brief Refreshes immediately when the browser tab becomes visible. */
  private readonly onVisibility = (): void => {
    if (!document.hidden) void this.refresh();
  };

  /** @brief Commits the toolbar input, if it holds something. */
  private commitInput(): void {
    if (this.elements.search.value.trim().length === 0) return;
    this.addSymbol(this.elements.search.value);
  }

  /**
   * @brief Persists the watchlist, ignoring a blocked storage.
   */
  private persist(): void {
    if (this.deps.storage === null) return;
    try {
      this.deps.storage.setItem(STORAGE_KEY, JSON.stringify(this.watchlist));
    } catch {
      // A full or blocked storage must not break the document.
    }
  }

  /**
   * @brief Shows a transient input error in the footer.
   * @param message Comment text to show.
   */
  private showError(message: string): void {
    if (this.errorTimer !== null) window.clearTimeout(this.errorTimer);
    this.elements.error.textContent = message;
    this.errorTimer = window.setTimeout(() => {
      this.elements.error.textContent = "";
      this.errorTimer = null;
    }, ERROR_TTL_MS);
  }

  /** @brief Repaints the whole document. */
  private render(): void {
    const { content, gutter } = this.elements;
    content.replaceChildren();

    this.appendHeader();
    this.appendIndices();
    this.appendQuotes();
    this.appendFooter();

    this.paintGutter();
    this.paintStatus();
    if (this.failure === null && this.errorTimer === null) this.elements.error.textContent = "";
  }

  /** @brief Paints the file preamble and the watchlist declaration. */
  private appendHeader(): void {
    const header = makeLine();
    header.append(span("comment", "// <auto-generated> DynoFreeChat market feed bridge (rev 1)"));
    contentOf(this.elements.content, header);

    const profile = makeLine();
    profile.append(span("comment", "//   upstream: vps datafeed | transport: worker proxy | cache: 3s"));
    contentOf(this.elements.content, profile);

    contentOf(this.elements.content, makeLine());
    contentOf(this.elements.content, makeLine());

    const pragma = makeLine();
    pragma.append(span("kw", "#pragma"), span("ident", " once"));
    contentOf(this.elements.content, pragma);

    const include = makeLine();
    include.append(span("kw", "#include"), span("str", ' "dynofreechat/feed.h"'));
    contentOf(this.elements.content, include);

    contentOf(this.elements.content, makeLine());

    const namespace = makeLine();
    namespace.append(span("kw", "namespace"), span("ident", " DynoFreeChat::Market"), span("kw", " {"));
    contentOf(this.elements.content, namespace);

    contentOf(this.elements.content, makeLine());

    const comment = makeLine();
    comment.append(
      span("comment", "// watchlist - click a ticker to remove it, type in the box above to add one"),
    );
    contentOf(this.elements.content, comment);

    const watchlistLine = makeLine();
    watchlistLine.append(span("type", "std::vector<const char*>"), span("ident", " g_Watchlist = { "));
    if (this.watchlist.length === 0) {
      watchlistLine.append(span("comment", "/* empty */"));
    }
    this.watchlist.forEach((symbol, index) => {
      if (index > 0) watchlistLine.append(document.createTextNode(", "));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "market-ticker";
      button.dataset.symbol = symbol;
      button.textContent = `"${symbol}"`;
      button.title = `Remove ${symbol} from the watchlist`;
      button.setAttribute("aria-label", `Remove ${symbol} from the watchlist`);
      watchlistLine.append(button);
    });
    watchlistLine.append(document.createTextNode(" };"));
    contentOf(this.elements.content, watchlistLine);
  }

  /** @brief Paints the index basket declaration. */
  private appendIndices(): void {
    contentOf(this.elements.content, makeLine());

    const comment = makeLine();
    comment.append(span("comment", "// index basket - replaced on every refresh"));
    contentOf(this.elements.content, comment);

    const open = makeLine();
    open.append(span("kw", "static const"), span("type", " MarketIndex"), span("ident", " g_Indices[] = {"));
    contentOf(this.elements.content, open);

    if (this.indexList.length === 0) {
      const waiting = makeLine("indent1");
      waiting.append(span("comment", "// waiting for the first index batch"));
      contentOf(this.elements.content, waiting);
    }

    for (const index of this.indexList) {
      const line = makeLine("indent1");
      line.append(
        document.createTextNode("{ "),
        span("str", `"${index.name}"`),
        document.createTextNode(", "),
        span("num", formatPrice(index.value)),
        document.createTextNode(", "),
        span(`num ${directionClass(index.change)}`, formatSigned(index.change)),
        document.createTextNode(", "),
        span(`num ${directionClass(index.changePercent)}`, formatPercent(index.changePercent)),
        document.createTextNode(" },"),
      );
      contentOf(this.elements.content, line);
    }

    const close = makeLine();
    close.append(document.createTextNode("};"));
    contentOf(this.elements.content, close);
  }

  /** @brief Paints one struct block per watched ticker. */
  private appendQuotes(): void {
    contentOf(this.elements.content, makeLine());

    const comment = makeLine();
    comment.append(
      span("comment", `// quote table - snapshot ${this.clockText()} (${this.stateText().toLowerCase()})`),
    );
    contentOf(this.elements.content, comment);

    if (this.quoteList.length === 0) {
      const empty = makeLine();
      empty.append(span("comment", "// no quotes yet - waiting for the first batch"));
      contentOf(this.elements.content, empty);
      return;
    }

    for (const quote of this.quoteList) {
      contentOf(this.elements.content, makeLine());

      const open = makeLine();
      open.append(span("kw", "struct"), span("ident", ` ${quote.symbol}_Quote`), span("kw", " {"));
      contentOf(this.elements.content, open);

      const direction = directionClass(quote.change);
      const last = makeLine("indent1");
      last.append(
        span("type", "double"),
        document.createTextNode(" last   = "),
        span(`num ${direction}`, formatPrice(quote.last)),
        document.createTextNode(";   // "),
        span(direction, `${formatSigned(quote.change)} (${formatPercent(quote.changePercent)})`),
      );
      contentOf(this.elements.content, last);

      const range = makeLine("indent1");
      range.append(
        span("type", "double"),
        document.createTextNode(" ref    = "),
        span("num", formatPrice(quote.ref)),
        document.createTextNode(";   // ceil "),
        span("num", formatPrice(quote.ceiling)),
        document.createTextNode("  floor "),
        span("num", formatPrice(quote.floor)),
      );
      contentOf(this.elements.content, range);

      const volume = makeLine("indent1");
      volume.append(
        span("type", "long"),
        document.createTextNode(" volume = "),
        span("num", formatVolume(quote.volume)),
        document.createTextNode(";   // foreign "),
        span("num", formatVolume(quote.foreignBuy)),
        document.createTextNode("  room "),
        span("num", formatVolume(quote.foreignRoom)),
      );
      contentOf(this.elements.content, volume);

      for (const side of ["bids", "asks"] as const) {
        const levels = side === "bids" ? quote.bids : quote.asks;
        const line = makeLine("indent1");
        line.append(
          span("type", "Level"),
          document.createTextNode(` ${side}[3] = { `),
          ...levels.flatMap((level, index) => {
            const parts: Node[] = [];
            if (index > 0) parts.push(document.createTextNode(", "));
            parts.push(
              document.createTextNode("{"),
              span("num", formatPrice(level.price)),
              document.createTextNode(", "),
              span("num", formatVolume(level.volume)),
              document.createTextNode("}"),
            );
            return parts;
          }),
          document.createTextNode(" };"),
        );
        contentOf(this.elements.content, line);
      }

      const close = makeLine();
      close.append(document.createTextNode("};"));
      contentOf(this.elements.content, close);
    }
  }

  /** @brief Paints the namespace close and any failure note. */
  private appendFooter(): void {
    contentOf(this.elements.content, makeLine());

    if (this.stale) {
      const stale = makeLine();
      stale.append(
        span("comment", `// [stale] upstream unavailable - showing the ${this.clockText()} snapshot`),
      );
      contentOf(this.elements.content, stale);
    }

    if (this.failure !== null) {
      const failure = makeLine();
      failure.append(span("comment", this.failure));
      contentOf(this.elements.content, failure);
    }

    const close = makeLine();
    close.append(document.createTextNode("}"), span("comment", " // namespace DynoFreeChat::Market"));
    contentOf(this.elements.content, close);
  }

  /** @brief Numbers every rendered line. */
  private paintGutter(): void {
    const lines = this.elements.content.querySelectorAll(":scope > .code-line");
    const numbers: HTMLSpanElement[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      numbers.push(number);
    }
    this.elements.gutter.replaceChildren(...numbers);
  }

  /** @brief Paints the toolbar chip and the status bar. */
  private paintStatus(): void {
    const symbols = this.watchlist.length;
    this.elements.chip.textContent = `// watchlist: ${symbols} ${symbols === 1 ? "symbol" : "symbols"}`;
    this.elements.count.textContent = `${symbols} symbols`;
    this.elements.clock.textContent = this.clockText();
    this.elements.state.textContent = this.stateText();
    this.elements.state.className = this.stateClass();
  }

  /** @brief Clock label for the status bar. */
  private clockText(): string {
    return this.lastTs > 0 ? formatTime(this.lastTs) : "--:--:--";
  }

  /** @brief Live/stale/offline label. */
  private stateText(): string {
    if (this.failure !== null) return "Offline";
    if (this.stale) return "Stale";
    return this.quoteList.length > 0 || this.indexList.length > 0 ? "Live" : "Loading";
  }

  /** @brief CSS class for the state label. */
  private stateClass(): string {
    if (this.failure !== null) return "sb-item market-state--offline";
    if (this.stale) return "sb-item market-state--stale";
    return "sb-item market-state--live";
  }
}

/**
 * @brief Appends a line to the code area.
 * @param host Code area element.
 * @param line Line to append.
 */
function contentOf(host: HTMLElement, line: HTMLElement): void {
  host.append(line);
}
