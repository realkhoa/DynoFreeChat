/**
 * @file townhall.ts
 * @brief Rebuilt townhall: NPCs drawn as plot cells, each opening its own shop.
 * @details The townhall is data driven on purpose. An NPC is one plain object with
 * a name, a glyph, a palette tone and a `data-npc` id; a shop is a list of titled
 * sections of plain item objects. Adding a merchant means adding both in `game.ts`
 * plus its i18n labels — this module never grows a branch per NPC.
 */

import { buildRebornAction, type RebornAction } from "./reborn";

/** One NPC standing in the townhall. */
export interface TownNpc {
  /** Stable id; the click handler and shop lookup key off it. */
  readonly id: string;
  /** Full display name, wrapped inside the cell. */
  readonly name: string;
  /** One glyph shown above the name, matching the plot cells. */
  readonly glyph: string;
  /** Legacy palette tone (water, harvest, money, chemical, soil, …). */
  readonly tone: string;
  /** Short role line printed under the name. */
  readonly note: string;
}

/** One purchasable row inside a townhall shop. */
export interface TownShopItem {
  /** Stable id local to the shop, mirrored onto the cell for tests. */
  readonly id: string;
  /** Item name, wrapped inside the cell. */
  readonly name: string;
  /** One glyph shown above the name. */
  readonly glyph: string;
  /** Short price/stock line printed under the name. */
  readonly note: string;
  /** Legacy palette tone. */
  readonly tone: string;
  /** Full tooltip, since the cell only fits a short label. */
  readonly title: string;
  /** Legacy `data-act` the click delegates to, e.g. `buy`, `buySupply`. */
  readonly act: string;
  /** `data-*` payload the legacy buy handler reads. */
  readonly data: Readonly<Record<string, string>>;
  /** Whether the row can be bought right now. */
  readonly disabled?: boolean;
}

/** One titled block of shop items. */
export interface TownShopSection {
  /** Stable section id. */
  readonly id: string;
  /** Section heading shown above the grid. */
  readonly title: string;
  /** Items on sale, in display order. */
  readonly items: readonly TownShopItem[];
  /** Text shown instead of the grid when the section is empty. */
  readonly emptyHint: string;
}

/**
 * @brief Builds the NPC row: one plot cell per merchant.
 * @param npcs NPCs currently standing in town.
 * @param interactive Whether clicking opens a shop (owner) or is read-only (visit).
 * @return The NPC row element.
 */
export function buildTownNpcs(npcs: readonly TownNpc[], interactive: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "garden-town-npcs";
  for (const npc of npcs) {
    row.append(
      buildRebornAction({
        id: `npc:${npc.id}`,
        label: npc.name,
        glyph: npc.glyph,
        note: npc.note,
        tone: npc.tone,
        act: "townNpc",
        data: { npc: npc.id },
        title: `${npc.name} · ${npc.note}`,
        disabled: !interactive,
      }),
    );
  }
  return row;
}

/**
 * @brief Builds the open shop panel with one grid per section.
 * @param npc Merchant whose shop is open.
 * @param sections Shop stock, already resolved by the caller.
 * @param closeLabel Localized close button label.
 * @return The shop panel element.
 */
export function buildTownShop(
  npc: TownNpc,
  sections: readonly TownShopSection[],
  closeLabel: string,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "garden-town-shop";

  const head = document.createElement("div");
  head.className = "garden-town-shop-head";
  const title = document.createElement("span");
  title.className = "garden-line";
  title.textContent = `// ${npc.name} · ${npc.note}`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "stage-btn";
  close.textContent = `[ ${closeLabel} ]`;
  close.dataset.act = "townClose";
  head.append(title, close);
  panel.append(head);

  for (const section of sections) {
    const block = document.createElement("div");
    block.className = "garden-town-section";
    block.dataset.section = section.id;
    const heading = document.createElement("span");
    heading.className = "garden-board-title";
    heading.textContent = section.title;
    block.append(heading);
    if (section.items.length === 0) {
      const hint = document.createElement("span");
      hint.className = "garden-hint";
      hint.textContent = section.emptyHint;
      block.append(hint);
    } else {
      const grid = document.createElement("div");
      grid.className = "garden-town-grid";
      for (const item of section.items) {
        const cell: RebornAction = {
          id: item.id,
          label: item.name,
          glyph: item.glyph,
          note: item.note,
          tone: item.tone,
          act: item.act,
          data: item.data,
          title: item.title,
          disabled: item.disabled === true,
        };
        grid.append(buildRebornAction(cell));
      }
      block.append(grid);
    }
    panel.append(block);
  }
  return panel;
}
