/**
 * @file reborn.ts
 * @brief Rebuilt garden UI: the 27 premium plots drawn as ordinary soil plots.
 * @details Every plot uses the same six-line frame and the same fixed width as a
 * normal garden cell, so the VIP board reads as one more patch of soil instead of
 * a separate screen. Unbought plots reuse the normal locked cell; only the next
 * plot in the sequence shows its price and can be bought.
 */

import type { PlotState } from "@dyno/shared/garden";
import { formatCompact, t } from "@/shared/i18n";
import { cellRender, growthColor, lockedCellRender, type CellRender } from "./ascii";

/** One plot on the rebuilt VIP board. */
export interface RebornPlot {
  /** Zero-based slot in the 27-plot sequence. */
  readonly slot: number;
  /** Whether the plot is already bought. */
  readonly owned: boolean;
  /** Whether this is the next plot the owner can buy. */
  readonly buyable: boolean;
  /** Planted crop, or `null` for empty or unbought soil. */
  readonly plot: PlotState | null;
  /** Price of this plot, used when it is the next one for sale. */
  readonly price: number;
}

/**
 * @brief Renders one rebuilt plot in the normal six-line plot frame.
 * @param plot Plot data for the reborn board.
 * @param now Server-clock time.
 * @return The framed cell, flagged locked/empty/ready/growing.
 */
export function rebornPlotRender(plot: RebornPlot, now: number): CellRender {
  if (!plot.owned) {
    const price = plot.buyable ? `${formatCompact(plot.price)}c` : null;
    return lockedCellRender(price, plot.slot);
  }
  return cellRender(plot.plot, now, null, plot.slot);
}

/**
 * @brief Paints one rebuilt plot cell from its plot data.
 * @param cell Button owning the six cell lines.
 * @param plot Plot data for this cell.
 * @param now Server-clock time.
 * @details Also owns the click contract so both the initial render and the tick
 * repaint keep the same action, title and disabled state.
 */
export function paintRebornCell(cell: HTMLButtonElement, plot: RebornPlot, now: number): void {
  const render = rebornPlotRender(plot, now);
  for (let index = 0; index < render.lines.length; index += 1) {
    const line = cell.children.item(index);
    if (line instanceof HTMLElement) line.textContent = render.lines[index] ?? "";
  }
  cell.classList.toggle("is-locked", render.locked);
  cell.classList.toggle("is-empty", render.empty);
  cell.classList.toggle("is-ready", render.ready);
  cell.classList.toggle("is-growing", render.growing);
  cell.classList.toggle("is-buyable", plot.buyable);
  cell.classList.remove("is-pest", "is-diseased");
  cell.style.color = render.growing ? growthColor(render.progress) : "";
  if (!plot.owned) {
    if (plot.buyable) {
      cell.disabled = false;
      cell.dataset.act = "buySpecialPlot";
      cell.title = t("special.buyPlot", { cost: `${formatCompact(plot.price)}c` });
    } else {
      cell.disabled = true;
      cell.dataset.act = "specialNoop";
      cell.title = t("special.locked");
    }
    return;
  }
  cell.disabled = false;
  cell.dataset.act = "specialPlot";
  cell.title =
    plot.plot === null
      ? t("special.empty")
      : now >= plot.plot.readyAt
        ? t("special.ready")
        : t("special.growing");
  if (plot.plot !== null) {
    cell.classList.toggle("is-pest", plot.plot.pest === true);
    cell.classList.toggle("is-diseased", plot.plot.diseasedAt !== undefined);
  }
}

/**
 * @brief Builds the 27-plot VIP board.
 * @param plots Plot data in purchase order, nine per row.
 * @param now Server-clock time.
 * @return The board element; each cell is the same size as a normal plot cell.
 */
export function buildRebornBoard(plots: readonly RebornPlot[], now: number): HTMLElement {
  const board = document.createElement("div");
  board.className = "garden-reborn-board";
  for (const plot of plots) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "garden-cell garden-reborn-cell";
    cell.dataset.slot = String(plot.slot);
    for (let index = 0; index < 6; index += 1) {
      const line = document.createElement("span");
      line.className = "garden-cell-line";
      cell.append(line);
    }
    paintRebornCell(cell, plot, now);
    board.append(cell);
  }
  return board;
}
