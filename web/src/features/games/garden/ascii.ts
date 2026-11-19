/**
 * @file ascii.ts
 * @brief Fixed-width ASCII helpers for the garden document.
 * @details Every plot cell is ten columns wide, so the frame stays aligned in a
 * monospace font whatever glyph or translated label it carries. Width is
 * measured in code points, which keeps Vietnamese labels inside the frame.
 */

import {
  animalIntervalMs,
  animalIsIncubating,
  animalQuality,
  plotView,
  resolvedTreeEffects,
  strongestEffect,
  treeById,
  type AnimalId,
  type AnimalState,
  type PlotState,
  type TreeState,
} from "@dyno/shared/garden";
import { formatDuration, t } from "@/shared/i18n";

/** Columns of one plot cell, borders included. */
export const CELL_WIDTH = 10;

/** Columns between the two border characters of a cell. */
export const CELL_INNER = CELL_WIDTH - 2;

/** One rendered plot cell. */
export interface CellRender {
  /** Six fixed-width lines: top border, four content rows, bottom border. */
  readonly lines: string[];
  /** Ripe and blinking. */
  readonly ready: boolean;
  /** Planted and still growing. */
  readonly growing: boolean;
  /** Empty soil. */
  readonly empty: boolean;
  /** Not bought yet. */
  readonly locked: boolean;
  /** Growth progress in `0..1`. */
  readonly progress: number;
}

/** @brief Number of code points in a string. */
export function textWidth(text: string): number {
  return Array.from(text).length;
}

/**
 * @brief Fits one string into a fixed code-point width.
 * @param text Text to fit.
 * @param width Target width.
 * @param align Whether the text sits left or centred.
 */
export function fitText(text: string, width: number, align: "left" | "center" = "left"): string {
  const chars = Array.from(text);
  if (chars.length >= width) return chars.slice(0, width).join("");
  const padding = width - chars.length;
  if (align === "center") {
    const left = Math.floor(padding / 2);
    return `${" ".repeat(left)}${chars.join("")}${" ".repeat(padding - left)}`;
  }
  return `${chars.join("")}${" ".repeat(padding)}`;
}

/**
 * @brief Builds one `label   value` detail line.
 * @param label Left label.
 * @param value Right value.
 * @param width Label column width.
 */
export function labelValue(label: string, value: string, width = 12): string {
  return `${fitText(label, width)}${value}`;
}

/** @brief One framed cell content row. */
function row(text: string, align: "left" | "center" = "left"): string {
  return `|${fitText(text, CELL_INNER, align)}|`;
}

/**
 * @brief One cell border, optionally carrying the one-based plot number.
 * @param slot Zero-based plot index; omitted for the bottom border.
 */
function border(slot?: number): string {
  if (slot === undefined) return `+${"-".repeat(CELL_INNER)}+`;
  const label = String(slot + 1);
  const dashes = Math.max(0, CELL_INNER - label.length);
  return `+${"-".repeat(dashes)}${label}+`;
}

/**
 * @brief Renders one plot cell.
 * @param plot Plot state, or `null` for empty soil.
 * @param now Server-clock time.
 * @param lockedCost Unlock price when the plot is locked, else `null`.
 */
export function cellRender(
  plot: PlotState | null,
  now: number,
  lockedCost: number | null,
  slot = 0,
): CellRender {
  const top = border(slot);
  const bottom = border();
  if (lockedCost !== null) {
    return {
      lines: [
        border(),
        row("#", "center"),
        row(t("garden.locked")),
        row(""),
        row(lockedCost > 0 ? `${lockedCost}c` : "--"),
        border(),
      ],
      ready: false,
      growing: false,
      empty: false,
      locked: true,
      progress: 0,
    };
  }

  if (plot === null) {
    return {
      lines: [top, row(".", "center"), row(t("garden.empty")), row(""), row("--"), bottom],
      ready: false,
      growing: false,
      empty: true,
      locked: false,
      progress: 0,
    };
  }

  const view = plotView(plot, now);
  const glyph = view.seed.art[view.stage] ?? ".";
  const name = t(`seeds.${view.seed.id}.short`);
  const strongest = strongestEffect(view.effects.map((effect) => effect.id));
  const effect = strongest === null ? "" : t(`effects.${strongest.id}`);
  const tail = view.ready ? t("garden.ready") : formatDuration(view.remainingMs, "short");
  return {
    lines: [top, row(glyph, "center"), row(name), row(effect), row(tail), bottom],
    ready: view.ready,
    growing: !view.ready,
    empty: false,
    locked: false,
    progress: view.progress,
  };
}

/**
 * @brief Renders one fruit tree cell.
 * @param tree Tree state, or `null` for an empty slot.
 * @param now Server-clock time.
 * @param lockedCost Unlock price when the whole patch is still a preview, else `null`.
 * @param slot Zero-based slot inside the page.
 */
export function treeCellRender(
  tree: TreeState | null,
  now: number,
  lockedCost: number | null,
  slot = 0,
): CellRender {
  const top = border(slot);
  const bottom = border();
  if (lockedCost !== null) {
    return {
      lines: [top, row("#", "center"), row(t("garden.locked")), row(""), row("--"), bottom],
      ready: false,
      growing: false,
      empty: false,
      locked: true,
      progress: 0,
    };
  }
  if (tree === null) {
    return {
      lines: [top, row(".", "center"), row(t("garden.empty")), row(""), row("--"), bottom],
      ready: false,
      growing: false,
      empty: true,
      locked: false,
      progress: 0,
    };
  }
  const definition = treeById(tree.tree);
  const glyph =
    definition?.art[
      now >= tree.readyAt
        ? 3
        : Math.min(
            2,
            Math.floor((Math.max(0, now - tree.plantedAt) / Math.max(1, tree.readyAt - tree.plantedAt)) * 3),
          )
    ] ?? ".";
  const total = Math.max(1, tree.readyAt - tree.plantedAt);
  const progress = Math.min(1, Math.max(0, now - tree.plantedAt) / total);
  const ready = now >= tree.readyAt;
  const treeStrongest = strongestEffect(resolvedTreeEffects(tree, now));
  const effect = treeStrongest === null ? null : t(`effects.${treeStrongest.id}`);
  const tail = ready ? t("garden.ready") : formatDuration(Math.max(0, tree.readyAt - now), "short");
  return {
    lines: [
      top,
      row(glyph, "center"),
      row(t(`trees.${tree.tree}.short`)),
      row(effect ?? ""),
      row(tail),
      bottom,
    ],
    ready,
    growing: !ready,
    empty: false,
    locked: false,
    progress,
  };
}

/** Glyph drawn for each animal species, one column wide on purpose. */
const ANIMAL_GLYPH: Readonly<Record<AnimalId, string>> = {
  chicken: "c",
  duck: "d",
  cow: "C",
  goat: "G",
  sheep: "S",
  fish: "f",
  snail: "s",
};

/** One rendered animal cell. */
export interface AnimalCellRender {
  /** Six fixed-width lines: top border, four content rows, bottom border. */
  readonly lines: string[];
  /** The next product is due: the cell blinks. */
  readonly ready: boolean;
  /** Empty building slot. */
  readonly empty: boolean;
  /** Quality stars of the living animal, `0` for an empty slot. */
  readonly stars: number;
  /** Milliseconds until the next product, `0` when it is due. */
  readonly remainingMs: number;
  /** The animal is sitting on a kept egg. */
  readonly breeding: boolean;
}

/**
 * @brief Renders one animal slot as a framed cell.
 * @param animal Living animal, or `null` for an empty slot.
 * @param now Server-clock time.
 * @param slot Zero-based slot inside the building; printed on the top border.
 * @details Uses the same ten-column frame as a crop plot so the farm reads as a
 * board of cells instead of a stack of buttons: glyph, species, quality stars
 * and the countdown to the next product.
 */
export function animalCellRender(animal: AnimalState | null, now: number, slot = 0): AnimalCellRender {
  const top = border(slot);
  const bottom = border();
  if (animal === null) {
    return {
      lines: [top, row(".", "center"), row(t("garden.empty")), row(""), row("--"), bottom],
      ready: false,
      empty: true,
      stars: 0,
      remainingMs: 0,
      breeding: false,
    };
  }
  const stars = animalQuality(animal, now);
  const breeding = animalIsIncubating(animal, now);
  const remainingMs = Math.max(0, animal.lastProduceAt + animalIntervalMs(animal.kind) - now);
  const ready = !breeding && remainingMs <= 0;
  const tail = breeding
    ? `${t("farm.incubatingShort")} ${formatDuration((animal.incubatingUntil ?? 0) - now, "short")}`
    : ready
      ? t("farm.due")
      : formatDuration(remainingMs, "short");
  return {
    lines: [
      top,
      row(ANIMAL_GLYPH[animal.kind], "center"),
      row(t(`animals.${animal.kind}`)),
      row("*".repeat(stars)),
      row(tail),
      bottom,
    ],
    ready,
    empty: false,
    stars,
    remainingMs,
    breeding,
  };
}

/** Start colour of a freshly planted crop. */
const GROWTH_FROM: readonly [number, number, number] = [238, 238, 238];

/** Colour of a ripe crop. */
const GROWTH_TO: readonly [number, number, number] = [110, 216, 172];

/**
 * @brief Interpolates the "white to green" growth colour.
 * @param progress Growth progress in `0..1`.
 */
export function growthColor(progress: number): string {
  const clamped = Math.min(1, Math.max(0, progress));
  const mix = (from: number, to: number): number => Math.round(from + (to - from) * clamped);
  return `rgb(${mix(GROWTH_FROM[0], GROWTH_TO[0])} ${mix(GROWTH_FROM[1], GROWTH_TO[1])} ${mix(
    GROWTH_FROM[2],
    GROWTH_TO[2],
  )})`;
}
