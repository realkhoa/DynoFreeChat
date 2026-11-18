// @vitest-environment jsdom
/**
 * @file garden.spec.ts
 * @brief ASCII Garden document: tabs, plot interaction, market and visits.
 * @details The network is replaced by a fake API so these tests pin the DOM
 * contract: three tabs, nine clickable plots, the seed picker, owner actions and
 * the read-only visit mode.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CROPS_PER_TAB,
  EPOCH_MS,
  EVENT_WAVE_MS,
  FERTILIZERS,
  SEEDS,
  TREES,
  TREES_PER_TAB,
  seasonAt,
  type GardenAction,
  type GardenSnapshot,
  type PlotState,
  type SeasonSnapshot,
  type TreeState,
  type VisitSnapshot,
} from "@dyno/shared/garden";
import { createAsciiGardenGame } from "@/features/games/garden/game";
import type { GardenApi } from "@/features/games/garden/api";
import { setLocale } from "@/shared/i18n";
import { readParam } from "@/shared/lib/urlstate";

/** Virtual server time used by the fake API. */
const CLOCK = EPOCH_MS + 2 * EVENT_WAVE_MS + 60_000;

/** Season snapshot shared by the fake responses. */
const SEASON: SeasonSnapshot = seasonAt(CLOCK);

/** Player id used by the fake garden. */
const PLAYER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** A ripe golden carrot on plot 0. */
const RIPE_PLOT: PlotState = {
  slot: 0,
  seed: "carrot",
  plantedAt: CLOCK - 120_000,
  readyAt: CLOCK - 5_000,
  effects: ["golden", "wet"],
  watered: true,
  fertilized: true,
  harvests: 0,
  fertilizer: null,
  spray: null,
};

/** A fruiting apple tree on tree slot 9 (second page's first slot). */
const SECOND_PAGE_TREE: TreeState = {
  slot: 9,
  tree: "apple",
  plantedAt: CLOCK - 1_000,
  readyAt: CLOCK + 600_000,
  effects: [],
  watered: false,
  fertilized: false,
  harvests: 0,
  fertilizer: null,
  spray: null,
};

/** A growing tomato on plot 0. */
const GROWING_PLOT: PlotState = {
  slot: 0,
  seed: "tomato",
  plantedAt: CLOCK - 30_000,
  readyAt: CLOCK + 120_000,
  effects: [],
  watered: false,
  fertilized: false,
  harvests: 0,
  fertilizer: null,
  spray: null,
};

/** Builds one owner snapshot. */
function makeState(overrides: Partial<GardenSnapshot> = {}): GardenSnapshot {
  return {
    version: 1,
    playerId: PLAYER_ID,
    nick: "khoan",
    color: "hsl(200 60% 60%)",
    code: "ABCDEF",
    coins: 42,
    tabs: 1,
    unlockedPatches: [1],
    plots: new Array<PlotState | null>(CROPS_PER_TAB).fill(null),
    trees: new Array<TreeState | null>(TREES_PER_TAB).fill(null),
    bag: { seeds: { carrot: 3 }, crops: [], supplies: {} },
    stats: { planted: 0, harvested: 0, earned: 0 },
    rev: 7,
    updatedAt: CLOCK,
    ...overrides,
  };
}

/** Builds one public visit snapshot. */
function makeVisit(overrides: Partial<VisitSnapshot> = {}): VisitSnapshot {
  return {
    nick: "friend",
    color: "hsl(120 60% 60%)",
    code: "ABCDEF",
    coins: 12,
    tabs: 1,
    unlockedPatches: [1],
    plots: new Array<PlotState | null>(CROPS_PER_TAB).fill(null),
    trees: new Array<TreeState | null>(TREES_PER_TAB).fill(null),
    bag: { seeds: {}, crops: [], supplies: {} },
    stats: { planted: 1, harvested: 0, earned: 0 },
    updatedAt: CLOCK,
    lastSeen: CLOCK - 1_000,
    online: true,
    visitors: [],
    ...overrides,
  };
}

/** Stand-in for {@link GardenApi} with scripted responses. */
class FakeGardenApi {
  stateValue: GardenSnapshot;
  visitValue: VisitSnapshot = makeVisit();
  calls: Array<{ method: string; action?: GardenAction }> = [];
  session = { playerId: PLAYER_ID, token: "a".repeat(64), recovery: "ABCD-EFGH-JKMN" };

  constructor(stateValue: GardenSnapshot) {
    this.stateValue = stateValue;
  }

  hasSession(): boolean {
    return true;
  }

  now(): number {
    return CLOCK;
  }

  forget(): void {}

  async state() {
    return { state: this.stateValue, season: SEASON, serverNow: CLOCK };
  }

  async act(rev: number, action: GardenAction) {
    this.calls.push({ method: "act", action });
    this.stateValue = { ...this.stateValue, rev: rev + 1 };
    return { state: this.stateValue, season: SEASON, serverNow: CLOCK };
  }

  async rename(nick: string, color: string) {
    this.stateValue = { ...this.stateValue, nick, color };
    return { state: this.stateValue, season: SEASON, serverNow: CLOCK };
  }

  async register() {
    return this.bundle("b".repeat(64));
  }

  async restore(_key: string) {
    return this.bundle("c".repeat(64));
  }

  async rotateRecovery(): Promise<string> {
    return "NEW1-NEW2-NEW3";
  }

  async leaderboard() {
    return [];
  }

  async visit() {
    return { garden: this.visitValue, season: SEASON, serverNow: CLOCK };
  }

  async waterVisit(_code: string, slot: number) {
    this.calls.push({ method: "waterVisit" });
    this.visitValue = {
      ...this.visitValue,
      plots: this.visitValue.plots.map((plot, index) =>
        index === slot ? { ...plot!, readyAt: plot!.readyAt - 5_000 } : plot,
      ),
    };
    return { garden: this.visitValue, season: SEASON, serverNow: CLOCK };
  }

  async cheerVisit() {
    this.calls.push({ method: "cheerVisit" });
    return { garden: this.visitValue, season: SEASON, serverNow: CLOCK };
  }

  private bundle(token: string) {
    return {
      playerId: PLAYER_ID,
      token,
      recovery: "ABCD-EFGH-JKMN",
      state: this.stateValue,
      season: SEASON,
      serverNow: CLOCK,
    };
  }
}

/** Mounts one game and lets the initial async load settle. */
async function mountGame(api: FakeGardenApi, gardenCode?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const game = createAsciiGardenGame({ api: api as unknown as GardenApi });
  game.mount(host, gardenCode === undefined ? undefined : { gardenCode });
  await settle();
  return { host, game };
}

/** Resolves the queued promise chain of the fake API. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let mounted: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  window.history.replaceState(null, "", "/index.html");
  localStorage.clear();
  localStorage.setItem("dyno.identity", JSON.stringify({ nick: "khoan", color: "hsl(200 60% 60%)" }));
  setLocale("vi");
  document.body.replaceChildren();
  mounted = [];
});

afterEach(() => {
  for (const game of mounted) game.unmount();
  setLocale("vi");
  document.body.replaceChildren();
});

describe("garden tab", () => {
  it("renders three tabs, a 9x9 crop grid, three fruit patches and the HUD", async () => {
    const api = new FakeGardenApi(
      makeState({ plots: [RIPE_PLOT, ...new Array<PlotState | null>(CROPS_PER_TAB - 1).fill(null)] }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(host.querySelectorAll(".garden-tab")).toHaveLength(3);
    expect(host.querySelectorAll(".garden-cell")).toHaveLength(CROPS_PER_TAB + TREES_PER_TAB);
    expect(host.querySelectorAll(".garden-cell.is-ready")).toHaveLength(1);
    // The cell shows only the strongest mutation; the detail panel shows all.
    const readyCell = host.querySelector(".garden-cell.is-ready");
    expect(readyCell?.classList.contains("is-golden")).toBe(true);
    expect(readyCell?.classList.contains("is-wet")).toBe(true);
    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    const detail = host.querySelector(".garden-menu-info")?.textContent ?? "";
    expect(detail).toContain("Vàng x5");
    expect(detail).toContain("Ướt x2");
    expect(detail).toContain("x10");
    expect(host.querySelector(".stage-hud")?.textContent).toContain("coin");
    expect(host.querySelector(".garden-code")?.textContent).toBe("#ABCDEF");
  });

  it("opens the seed picker on an empty plot and plants a seed", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const cells = host.querySelectorAll<HTMLButtonElement>(".garden-cell");
    cells[1]?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="menuViewSeed"]')?.click();
    await settle();
    const seeds = host.querySelectorAll<HTMLButtonElement>('[data-act="menuSeed"]');
    expect(seeds).toHaveLength(SEEDS.length);

    seeds[0]?.click();
    await settle();
    const planted = api.calls.find((call) => call.action?.kind === "plant");
    expect(planted?.action).toMatchObject({ kind: "plant", slot: 1, seed: "carrot" });
  });

  it("shows the owner actions for a ripe crop and harvests it", async () => {
    const api = new FakeGardenApi(
      makeState({ plots: [RIPE_PLOT, ...new Array<PlotState | null>(CROPS_PER_TAB - 1).fill(null)] }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    const harvest = host.querySelector<HTMLButtonElement>('[data-act="harvest"]');
    expect(harvest).not.toBeNull();
    expect(harvest?.disabled).toBe(false);

    harvest?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "harvest")).toBe(true);
  });

  it("paginates bought tabs and offers the next one", async () => {
    const plots = new Array<PlotState | null>(CROPS_PER_TAB * 2).fill(null);
    plots[12] = { ...RIPE_PLOT, slot: 12 };
    const api = new FakeGardenApi(makeState({ tabs: 2, plots }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(host.querySelector(".garden-page")?.textContent).toContain("1/3");
    const next = host.querySelector<HTMLButtonElement>('[data-act="nextPage"]');
    next?.click();
    await settle();
    expect(host.querySelector(".garden-page")?.textContent).toContain("2/3");
    const secondPageCells = host.querySelectorAll<HTMLElement>(".garden-cell");
    expect(secondPageCells[0]?.dataset.slot).toBe(String(CROPS_PER_TAB));
    expect(secondPageCells[0]?.dataset.area).toBe("crop");

    host.querySelector<HTMLButtonElement>('[data-act="nextPage"]')?.click();
    await settle();
    // Third page is the not-yet-bought preview, with a disabled buy action.
    expect(host.querySelector(".garden-page")?.textContent).toContain("3/3");
    const buy = host.querySelector<HTMLButtonElement>('[data-act="buyTab"]');
    expect(buy).not.toBeNull();
    expect(buy?.disabled).toBe(true);
  });

  it("uproot needs two presses and confirms in the menu", async () => {
    const api = new FakeGardenApi(
      makeState({ plots: [RIPE_PLOT, ...new Array<PlotState | null>(CROPS_PER_TAB - 1).fill(null)] }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    const uproot = host.querySelector<HTMLButtonElement>('[data-act="uproot"]');
    expect(uproot).not.toBeNull();
    uproot?.click();
    await settle();
    // Still armed in the same menu, nothing sent yet.
    expect(api.calls.some((call) => call.action?.kind === "uproot")).toBe(false);
    const confirm = host.querySelector<HTMLButtonElement>('[data-act="uproot"]');
    expect(confirm?.textContent).toContain("Chắc chắn");
    confirm?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "uproot")).toBe(true);
  });

  it("flips the menu above a cell that sits near the bottom edge", async () => {
    const rect = (() => ({ top: 680, bottom: 710, left: 10, right: 110, width: 100, height: 100 }))();
    const menuRect = (() => ({ top: 0, bottom: 200, left: 0, right: 330, width: 330, height: 200 }))();
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function mock(this: HTMLElement) {
      return (this.classList.contains("garden-menu") ? menuRect : rect) as DOMRect;
    } as typeof original;
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    const menu = host.querySelector<HTMLElement>(".garden-menu");
    expect(menu).not.toBeNull();
    const top = Number.parseFloat(menu?.style.top ?? "0");
    // 680 - 200 (menu height) - 4 = 476px, fully inside the 768px viewport.
    expect(top).toBeLessThanOrEqual(560);
    expect(top).toBeGreaterThanOrEqual(8);
    HTMLElement.prototype.getBoundingClientRect = original;
  });

  it("plants a fruit tree from the tree board", async () => {
    const api = new FakeGardenApi(makeState({ coins: 500 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const treeCell = host.querySelector<HTMLButtonElement>('.garden-cell[data-area="tree"]');
    expect(treeCell?.dataset.area).toBe("tree");
    treeCell?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="menuViewTree"]')?.click();
    await settle();
    const rows = host.querySelectorAll<HTMLButtonElement>('[data-act="menuTree"]');
    expect(rows).toHaveLength(TREES.length);
    rows[0]?.click();
    await settle();
    const planted = api.calls.find((call) => call.action?.kind === "plantTree");
    expect(planted?.action).toMatchObject({ kind: "plantTree", slot: 0, tree: "apple" });
  });

  it("opens the fertilizer picker and applies an owned supply", async () => {
    const api = new FakeGardenApi(
      makeState({
        plots: [GROWING_PLOT, ...new Array<PlotState | null>(CROPS_PER_TAB - 1).fill(null)],
        bag: { seeds: { carrot: 3 }, crops: [], supplies: { compost: 2 } },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="menuViewFertilize"]')?.click();
    await settle();
    const rows = host.querySelectorAll<HTMLButtonElement>('[data-act="menuUseFertilize"]');
    expect(rows).toHaveLength(FERTILIZERS.length);

    host.querySelector<HTMLButtonElement>('[data-act="menuUseFertilize"][data-supply="compost"]')?.click();
    await settle();
    const applied = api.calls.find((call) => call.action?.kind === "fertilize");
    expect(applied?.action).toMatchObject({ kind: "fertilize", supply: "compost" });
  });

  it("offers to open the next locked 3x3 patch", async () => {
    const api = new FakeGardenApi(makeState({ coins: 1_000 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    // Slot 9 is the first cell of the second crop patch, locked by default.
    host.querySelector<HTMLButtonElement>('.garden-cell[data-area="crop"][data-slot="20"]')?.click();
    await settle();
    const buy = host.querySelector<HTMLButtonElement>('[data-act="menuBuyPatch"]');
    expect(buy).not.toBeNull();
    buy?.click();
    await settle();
    const bought = api.calls.find((call) => call.action?.kind === "buyPatch");
    expect(bought?.action).toMatchObject({ kind: "buyPatch", tab: 0 });
  });

  it("restores the saved tab, page and selection from the URL", async () => {
    window.history.replaceState(null, "", "/index.html?gtab=garden&gpage=1&garea=tree&gslot=36");
    const trees = new Array<TreeState | null>(TREES_PER_TAB * 2).fill(null);
    trees[36] = { ...SECOND_PAGE_TREE, slot: 36 };
    const api = new FakeGardenApi(makeState({ tabs: 2, trees }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(host.querySelector(".garden-page")?.textContent).toContain("2/3");
    const selected = host.querySelector<HTMLElement>(".garden-cell.is-selected");
    expect(selected?.dataset.area).toBe("tree");
    expect(selected?.dataset.slot).toBe("36");
    expect(host.querySelector(".garden-menu-info")?.textContent).toContain("Táo");
  });

  it("mirrors tab and page changes into the URL", async () => {
    const api = new FakeGardenApi(makeState({ tabs: 2 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(readParam("gtab")).toBe("garden");
    host.querySelector<HTMLButtonElement>('[data-act="nextPage"]')?.click();
    await settle();
    expect(readParam("gpage")).toBe("1");

    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();
    expect(readParam("gtab")).toBe("market");
  });

  it("switches to English labels live", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);
    expect(host.querySelector(".stage-hud")?.textContent).toContain("coin");

    setLocale("en");
    await settle();
    expect(host.querySelector(".stage-hud")?.textContent).toContain("coins");
    expect(host.querySelector(".stage-status")?.textContent).toContain("1-9");
  });
});

describe("market tab", () => {
  it("lists the shop offers and buys one seed", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();
    const shopPanel = host.querySelectorAll<HTMLElement>(".garden-market-panel")[0];
    const rows = shopPanel?.querySelectorAll<HTMLButtonElement>(".garden-row") ?? [];
    expect(rows).toHaveLength(SEEDS.length);

    rows[0]?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "buySeed")).toBe(true);
  });
});

describe("visit mode", () => {
  it("opens read-only and lets the visitor water a crop", async () => {
    const api = new FakeGardenApi(makeState());
    api.visitValue = makeVisit({
      plots: [GROWING_PLOT, ...new Array<PlotState | null>(CROPS_PER_TAB - 1).fill(null)],
    });
    const { host, game } = await mountGame(api, "ABCDEF");
    mounted.push(game);

    expect(host.querySelector(".stage-status")?.textContent).toContain("Chế độ xem");
    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    const water = host.querySelector<HTMLButtonElement>('[data-act="waterFriend"]');
    expect(water).not.toBeNull();
    water?.click();
    await settle();
    expect(api.calls.some((call) => call.method === "waterVisit")).toBe(true);
  });

  it("returns to the owner garden", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api, "ABCDEF");
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="home"]')?.click();
    await settle();
    expect(host.querySelector(".garden-code")?.textContent).toBe("#ABCDEF");
    expect(host.querySelector(".stage-status")?.textContent).not.toContain("Chế độ xem");
  });
});
