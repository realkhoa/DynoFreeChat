// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle, DepthPayload, FeedPayload, FeedSource } from "@dyno/shared/market";
import type { MarketClient } from "@/features/market/board";
import { buildChartModel, drawChart, MAX_BARS } from "@/features/market/chart-view";
import { DepthView, gauge, GAUGE_WIDTH } from "@/features/market/depth-view";
import { FeedView, feedHeader, wrapText } from "@/features/market/feed-view";
import { FEED_MODULES, MarketHubView } from "@/features/market/hub";

/** One candle with a fixed shape; only close/volume vary per index. */
function candle(index: number, close = 132, volume = 100): Candle {
  return {
    time: 1_700_000_000_000 + index * 60_000,
    open: close - 0.2,
    high: close + 0.4,
    low: close - 0.5,
    close,
    volume,
  };
}

/** Records the Canvas calls the chart makes. */
function fakeContext(): CanvasRenderingContext2D {
  const context = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
  };
  return context as unknown as CanvasRenderingContext2D;
}

describe("buildChartModel", () => {
  it("keeps only the visible window and scales it", () => {
    const candles = Array.from({ length: MAX_BARS + 30 }, (_unused, index) =>
      candle(index, 100 + index, index),
    );
    const model = buildChartModel(candles);

    expect(model.candles).toHaveLength(MAX_BARS);
    expect(model.candles[0]).toBe(candles[30]);
    expect(model.min).toBe(candles[30]!.low);
    expect(model.max).toBe(candles[candles.length - 1]!.high);
    expect(model.maxVolume).toBe(candles[candles.length - 1]!.volume);
  });

  it("widens a flat series so the scale never divides by zero", () => {
    const model = buildChartModel([candle(0, 132), candle(1, 132)]);
    expect(model.max).toBeGreaterThan(model.min);
  });

  it("returns an empty model for an empty series", () => {
    expect(buildChartModel([])).toEqual({ candles: [], min: 0, max: 0, maxVolume: 0 });
  });
});

describe("drawChart", () => {
  it("draws one body and one volume bar per candle", () => {
    const ctx = fakeContext();
    drawChart(ctx, buildChartModel([candle(0), candle(1), candle(2)]), 800, 400);

    // Background, three candle bodies, three volume bars.
    expect(ctx.fillRect).toHaveBeenCalledTimes(7);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("writes the empty-series note instead of drawing", () => {
    const ctx = fakeContext();
    drawChart(ctx, buildChartModel([]), 800, 400);
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining("no candle telemetry"),
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it("tolerates a null context and a zero-sized canvas", () => {
    expect(() => drawChart(null, buildChartModel([candle(0)]), 800, 400)).not.toThrow();
    expect(() => drawChart(fakeContext(), buildChartModel([candle(0)]), 0, 0)).not.toThrow();
  });
});

describe("gauge", () => {
  it("fills the bar in proportion to the volume", () => {
    expect(gauge(100)).toHaveLength(GAUGE_WIDTH);
    expect(gauge(100).startsWith("█")).toBe(true);
    expect(gauge(0).startsWith("░")).toBe(true);
    expect(gauge(50)).toContain("█");
  });

  it("clamps out-of-range percentages", () => {
    expect(gauge(-10).startsWith("░")).toBe(true);
    expect(gauge(250)).toBe("█".repeat(GAUGE_WIDTH));
  });
});

describe("wrapText", () => {
  it("wraps on word boundaries", () => {
    const lines = wrapText("một hai ba bốn", 7);
    expect(lines).toEqual(["một hai", "ba bốn"]);
  });

  it("keeps a word longer than the width intact", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcdefghij"]);
  });

  it("returns nothing for empty text", () => {
    expect(wrapText("   ")).toEqual([]);
  });
});

describe("feedHeader", () => {
  it("includes source, author, time and likes", () => {
    const header = feedHeader({
      id: "fa_1",
      source: "FireAnt",
      author: "An",
      createdAt: "2026-11-13T02:00:00Z",
      text: "x",
      topic: "",
      likes: 7,
      replies: 0,
      url: "",
    });
    expect(header).toContain("FireAnt");
    expect(header).toContain("An");
    expect(header).toContain("♥ 7");
  });
});

/** Builds a fake market client; each method returns a scripted payload. */
function fakeClient(overrides: Partial<MarketClient> = {}): MarketClient {
  return {
    quotes: vi.fn(async () => ({ quotes: [], stale: false, ts: 1 })),
    indices: vi.fn(async () => ({ indices: [], stale: false, ts: 1 })),
    chart: vi.fn(async () => ({ symbol: "FPT", resolution: "1D", candles: [candle(0)], ts: 1 })),
    depth: vi.fn(async () => ({ symbol: "FPT", totalVolume: 2400, levels: [], ts: 1 })),
    feed: vi.fn(async () => ({ symbol: "FPT", source: "fireant", items: [], page: 1, maxPage: 1, ts: 1 })),
    ...overrides,
  };
}

describe("DepthView", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("section");
    host.innerHTML = `
      <input id="depth-symbol" />
      <button id="depth-open-btn"></button>
      <div id="depth-content"></div>
      <div id="depth-gutter"></div>
      <span id="depth-chip"></span>
      <span id="depth-state"></span>
      <span id="depth-clock"></span>`;
    document.body.replaceChildren(host);
  });

  it("renders one code line per level with its gauge", async () => {
    const levels: DepthPayload["levels"] = [
      { price: 132.5, volume: 400, percent: 33.33 },
      { price: 132.4, volume: 1200, percent: 100 },
    ];
    const view = new DepthView(
      {
        panel: host,
        content: host.querySelector("#depth-content")!,
        gutter: host.querySelector("#depth-gutter")!,
        symbol: host.querySelector<HTMLInputElement>("#depth-symbol")!,
        openButton: host.querySelector<HTMLButtonElement>("#depth-open-btn")!,
        chip: host.querySelector<HTMLElement>("#depth-chip")!,
        state: host.querySelector<HTMLElement>("#depth-state")!,
        clock: host.querySelector<HTMLElement>("#depth-clock")!,
      },
      fakeClient({ depth: vi.fn(async () => ({ symbol: "FPT", totalVolume: 1600, levels, ts: 1 })) }),
    );

    view.start();
    await vi.waitFor(() => expect(view.currentLevels).toHaveLength(2));

    const content = host.querySelector("#depth-content")!;
    expect(content.textContent).toContain("FPT_Profile");
    expect(content.textContent).toContain("132.50");
    expect(content.textContent).toContain("1200");
    expect(content.textContent).toContain("100.0%");
    expect(content.textContent).toContain("█");
    expect(host.querySelector("#depth-gutter")?.children.length).toBeGreaterThan(0);
  });
});

describe("FeedView", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("section");
    host.innerHTML = `
      <input id="feed-symbol" />
      <button id="feed-open-btn"></button>
      <div id="feed-sources">
        <button data-source="fireant"></button>
        <button data-source="f247"></button>
        <button data-source="voz"></button>
      </div>
      <div id="feed-content"></div>
      <span id="feed-state"></span>
      <span id="feed-clock"></span>
      <span id="feed-page"></span>
      <button id="feed-prev"></button>
      <button id="feed-next"></button>`;
    document.body.replaceChildren(host);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  function makeFeed(items: FeedPayload["items"]): FeedView {
    const view = new FeedView(
      {
        panel: host,
        symbol: host.querySelector<HTMLInputElement>("#feed-symbol")!,
        openButton: host.querySelector<HTMLButtonElement>("#feed-open-btn")!,
        sources: host.querySelector<HTMLElement>("#feed-sources")!,
        list: host.querySelector<HTMLElement>("#feed-content")!,
        state: host.querySelector<HTMLElement>("#feed-state")!,
        clock: host.querySelector<HTMLElement>("#feed-clock")!,
        pageLabel: host.querySelector<HTMLElement>("#feed-page")!,
        prevButton: host.querySelector<HTMLButtonElement>("#feed-prev")!,
        nextButton: host.querySelector<HTMLButtonElement>("#feed-next")!,
      },
      fakeClient({
        feed: vi.fn(async (_symbol: string, source: FeedSource) => ({
          symbol: "FPT",
          source,
          items,
          page: 1,
          maxPage: 1,
          ts: 1,
        })),
      }),
    );
    view.start();
    return view;
  }

  it("renders each post as a comment block", async () => {
    makeFeed([
      {
        id: "fa_1",
        source: "FireAnt",
        author: "An",
        createdAt: "2026-11-13T02:00:00Z",
        text: "Dòng tiền vào mạnh",
        topic: "",
        likes: 7,
        replies: 0,
        url: "",
      },
    ]);
    await vi.waitFor(() => expect(host.querySelector("#feed-state")?.textContent).toBe("1 posts"));

    const text = host.querySelector("#feed-content")?.textContent ?? "";
    expect(text).toContain("FireAnt");
    expect(text).toContain("An");
    expect(text).toContain("// Dòng tiền vào mạnh");
  });

  it("refetches when the source changes", async () => {
    const client = fakeClient();
    const view = new FeedView(
      {
        panel: host,
        symbol: host.querySelector<HTMLInputElement>("#feed-symbol")!,
        openButton: host.querySelector<HTMLButtonElement>("#feed-open-btn")!,
        sources: host.querySelector<HTMLElement>("#feed-sources")!,
        list: host.querySelector<HTMLElement>("#feed-content")!,
        state: host.querySelector<HTMLElement>("#feed-state")!,
        clock: host.querySelector<HTMLElement>("#feed-clock")!,
        pageLabel: host.querySelector<HTMLElement>("#feed-page")!,
        prevButton: host.querySelector<HTMLButtonElement>("#feed-prev")!,
        nextButton: host.querySelector<HTMLButtonElement>("#feed-next")!,
      },
      client,
    );
    view.start();
    await vi.waitFor(() => expect(client.feed).toHaveBeenCalled());

    view.setSource("f247");
    await vi.waitFor(() => expect(client.feed).toHaveBeenCalledWith("FPT", "f247", 0));
    expect(view.currentSource).toBe("f247");
  });

  it("keeps pagination for the VOZ source only", async () => {
    makeFeed([]);
    await vi.waitFor(() => expect(host.querySelector("#feed-state")?.textContent).toBe("0 posts"));
    expect(host.querySelector<HTMLButtonElement>("#feed-next")?.disabled).toBe(true);
  });
});

describe("MarketHubView", () => {
  it("renders one clickable struct per module and numbers the gutter", () => {
    document.body.replaceChildren();
    const content = document.createElement("div");
    content.className = "game-code-content";
    content.innerHTML = `
      <div class="code-line comment">// header</div>
      <div class="code-line empty"></div>
      <div class="code-line">namespace X;</div>
      <div class="market-hub-list" id="market-hub-list"></div>`;
    const gutter = document.createElement("div");
    const chip = document.createElement("span");
    document.body.append(content, gutter, chip);

    const onOpen = vi.fn<(id: string) => void>();
    const hub = new MarketHubView(
      {
        list: content.querySelector<HTMLElement>("#market-hub-list")!,
        gutter,
        chip,
      },
      { onOpen },
    );
    hub.setModules(FEED_MODULES);

    const rows = content.querySelectorAll<HTMLButtonElement>(".module-row");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain("Quotes");
    expect(rows[0]?.textContent).toContain("F7");
    expect(rows[3]?.textContent).toContain("Feed");
    expect(chip.textContent).toBe("// modules: 4");
    expect(gutter.children.length).toBe(content.querySelectorAll(".code-line").length);

    rows[2]?.click();
    expect(onOpen).toHaveBeenCalledWith("chart");
  });
});
