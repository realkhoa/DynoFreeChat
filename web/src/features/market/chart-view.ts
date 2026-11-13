/**
 * @file chart-view.ts
 * @brief Candle chart document: a Canvas chart dressed as a C# file.
 * @details The drawing is plain Canvas 2D — no chart dependency. Only the last
 * visible bars are scaled, so a 180-day daily series and a 5-day intraday series
 * both fit. The view polls while the document tab is visible.
 */

import type { Candle } from "@dyno/shared/market";
import { formatTime } from "@/shared/lib/format";
import type { MarketClient } from "./board";

/** Bars the chart keeps on screen; older candles are dropped before scaling. */
export const MAX_BARS = 90;

/** Poll interval while the chart document is visible. */
export const CHART_POLL_MS = 30_000;

/** Resolutions offered by the toolbar. */
export const RESOLUTIONS = ["1", "5", "15", "1D"] as const;

/** DOM hosts the chart paints into. */
export interface ChartElements {
  panel: HTMLElement;
  canvas: HTMLCanvasElement;
  symbol: HTMLInputElement;
  resolutions: HTMLElement;
  openButton: HTMLButtonElement;
  state: HTMLElement;
  clock: HTMLElement;
}

/** Scaled view of the visible candles. */
export interface ChartModel {
  /** Visible candles, oldest first. */
  candles: Candle[];
  /** Lowest low in the window. */
  min: number;
  /** Highest high in the window. */
  max: number;
  /** Largest volume in the window. */
  maxVolume: number;
}

/**
 * @brief Scales the visible window of a candle series.
 * @param candles Full series, oldest first.
 * @param maxBars Bars to keep, defaults to {@link MAX_BARS}.
 * @return The scaled model; empty series produce an empty model.
 */
export function buildChartModel(candles: Candle[], maxBars = MAX_BARS): ChartModel {
  const visible = candles.slice(-maxBars);
  if (visible.length === 0) return { candles: [], min: 0, max: 0, maxVolume: 0 };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let maxVolume = 0;
  for (const candle of visible) {
    min = Math.min(min, candle.low);
    max = Math.max(max, candle.high);
    maxVolume = Math.max(maxVolume, candle.volume);
  }
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  return { candles: visible, min, max, maxVolume };
}

/**
 * @brief Draws the model into a 2D context.
 * @param ctx Canvas context, or `null` when the browser has none.
 * @param model Scaled candle window.
 * @param width CSS pixels.
 * @param height CSS pixels.
 */
export function drawChart(
  ctx: CanvasRenderingContext2D | null,
  model: ChartModel,
  width: number,
  height: number,
): void {
  if (ctx === null || width < 40 || height < 40) return;

  const padLeft = 12;
  const padRight = 64;
  const padTop = 14;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const totalHeight = height - padTop - padBottom;
  const priceHeight = Math.floor(totalHeight * 0.72);
  const volumeTop = padTop + priceHeight + 10;
  const volumeHeight = totalHeight - priceHeight - 10;

  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, width, height);

  const { candles, min, max, maxVolume } = model;
  if (candles.length === 0) {
    ctx.fillStyle = "#777777";
    ctx.font = "12px Consolas, monospace";
    ctx.fillText("// no candle telemetry received yet", padLeft + 8, padTop + 18);
    return;
  }

  const priceSpan = max - min;
  const priceToY = (price: number): number =>
    padTop + priceHeight - ((price - min) / priceSpan) * priceHeight;

  // Horizontal grid with price labels on the right.
  ctx.font = "10px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let step = 0; step <= 4; step += 1) {
    const y = padTop + (priceHeight / 4) * step;
    ctx.strokeStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotWidth, y);
    ctx.stroke();

    const price = max - (priceSpan / 4) * step;
    ctx.fillStyle = "#858585";
    ctx.fillText(price.toFixed(2), padLeft + plotWidth + 6, y);
  }

  const slot = plotWidth / candles.length;
  const bodyWidth = Math.max(2, Math.min(9, slot * 0.62));

  candles.forEach((candle, index) => {
    const centerX = padLeft + slot * (index + 0.5);
    const rising = candle.close >= candle.open;
    ctx.strokeStyle = rising ? "#4ec9b0" : "#f48771";
    ctx.fillStyle = rising ? "#4ec9b0" : "#f48771";

    ctx.beginPath();
    ctx.moveTo(centerX, priceToY(candle.high));
    ctx.lineTo(centerX, priceToY(candle.low));
    ctx.stroke();

    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);
    const top = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
    ctx.fillRect(centerX - bodyWidth / 2, top, bodyWidth, bodyHeight);

    const volumeBar = maxVolume > 0 ? (candle.volume / maxVolume) * volumeHeight : 0;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(centerX - bodyWidth / 2, volumeTop + volumeHeight - volumeBar, bodyWidth, volumeBar);
    ctx.globalAlpha = 1;
  });

  // Last close marker.
  const last = candles[candles.length - 1];
  if (last !== undefined) {
    const y = priceToY(last.close);
    ctx.strokeStyle = "#dcdcaa";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#dcdcaa";
    ctx.fillText(last.close.toFixed(2), padLeft + plotWidth + 6, y);
  }

  ctx.fillStyle = "#6a9955";
  ctx.textAlign = "left";
  ctx.fillText(`// ${candles.length} bars`, padLeft + 4, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(formatTime(last?.time ?? Date.now()), width - padRight, height - 8);
}

/**
 * @brief Owns the chart document: symbol box, resolution row, canvas and poll.
 */
export class ChartView {
  private symbol = "FPT";
  private resolution: string = "1D";
  private candles: Candle[] = [];
  private timer: number | null = null;
  private inFlight = false;

  /**
   * @param elements DOM hosts.
   * @param client Market proxy client.
   */
  constructor(
    private readonly elements: ChartElements,
    private readonly client: MarketClient,
  ) {
    this.elements.openButton.addEventListener("click", () => this.commitSymbol());
    this.elements.symbol.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.commitSymbol();
    });
    this.elements.resolutions.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("[data-resolution]");
      const resolution = button?.dataset.resolution;
      if (resolution !== undefined) this.setResolution(resolution);
    });
  }

  /** Symbol currently charted. */
  get currentSymbol(): string {
    return this.symbol;
  }

  /** Resolution currently charted. */
  get currentResolution(): string {
    return this.resolution;
  }

  /** Candles currently drawn. */
  get currentCandles(): Candle[] {
    return [...this.candles];
  }

  /**
   * @brief Starts the document: first load, resize handling and polling.
   */
  start(): void {
    this.paintResolutionRow();
    this.elements.symbol.value = this.symbol;
    void this.load();
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), CHART_POLL_MS);
    window.addEventListener("resize", this.onResize);
  }

  /** @brief Stops polling and drops the resize listener. */
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("resize", this.onResize);
  }

  /**
   * @brief Changes the charted symbol.
   * @param raw Text from the symbol box.
   */
  setSymbol(raw: string): void {
    const symbol = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
      this.elements.state.textContent = "Bad symbol";
      return;
    }
    this.symbol = symbol;
    this.elements.symbol.value = symbol;
    void this.load();
  }

  /**
   * @brief Changes the resolution.
   * @param resolution One of {@link RESOLUTIONS}.
   */
  setResolution(resolution: string): void {
    if (!(RESOLUTIONS as readonly string[]).includes(resolution)) return;
    this.resolution = resolution;
    this.paintResolutionRow();
    void this.load();
  }

  /**
   * @brief Fetches the candle series and repaints.
   * @return Resolves when the repaint is done; never rejects.
   */
  async refresh(): Promise<void> {
    return this.load();
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
    void this.load();
  }

  /** @brief Repaints when the window changes size. */
  private readonly onResize = (): void => {
    this.paint();
  };

  /** @brief Loads one candle series and paints it. */
  private async load(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.elements.state.textContent = "Loading";

    try {
      const payload = await this.client.chart(this.symbol, this.resolution);
      this.candles = payload.candles;
      this.elements.clock.textContent = formatTime(payload.ts);
      this.elements.state.textContent = `${payload.candles.length} bars`;
      this.paint();
    } catch {
      this.elements.state.textContent = "Offline";
      this.paint();
    } finally {
      this.inFlight = false;
    }
  }

  /** @brief Repaints the resolution row's active state. */
  private paintResolutionRow(): void {
    for (const button of this.elements.resolutions.querySelectorAll<HTMLButtonElement>("[data-resolution]")) {
      button.classList.toggle("is-active", button.dataset.resolution === this.resolution);
    }
  }

  /** @brief Paints the canvas at the current size. */
  private paint(): void {
    const canvas = this.elements.canvas;
    const width = this.elements.panel.clientWidth || canvas.clientWidth || 640;
    const height = Math.max(220, canvas.parentElement?.clientHeight || 320);
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawChart(ctx, buildChartModel(this.candles), width, height);
  }
}
