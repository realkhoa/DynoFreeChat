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
import { CELL_INNER, cellRender, fitText, growthColor, lockedCellRender, type CellRender } from "./ascii";

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

/** One quick action on the rebuilt board. */
export interface RebornAction {
  /** Stable id, also mirrored onto the button for tests and diagnostics. */
  readonly id: string;
  /** Full label; the cell wraps it over at most two lines. */
  readonly label: string;
  /** One glyph shown above the label, matching the plot cells. */
  readonly glyph: string;
  /** Short live value printed under the label, e.g. `12·30c`. */
  readonly note: string;
  /** Legacy palette tone, painted like the old quick action buttons. */
  readonly tone?: string;
  /** Legacy `data-act` the click delegates to. */
  readonly act: string;
  /** Optional `data-kind` used by the picker handlers. */
  readonly kind?: string;
  /** Extra `data-*` payload for the click handler, e.g. `{ npc: "seeds" }`. */
  readonly data?: Readonly<Record<string, string>>;
  /** Full tooltip; defaults to `label · note`. */
  readonly title?: string;
  /** Whether the action is currently unavailable. */
  readonly disabled?: boolean;
  /** Whether the action's picker or tool is already open/active. */
  readonly active?: boolean;
}

/**
 * @brief Wraps a quick-action label into the two centred cell lines.
 * @param label Full label.
 * @param width Inner cell width in code points.
 * @return Exactly two padded lines, truncated when a word is too long.
 */
export function wrapCellLabel(label: string, width = CELL_INNER): string[] {
  const words = label.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === 2) break;
  }
  if (lines.length < 2) lines.push(current);
  return [0, 1].map((index) => fitText(lines[index] ?? "", width, "center"));
}

/**
 * @brief Renders one quick action as a plot-sized cell.
 * @param action Action data to paint.
 * @return The button, framed exactly like a plot cell.
 */
export function buildRebornAction(action: RebornAction): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "garden-cell garden-reborn-action";
  for (let index = 0; index < 6; index += 1) {
    const line = document.createElement("span");
    line.className = "garden-cell-line";
    button.append(line);
  }
  paintRebornAction(button, action);
  return button;
}

/**
 * @brief Repaints one action cell in place.
 * @param button Cell created by {@link buildRebornAction}.
 * @param action Fresh action data; also refreshes labels, tone, action and title.
 * @details Kept separate so per-second tickers can repaint a cell without
 * rebuilding the DOM (and without losing focus).
 */
export function paintRebornAction(button: HTMLButtonElement, action: RebornAction): void {
  for (const name of Array.from(button.classList)) {
    if (name.startsWith("tone-") || name === "is-active") button.classList.remove(name);
  }
  if (action.tone !== undefined) button.classList.add(`tone-${action.tone}`);
  button.dataset.act = action.act;
  button.dataset.actionId = action.id;
  if (action.kind === undefined) delete button.dataset.kind;
  else button.dataset.kind = action.kind;
  for (const key of Object.keys(action.data ?? {})) {
    const value = action.data?.[key];
    if (value !== undefined) button.dataset[key] = value;
  }
  button.disabled = action.disabled === true;
  if (action.active === true) button.classList.add("is-active");
  button.title = action.title ?? (action.note.length > 0 ? `${action.label} · ${action.note}` : action.label);
  button.setAttribute("aria-label", button.title);
  const [first, second] = wrapCellLabel(action.label);
  const lines = [
    `+${"-".repeat(CELL_INNER)}+`,
    `|${fitText(action.glyph, CELL_INNER, "center")}|`,
    `|${first}|`,
    `|${second}|`,
    `|${fitText(action.note, CELL_INNER)}|`,
    `+${"-".repeat(CELL_INNER)}+`,
  ];
  for (let index = 0; index < lines.length; index += 1) {
    const line = button.children.item(index);
    if (line instanceof HTMLElement) line.textContent = lines[index] ?? "";
  }
}

/**
 * @brief Builds the quick action columns beside the VIP board.
 * @param columns Action groups; one vertical column and separator each.
 * @return The columns container.
 */
export function buildRebornActionColumns(columns: readonly (readonly RebornAction[])[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "garden-reborn-actions";
  columns.forEach((column, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "garden-reborn-sep";
      separator.setAttribute("aria-hidden", "true");
      wrap.append(separator);
    }
    const group = document.createElement("div");
    group.className = "garden-reborn-action-col";
    for (const action of column) group.append(buildRebornAction(action));
    wrap.append(group);
  });
  return wrap;
}
