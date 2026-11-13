// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndicesPayload, QuotesPayload } from "@dyno/shared/market";
import {
  MAX_WATCHLIST,
  MarketBoard,
  POLL_MS,
  type MarketBoardDeps,
  type MarketClient,
  type MarketElements,
} from "@/features/market/board";

/** One quote the fake feed can return. */
function quote(symbol: string, last = 132.5): QuotesPayload["quotes"][number] {
  return {
    symbol,
    ref: 131.3,
    ceiling: 140.4,
    floor: 122.2,
    last,
    avg: 132.1,
    high: 133.2,
    low: 130.9,
    change: 1.2,
    changePercent: 0.91,
    volume: 1_234_500,
    foreignBuy: 210_300,
    foreignRoom: 4_567_800,
    side: "BUY",
    bids: [{ price: 132.4, volume: 12_300 }],
    asks: [{ price: 132.5, volume: 9_900 }],
  };
}

const INDICES: IndicesPayload = {
  indices: [{ key: "10", name: "VN-INDEX", value: 1287.45, change: 3.12, changePercent: 0.24 }],
  stale: false,
  ts: 1_700_000_000_000,
};

/** In-memory `Storage` stand-in. */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

interface Harness {
  board: MarketBoard;
  elements: MarketElements;
  api: { quotes: ReturnType<typeof vi.fn>; indices: ReturnType<typeof vi.fn> };
  storage: MemoryStorage;
  quotesPayload: { value: QuotesPayload | Error };
  indicesPayload: { value: IndicesPayload | Error };
}

/**
 * @brief Builds the document hosts and a scripted market client.
 * @param watchlist Optional stored watchlist.
 * @return The harness.
 */
function makeHarness(watchlist?: string[]): Harness {
  document.body.replaceChildren();

  const panel = document.createElement("section");
  panel.id = "market-view";
  panel.innerHTML = `
    <span id="market-chip"></span>
    <input id="market-search" />
    <button id="market-add-btn"></button>
    <div id="market-gutter"></div>
    <div id="market-content"></div>
    <div id="market-error"></div>
    <span id="market-count"></span>
    <span id="market-clock"></span>
    <span id="market-state"></span>
  `;
  document.body.append(panel);

  const elements: MarketElements = {
    panel,
    content: panel.querySelector<HTMLElement>("#market-content")!,
    gutter: panel.querySelector<HTMLElement>("#market-gutter")!,
    chip: panel.querySelector<HTMLElement>("#market-chip")!,
    search: panel.querySelector<HTMLInputElement>("#market-search")!,
    addButton: panel.querySelector<HTMLButtonElement>("#market-add-btn")!,
    count: panel.querySelector<HTMLElement>("#market-count")!,
    clock: panel.querySelector<HTMLElement>("#market-clock")!,
    state: panel.querySelector<HTMLElement>("#market-state")!,
    error: panel.querySelector<HTMLElement>("#market-error")!,
  };

  const quotesPayload: { value: QuotesPayload | Error } = {
    value: { quotes: [quote("FPT")], stale: false, ts: 1_700_000_000_000 },
  };
  const indicesPayload: { value: IndicesPayload | Error } = { value: INDICES };

  const api = {
    quotes: vi.fn(async () => {
      if (quotesPayload.value instanceof Error) throw quotesPayload.value;
      return quotesPayload.value;
    }),
    indices: vi.fn(async () => {
      if (indicesPayload.value instanceof Error) throw indicesPayload.value;
      return indicesPayload.value;
    }),
  };
  const storage = new MemoryStorage();
  if (watchlist !== undefined) storage.setItem("dyno.market.watchlist", JSON.stringify(watchlist));

  const deps: MarketBoardDeps = { api: api as unknown as MarketClient, storage };
  const board = new MarketBoard(elements, deps);

  return { board, elements, api, storage, quotesPayload, indicesPayload };
}

describe("MarketBoard", () => {
  let h: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    h = makeHarness(["FPT", "HPG"]);
  });

  afterEach(() => {
    h.board.stop();
    vi.useRealTimers();
  });

  it("starts from the stored watchlist", () => {
    h.board.start();
    expect(h.board.watchlistSymbols).toEqual(["FPT", "HPG"]);
    expect(h.elements.chip.textContent).toBe("// watchlist: 2 symbols");
  });

  it("falls back to the default basket when storage is empty", () => {
    h = makeHarness();
    expect(h.board.watchlistSymbols).toContain("FPT");
  });

  it("renders the index basket and one struct per quote", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);

    const content = h.elements.content;
    expect(content.textContent).toContain("g_Indices[]");
    expect(content.textContent).toContain('"VN-INDEX"');
    expect(content.textContent).toContain("struct FPT_Quote {");
    expect(content.textContent).toContain("bids[3]");
    expect(content.textContent).toContain("asks[3]");
    expect(h.elements.state.textContent).toBe("Live");
  });

  it("numbers every rendered line in the gutter", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);

    const lines = h.elements.content.querySelectorAll(":scope > .code-line");
    const numbers = h.elements.gutter.querySelectorAll("span");
    expect(numbers).toHaveLength(lines.length);
    expect(numbers[numbers.length - 1]?.textContent).toBe(String(lines.length));
  });

  it("paints the stale snapshot when the proxy says so", async () => {
    h.quotesPayload.value = { quotes: [quote("FPT")], stale: true, ts: 1_700_000_000_000 };
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.elements.state.textContent).toBe("Stale");
    expect(h.elements.content.textContent).toContain("[stale]");
  });

  it("reports offline when the quote feed is unreachable", async () => {
    h.quotesPayload.value = new Error("down");
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.elements.state.textContent).toBe("Offline");
    expect(h.elements.content.textContent).toContain("[error] quote feed unavailable");
  });

  it("adds a ticker, persists it, and refreshes", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);
    const calls = h.api.quotes.mock.calls.length;

    h.elements.search.value = "ssi";
    h.board.addSymbol("ssi");

    expect(h.board.watchlistSymbols).toEqual(["FPT", "HPG", "SSI"]);
    expect(JSON.parse(h.storage.getItem("dyno.market.watchlist") ?? "[]")).toEqual(["FPT", "HPG", "SSI"]);
    expect(h.elements.search.value).toBe("");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.api.quotes.mock.calls.length).toBe(calls + 1);
  });

  it("refuses an invalid, duplicate, or over-capacity ticker", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.board.addSymbol("FPT!")).toBe(false);
    expect(h.elements.error.textContent).toContain("unknown ticker");
    expect(h.board.addSymbol("FPT")).toBe(false);
    expect(h.elements.error.textContent).toContain("already in the watchlist");

    const full = makeHarness(Array.from({ length: MAX_WATCHLIST }, (_unused, index) => `S${index}`));
    full.board.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(full.board.addSymbol("ZZZ")).toBe(false);
    expect(full.elements.error.textContent).toContain("watchlist is full");
    full.board.stop();
  });

  it("removes a ticker when its declaration is clicked", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);

    const ticker = h.elements.content.querySelector<HTMLButtonElement>('.market-ticker[data-symbol="HPG"]');
    expect(ticker).not.toBeNull();
    ticker?.click();

    expect(h.board.watchlistSymbols).toEqual(["FPT"]);
    expect(JSON.parse(h.storage.getItem("dyno.market.watchlist") ?? "[]")).toEqual(["FPT"]);
  });

  it("polls on the interval while the document is visible", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);
    const calls = h.api.quotes.mock.calls.length;

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.api.quotes.mock.calls.length).toBe(calls + 1);
  });

  it("skips polling while the document tab is hidden", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);
    const calls = h.api.quotes.mock.calls.length;

    h.elements.panel.hidden = true;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(h.api.quotes.mock.calls.length).toBe(calls);
  });

  it("stops polling once the document panel is removed", async () => {
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);
    h.elements.panel.remove();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    // One final tick notices the panel is gone and tears the interval down.
    const calls = h.api.quotes.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(h.api.quotes.mock.calls.length).toBe(calls);
  });

  it("does not start a second interval when the tab reopens", async () => {
    h.board.start();
    h.board.start();
    await vi.advanceTimersByTimeAsync(0);
    const calls = h.api.quotes.mock.calls.length;

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.api.quotes.mock.calls.length).toBe(calls + 1);
  });
});
