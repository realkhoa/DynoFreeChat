/**
 * @file feed-view.ts
 * @brief Community feed document: FireAnt, F247 and VOZ posts as a C# file.
 * @details Posts render as comment blocks — one header line with author, time
 * and likes, then the wrapped body — so the document keeps the editor illusion
 * while staying readable. Polling pauses with the tab.
 */

import type { FeedItem, FeedSource } from "@dyno/shared/market";
import { formatTime } from "@/shared/lib/format";
import type { MarketClient } from "./board";

/** Sources offered by the toolbar, in display order. */
export const FEED_SOURCE_ORDER: FeedSource[] = ["fireant", "f247", "voz"];

/** Display label per source. */
export const FEED_SOURCE_LABELS: Record<FeedSource, string> = {
  fireant: "FireAnt",
  f247: "F247",
  voz: "VOZ F31",
};

/** Characters per wrapped body line. */
export const WRAP_WIDTH = 104;

/** Poll interval while the feed document is visible. */
export const FEED_POLL_MS = 60_000;

/** DOM hosts the feed paints into. */
export interface FeedElements {
  panel: HTMLElement;
  symbol: HTMLInputElement;
  openButton: HTMLButtonElement;
  sources: HTMLElement;
  list: HTMLElement;
  state: HTMLElement;
  clock: HTMLElement;
  pageLabel: HTMLElement;
  prevButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
}

/**
 * @brief Wraps one post body into comment-sized lines.
 * @param text Post body.
 * @param width Characters per line.
 * @return The wrapped lines.
 */
export function wrapText(text: string, width = WRAP_WIDTH): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/)) {
    if (word.length === 0) continue;
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * @brief Builds the header line of one post.
 * @param item Feed item.
 * @return The comment text.
 */
export function feedHeader(item: FeedItem): string {
  const stamp = item.createdAt.length > 0 ? item.createdAt : "unknown time";
  const likes = item.likes > 0 ? ` · ♥ ${item.likes}` : "";
  return `// ── ${item.source} · ${item.author} · ${stamp}${likes}`;
}

/**
 * @brief Owns the community feed document.
 */
export class FeedView {
  private symbol = "FPT";
  private source: FeedSource = "fireant";
  private items: FeedItem[] = [];
  private page = 1;
  private maxPage = 1;
  private lastTs = 0;
  private error: string | null = null;
  private inFlight = false;
  private timer: number | null = null;

  /**
   * @param elements DOM hosts.
   * @param client Market proxy client.
   */
  constructor(
    private readonly elements: FeedElements,
    private readonly client: MarketClient,
  ) {
    this.elements.openButton.addEventListener("click", () => this.commitSymbol());
    this.elements.symbol.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.commitSymbol();
    });
    this.elements.sources.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("[data-source]");
      const source = button?.dataset.source as FeedSource | undefined;
      if (source !== undefined) this.setSource(source);
    });
    this.elements.prevButton.addEventListener("click", () => void this.loadPage(this.page - 1));
    this.elements.nextButton.addEventListener("click", () => void this.loadPage(this.page + 1));
  }

  /** Symbol currently read. */
  get currentSymbol(): string {
    return this.symbol;
  }

  /** Source currently selected. */
  get currentSource(): FeedSource {
    return this.source;
  }

  /** Items currently rendered. */
  get currentItems(): FeedItem[] {
    return [...this.items];
  }

  /** @brief Paints the document and starts polling. */
  start(): void {
    this.elements.symbol.value = this.symbol;
    this.paintSourceRow();
    this.render();
    void this.loadPage(0);
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), FEED_POLL_MS);
  }

  /** @brief Stops polling. */
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * @brief Changes the read symbol.
   * @param raw Text from the symbol box.
   */
  setSymbol(raw: string): void {
    const symbol = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
      this.error = "// [error] invalid ticker";
      this.render();
      return;
    }
    this.symbol = symbol;
    this.elements.symbol.value = symbol;
    void this.loadPage(0);
  }

  /**
   * @brief Changes the community source.
   * @param source One of {@link FEED_SOURCE_ORDER}.
   */
  setSource(source: FeedSource): void {
    if (!FEED_SOURCE_ORDER.includes(source)) return;
    this.source = source;
    this.paintSourceRow();
    void this.loadPage(0);
  }

  /**
   * @brief Loads one page and repaints.
   * @param page Requested page, `0` for the latest.
   * @return Resolves when the repaint is done; never rejects.
   */
  async loadPage(page: number): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.elements.state.textContent = "Loading";

    try {
      const payload = await this.client.feed(this.symbol, this.source, Math.max(0, page));
      this.items = payload.items;
      this.page = payload.page;
      this.maxPage = payload.maxPage;
      this.lastTs = payload.ts;
      this.error = null;
      this.elements.state.textContent = `${payload.items.length} posts`;
    } catch {
      this.items = [];
      this.error = "// [error] community feed unavailable";
      this.elements.state.textContent = "Offline";
    } finally {
      this.inFlight = false;
      this.render();
    }
  }

  /** @brief Commits the symbol box. */
  private commitSymbol(): void {
    this.setSymbol(this.elements.symbol.value);
  }

  /** @brief One polling tick; pauses while the tab is hidden. */
  private tick(): void {
    if (!this.elements.panel.isConnected) {
      this.stop();
      return;
    }
    if (this.elements.panel.hidden || document.hidden) return;
    void this.loadPage(this.source === "voz" ? this.page : 0);
  }

  /** @brief Repaints the source buttons' active state. */
  private paintSourceRow(): void {
    for (const button of this.elements.sources.querySelectorAll<HTMLButtonElement>("[data-source]")) {
      button.classList.toggle("is-active", button.dataset.source === this.source);
    }
  }

  /** @brief Repaints the document. */
  private render(): void {
    const list = this.elements.list;
    list.replaceChildren();

    const header = document.createElement("div");
    header.className = "code-line";
    header.append(
      comment(
        `// community feed - $${this.symbol} · ${FEED_SOURCE_LABELS[this.source]} · page ${this.page}/${this.maxPage}`,
      ),
    );
    list.append(header);

    if (this.items.length === 0 && this.error === null) {
      const waiting = document.createElement("div");
      waiting.className = "code-line";
      waiting.append(comment("// no posts yet - the feed refreshes every 60s"));
      list.append(waiting);
    }

    for (const item of this.items) {
      const headerLine = document.createElement("div");
      headerLine.className = "code-line";
      headerLine.append(comment(feedHeader(item)));
      list.append(headerLine);

      for (const line of wrapText(item.text)) {
        const bodyLine = document.createElement("div");
        bodyLine.className = "code-line";
        bodyLine.append(comment(`// ${line}`));
        list.append(bodyLine);
      }

      const spacer = document.createElement("div");
      spacer.className = "code-line empty";
      list.append(spacer);
    }

    if (this.error !== null) {
      const error = document.createElement("div");
      error.className = "code-line";
      error.append(comment(this.error));
      list.append(error);
    }

    this.elements.pageLabel.textContent = `page ${this.page}/${this.maxPage}`;
    this.elements.prevButton.disabled = this.page <= 1;
    this.elements.nextButton.disabled = this.source !== "voz" || this.page >= this.maxPage;
    this.elements.clock.textContent = this.lastTs > 0 ? formatTime(this.lastTs) : "--:--:--";
  }
}

/**
 * @brief Creates a comment span.
 * @param value Comment text.
 * @return The span element.
 */
function comment(value: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "comment";
  element.textContent = value;
  return element;
}
