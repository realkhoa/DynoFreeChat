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
  DEFAULT_SKILLS,
  CROPS_PER_TAB,
  EPOCH_MS,
  EVENT_WAVE_MS,
  FERTILIZERS,
  SEEDS,
  TREES,
  TREES_PER_TAB,
  seasonAt,
  type ExtrasSnapshot,
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
  pest: false,
  protectedUntil: 0,
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
  pest: false,
  protectedUntil: 0,
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
  pest: false,
  protectedUntil: 0,
};

/** Extras defaults for fixtures. */
const EXTRAS: ExtrasSnapshot = {
  streak: 1,
  lastStreakDay: 0,
  achievements: [],
  collection: [],
  greenhouse: 0,
  pet: 0,
  pets: {},
  equippedPet: null,
  lastHatch: "",
  staff: [],
  insuranceUntil: 0,
  spliceBonus: 0,
  wheelSpins: 0,
  wheelPity: 0,
  wheelLast: "",
  futures: [],
  contractClaims: [],
  merchantClaims: [],
  weekKey: 0,
  weekEarned: 0,
  weekHarvested: 0,
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
    stats: { planted: 0, harvested: 0, earned: 0, spent: 0, tax: 0 },
    buildings: { coop: 0, barn: 0, pond: 0 },
    animals: { coop: [], barn: [], pond: [] },
    farmSettledAt: CLOCK,
    pondGrowth: 0,
    shopStock: {},
    specialPatches: 0,
    specialUnlocked: [0, 0, 0],
    specialPlots: [],
    warehouse: { level: 0, machines: {} },
    soil: new Array<number>(CROPS_PER_TAB).fill(100),
    extras: EXTRAS,
    skills: DEFAULT_SKILLS,
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
    stats: { planted: 1, harvested: 0, earned: 0, spent: 0, tax: 0 },
    buildings: { coop: 0, barn: 0, pond: 0 },
    animals: { coop: [], barn: [], pond: [] },
    pondGrowth: 0,
    specialPatches: 0,
    specialUnlocked: [0, 0, 0],
    specialPlots: [],
    warehouse: { level: 0, machines: {} },
    soil: new Array<number>(CROPS_PER_TAB).fill(100),
    extras: EXTRAS,
    skills: DEFAULT_SKILLS,
    updatedAt: CLOCK,
    lastSeen: CLOCK - 1_000,
    online: true,
    visitors: [],
    ...overrides,
  };
}

/** Stand-in for {@link GardenApi} with scripted responses. */
/** Small market board fixture for the chart tab. */
const MARKET = {
  cycle: 5,
  nextCycleAt: CLOCK + 120_000,
  soldTarget: 8,
  offers: [],
  items: [
    { item: "carrot" as const, base: 9, multiplier: 1.5, previous: 1, price: 14, sold: 3 },
    { item: "tomato" as const, base: 28, multiplier: 0.5, previous: 1, price: 14, sold: 12 },
  ],
};

class FakeGardenApi {
  stateValue: GardenSnapshot;
  seasonValue = SEASON;
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
    return { state: this.stateValue, season: this.seasonValue, serverNow: CLOCK, market: MARKET };
  }

  async market() {
    return { market: MARKET, serverNow: CLOCK };
  }

  async bots() {
    this.calls.push({ method: "bots" });
    return {
      bots: [
        {
          code: "BOT123",
          nick: "Bot 01",
          color: "#4ec9b0",
          coins: 500,
          earned: 500,
          harvested: 3,
          online: true,
        },
      ],
    };
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
    this.calls.push({ method: "leaderboard" });
    return [
      {
        code: "ABCDEF",
        nick: "Tester",
        color: "#4ec9b0",
        earned: 1_000,
        harvested: 12,
        coins: 700,
        spent: 500,
        updatedAt: CLOCK,
      },
    ];
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

    expect(host.querySelectorAll(".garden-tab")).toHaveLength(10);
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
    // The balance lives in its own bright chip, not buried in the comment HUD.
    expect(host.querySelector(".garden-balance")?.textContent).toContain("42c");
    expect(host.querySelector(".stage-hud")?.textContent).not.toContain("coin");
    expect(host.querySelector(".garden-code")?.textContent).toBe("#ABCDEF");
  });

  it("shows the bag, upgrades and field status in the right rail", async () => {
    const guarded: PlotState = { ...RIPE_PLOT, readyAt: CLOCK + 60_000, protectedUntil: CLOCK + 120_000 };
    const api = new FakeGardenApi(
      makeState({
        coins: 1_000,
        plots: [guarded, { ...guarded, slot: 1 }],
        buildings: { coop: 1, barn: 0, pond: 0 },
        bag: {
          seeds: { carrot: 3 },
          crops: [{ item: "carrot", effects: [], qty: 2 }],
          supplies: { compost: 1 },
          tools: { shovel: 1 },
          products: [{ product: "egg", star: 1, qty: 4 }],
        },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const side = host.querySelector(".garden-side");
    expect(side).not.toBeNull();
    const text = side?.textContent ?? "";
    expect(text).toContain("Túi đồ");
    expect(text).toContain("Nâng cấp");
    expect(text).toContain("Trạng thái");
    // Bag totals: 3 seeds in 1 kind, 2 harvested, 1 supply, 1 tool, 4 eggs.
    expect(text).toContain("3 · 1 loại");
    // The whole field is under pesticide cover, with a live countdown.
    expect(text).toContain("Thuốc sâu");
    expect(text).toContain("cả vườn");
    expect(host.querySelector(".garden-side-time")?.textContent).toMatch(/m|s/);
  });

  it("shows huge stacked multipliers without a cap", async () => {
    const wild = ["diamond", "diamond", "diamond", "cosmic", "cosmic", "cosmic", "plasma", "plasma"] as const;
    const api = new FakeGardenApi(makeState({ plots: [{ ...RIPE_PLOT, effects: [...wild] }] }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    const info = host.querySelector(".garden-menu-info")?.textContent ?? "";
    expect(info).toContain("= x18289152");
    expect(info).not.toContain("giới hạn");
  });

  it("shows stacked mutations and their combined multiplier", async () => {
    const api = new FakeGardenApi(makeState({ plots: [{ ...RIPE_PLOT, effects: ["diamond", "diamond"] }] }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    const info = host.querySelector(".garden-menu-info")?.textContent ?? "";
    expect(info).toContain("Kim cương ×2");
    expect(info).toContain("x81");
    const cell = host.querySelectorAll(".garden-cell")[0];
    expect(cell?.classList.contains("is-diamond")).toBe(true);
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
    // Only seeds already in the bag are offered for planting.
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.dataset.seed).toBe("carrot");

    seeds[0]?.click();
    await settle();
    const planted = api.calls.find((call) => call.action?.kind === "plant");
    expect(planted?.action).toMatchObject({ kind: "plant", slot: 1, seed: "carrot" });
  });

  it("opens the special garden patch and plants in it", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 50_000_000_000,
        specialPatches: 1,
        specialUnlocked: [1, 0, 0],
        specialPlots: [null],
        bag: { seeds: { carrot: 2 }, crops: [], supplies: {} },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const board = host.querySelector(".garden-special");
    expect(board?.textContent).toContain("Vườn đặc biệt");
    // Patch 2 is still for sale.
    expect(host.querySelector('[data-act="buySpecialPatch"][data-patch="1"]')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('.garden-special-cell[data-slot="0"]')?.click();
    await settle();
    const seed = host.querySelector<HTMLButtonElement>('[data-act="specialSeed"]');
    expect(seed).not.toBeNull();
    seed?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "plantSpecial")?.action).toMatchObject({
      kind: "plantSpecial",
      slot: 0,
      seed: "carrot",
    });

    // A locked plot in the owned patch costs a billion.
    host.querySelector<HTMLButtonElement>('.garden-special-cell[data-slot="1"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "buySpecialPlot")?.action).toMatchObject({
      kind: "buySpecialPlot",
      patch: 0,
    });
  });

  it("tints the bulk water and harvest buttons", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const water = host.querySelector<HTMLButtonElement>('[data-act="waterAll"]');
    const harvest = host.querySelector<HTMLButtonElement>('[data-act="harvestAll"]');
    expect(water?.classList.contains("garden-btn-water")).toBe(true);
    expect(harvest?.classList.contains("garden-btn-harvest")).toBe(true);
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

    // A preview cell explains the locked tab instead of opening a menu silently.
    host.querySelector<HTMLButtonElement>('.garden-cell[data-area="crop"]')?.click();
    await settle();
    expect(host.querySelector(".stage-status")?.textContent).toContain("chưa mở");
  });

  it("sells rare tools only when the restock carries them", async () => {
    const api = new FakeGardenApi(makeState({ coins: 2_000_000 }));
    api.seasonValue = {
      ...SEASON,
      shop: { ...SEASON.shop, tools: [{ tool: "autoWater", price: 1_000_000, stock: 1 }] },
    };
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();
    const row = host.querySelector<HTMLButtonElement>('[data-act="buyTool"]');
    expect(row?.getAttribute("title")).toContain("Máy tưới tự động");
    row?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "buyTool")).toBe(true);
  });

  it("sprays pesticides on one plant or the whole field", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 5_000,
        plots: [{ ...RIPE_PLOT, pest: true }, ...new Array<PlotState | null>(CROPS_PER_TAB - 1).fill(null)],
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="sprayPest"]')?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "sprayPest")).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-act="sprayPestAll"]')?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "sprayPestAll")).toBe(true);
  });

  it("hides re-spray actions while the field is still protected", async () => {
    const covered = { ...RIPE_PLOT, protectedUntil: CLOCK + 60_000 };
    const api = new FakeGardenApi(
      makeState({
        coins: 5_000,
        plots: [covered, { ...covered, slot: 1 }],
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    // Whole field covered: neither the per-plant row nor the bulk button shows.
    expect(host.querySelector('[data-act="sprayPestAll"]')).toBeNull();
    host.querySelectorAll<HTMLButtonElement>(".garden-cell")[0]?.click();
    await settle();
    expect(host.querySelector('[data-act="sprayPest"]')).toBeNull();
  });

  it("offers the bulk spray once some cover lapses", async () => {
    const covered = { ...RIPE_PLOT, protectedUntil: CLOCK + 60_000 };
    const lapsed = { ...RIPE_PLOT, slot: 1, protectedUntil: 0 };
    const api = new FakeGardenApi(makeState({ coins: 5_000, plots: [covered, lapsed] }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const bulk = host.querySelector<HTMLButtonElement>('[data-act="sprayPestAll"]');
    expect(bulk).not.toBeNull();
    expect(bulk?.textContent).toContain("1");
  });

  it("shows soil fertility and renovates the whole field", async () => {
    const soil = new Array<number>(CROPS_PER_TAB).fill(100);
    soil[0] = 50;
    const api = new FakeGardenApi(makeState({ coins: 1_000, soil }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const renovate = host.querySelector<HTMLButtonElement>('[data-act="renovateSoil"]');
    expect(renovate?.textContent).toContain("100c");
    renovate?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "renovateSoil")).toBe(true);
  });

  it("starts in stealth mode and remembers when toggled off", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);
    const root = host.querySelector<HTMLElement>("[data-stealth]");
    expect(root?.dataset.stealth).toBe("on");
    host.querySelector<HTMLButtonElement>('[data-act="toggleStealth"]')?.click();
    await settle();
    expect(host.querySelector<HTMLElement>("[data-stealth]")?.dataset.stealth).toBe("off");
    expect(localStorage.getItem("dyno.garden.stealth")).toBe("0");
  });

  it("offers bulk water and harvest with per-plant prices", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 100,
        plots: [RIPE_PLOT, GROWING_PLOT, ...new Array<PlotState | null>(CROPS_PER_TAB - 2).fill(null)],
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const water = host.querySelector<HTMLButtonElement>('[data-act="waterAll"]');
    const harvest = host.querySelector<HTMLButtonElement>('[data-act="harvestAll"]');
    expect(water?.textContent).toContain("5c");
    expect(harvest?.textContent).toContain("20c");

    water?.click();
    await settle();
    // The action re-renders the tab, so re-query the second button.
    host.querySelector<HTMLButtonElement>('[data-act="harvestAll"]')?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "waterAll")).toBe(true);
    expect(api.calls.some((call) => call.action?.kind === "harvestAll")).toBe(true);
  });

  it("waters plants quickly and skips ones that do not need it", async () => {
    const api = new FakeGardenApi(
      makeState({
        plots: [
          GROWING_PLOT,
          { ...GROWING_PLOT, slot: 1, watered: true },
          { ...RIPE_PLOT, slot: 2 },
          ...new Array<PlotState | null>(CROPS_PER_TAB - 3).fill(null),
        ],
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="quickWater"]')?.click();
    await settle();
    expect(host.querySelector(".garden-tool-active")?.textContent).toContain("tưới nhanh");

    host.querySelectorAll<HTMLButtonElement>('.garden-cell[data-area="crop"]')[0]?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "water")).toBe(true);

    const before = api.calls.length;
    host.querySelectorAll<HTMLButtonElement>('.garden-cell[data-area="crop"]')[2]?.click();
    await settle();
    expect(host.querySelector(".stage-status")?.textContent).toContain("đã tưới hoặc đã chín");
    expect(api.calls.length).toBe(before);
  });

  it("plants many empty cells with the quick-plant tool", async () => {
    const api = new FakeGardenApi(makeState({ bag: { seeds: { carrot: 3 }, crops: [], supplies: {} } }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="pickPlantTool"]')?.click();
    await settle();
    expect(host.querySelectorAll('[data-act="pickPlantSeed"]')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[data-act="pickPlantSeed"][data-seed="carrot"]')?.click();
    await settle();
    expect(host.querySelector(".garden-tool-active")?.textContent).toContain("Cà rốt");

    host.querySelectorAll<HTMLButtonElement>('.garden-cell[data-area="crop"]')[0]?.click();
    await settle();
    host.querySelectorAll<HTMLButtonElement>('.garden-cell[data-area="crop"]')[2]?.click();
    await settle();
    const plants = api.calls.filter((call) => call.action?.kind === "plant");
    expect(plants).toHaveLength(2);
    expect(plants[0]?.action).toMatchObject({ kind: "plant", seed: "carrot" });
    expect(host.querySelector(".garden-menu")).toBeNull();
  });

  it("uses a picked supply on many plants with plain clicks", async () => {
    const api = new FakeGardenApi(
      makeState({
        plots: [
          GROWING_PLOT,
          { ...GROWING_PLOT, slot: 1 },
          ...new Array<PlotState | null>(CROPS_PER_TAB - 2).fill(null),
        ],
        bag: { seeds: { carrot: 3 }, crops: [], supplies: { compost: 3 } },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="pickTool"][data-kind="fertilize"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="pickToolSupply"][data-supply="compost"]')?.click();
    await settle();
    expect(host.querySelector(".garden-tool-active")?.textContent).toContain("Phân hữu cơ");

    host.querySelectorAll<HTMLButtonElement>('.garden-cell[data-area="crop"]')[0]?.click();
    await settle();
    expect(host.querySelector(".garden-menu")).toBeNull();
    host.querySelectorAll<HTMLButtonElement>('.garden-cell[data-area="crop"]')[1]?.click();
    await settle();

    const uses = api.calls.filter((call) => call.action?.kind === "fertilize");
    expect(uses).toHaveLength(2);
    expect(uses[0]?.action).toMatchObject({ kind: "fertilize", slot: 0, supply: "compost" });
    expect(uses[1]?.action).toMatchObject({ kind: "fertilize", slot: 1, supply: "compost" });
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

  it("opens locked patches on the second tab", async () => {
    const api = new FakeGardenApi(makeState({ tabs: 2, unlockedPatches: [1, 1], coins: 1_000_000 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="nextPage"]')?.click();
    await settle();
    expect(host.querySelector(".garden-page")?.textContent).toContain("2/3");
    // Slot 81 is the first cell of tab 2, patch 2 is locked there.
    host.querySelector<HTMLButtonElement>('.garden-cell[data-area="crop"][data-slot="90"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="menuBuyPatch"]')?.click();
    await settle();
    const bought = api.calls.find((call) => call.action?.kind === "buyPatch");
    expect(bought?.action).toMatchObject({ kind: "buyPatch", tab: 1 });
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
    // First bought patch costs 5,000 x 2^0 = 5.000c.
    expect(buy?.textContent).toContain("5.000c");
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
    expect(host.querySelector(".garden-balance")?.textContent).toContain("$");

    setLocale("en");
    await settle();
    expect(host.querySelector(".garden-balance")?.textContent).toContain("$");
    expect(host.querySelector(".stage-status")?.textContent).toContain("Click");
  });
});

describe("rank tab", () => {
  it("shows coins, lifetime earnings and ROI for every player", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:rank"]')?.click();
    await settle();
    const row = host.querySelector(".garden-rank-row:not(.is-head)");
    expect(row?.textContent).toContain("Tester");
    expect(row?.textContent).toContain("700c");
    expect(row?.textContent).toContain("1.000c");
    expect(row?.textContent).toContain("+100%");
    expect(row?.textContent).toContain("12");
  });
});

describe("farm tab", () => {
  /** One hen with two pats, born an hour ago. */
  const hen = {
    kind: "chicken" as const,
    bornAt: CLOCK - 3_600_000,
    pats: 2,
    lastProduceAt: CLOCK - 60_000,
  };

  it("draws every animal slot as a framed cell on the plot grid", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 4_000_000,
        buildings: { coop: 1, barn: 0, pond: 0 },
        animals: { coop: [hen, null, null, null], barn: [], pond: [] },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:farm"]')?.click();
    await settle();

    // Coop, barn and pond sit side by side like the crop/fruit boards.
    expect(host.querySelectorAll(".garden-farm-panel")).toHaveLength(3);
    const cells = host.querySelectorAll<HTMLButtonElement>(".garden-animal-cell");
    expect(cells).toHaveLength(4);
    const lines = Array.from(cells[0]?.querySelectorAll(".garden-cell-line") ?? []).map(
      (line) => line.textContent,
    );
    // Same six-line frame as a plot: border, glyph, species, stars, timer, border.
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/^\+-+1\+$/);
    expect(lines[1]).toContain("c");
    expect(lines[2]).toBe("|Gà      |");
    expect(lines[3]).toBe("|*       |");
    expect(lines[5]).toMatch(/^\+-+\+$/);
    expect(cells[0]?.dataset.act).toBe("animalSlot");
    // Empty slots are cells too, not stray buttons below the board.
    expect(cells[1]?.dataset.act).toBe("pickAnimal");
    expect(cells[1]?.classList.contains("is-empty")).toBe(true);
    expect(cells[1]?.textContent).toContain("Trống");
  });

  it("opens the stats menu from an animal cell and sells animal products", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 4_000_000,
        buildings: { coop: 1, barn: 0, pond: 0 },
        animals: { coop: [hen, null, null, null], barn: [], pond: [] },
        bag: { seeds: {}, crops: [], supplies: {}, products: [{ product: "egg", star: 2, qty: 3 }] },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:farm"]')?.click();
    await settle();
    expect(host.querySelector('[data-act="buildBuilding"]')).not.toBeNull();
    expect(host.querySelector('[data-act="upgradeBuilding"]')).not.toBeNull();

    // Clicking an animal opens the same kind of popover as a plot.
    host.querySelector<HTMLButtonElement>('[data-act="animalSlot"]')?.click();
    await settle();
    const menu = host.querySelector(".garden-animal-menu");
    expect(menu?.textContent).toContain("Gà");
    expect(menu?.textContent).toContain("Chất lượng");
    expect(menu?.textContent).toContain("Giá thịt");
    expect(menu?.querySelector('[data-act="animalMenuBreed"]')).not.toBeNull();
    menu?.querySelector<HTMLButtonElement>('[data-act="animalMenuPat"]')?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "patAnimal")).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();
    const row = host.querySelector<HTMLButtonElement>('[data-act="sellProduct"]');
    expect(row?.textContent).toContain("Trứng");
    row?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "sellProduct")).toBe(true);
  });

  it("flags an incubating animal on its cell", async () => {
    const sitting = { ...hen, incubatingUntil: CLOCK + 5 * 60_000 };
    const api = new FakeGardenApi(
      makeState({
        coins: 4_000_000,
        buildings: { coop: 1, barn: 0, pond: 0 },
        animals: { coop: [sitting, null, null, null], barn: [], pond: [] },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:farm"]')?.click();
    await settle();
    const cell = host.querySelector<HTMLButtonElement>(".garden-animal-cell");
    expect(cell?.classList.contains("is-breeding")).toBe(true);
    expect(cell?.textContent).toContain("ấp");
  });

  it("keeps an egg from the stats menu to hatch a chick", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 4_000_000,
        buildings: { coop: 1, barn: 0, pond: 0 },
        animals: { coop: [hen, null, null, null], barn: [], pond: [] },
        bag: { seeds: {}, crops: [], supplies: {}, products: [{ product: "egg", star: 1, qty: 2 }] },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:farm"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="animalSlot"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="animalMenuBreed"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "breedAnimal")?.action).toMatchObject({
      building: "coop",
      slot: 0,
    });
  });

  it("reuses tab data while it is still fresh", async () => {
    const api = new FakeGardenApi(makeState({ coins: 1_000_000 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:bots"]')?.click();
    await settle();
    const first = api.calls.filter((call) => call.method === "bots").length;
    expect(first).toBe(1);

    // Flipping away and straight back must not re-request the same list.
    host.querySelector<HTMLButtonElement>('[data-act="tab:garden"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="tab:bots"]')?.click();
    await settle();
    expect(api.calls.filter((call) => call.method === "bots").length).toBe(first);
  });

  it("shows the pond growth and sells pond stock for meat", async () => {
    const fish = {
      kind: "fish" as const,
      bornAt: CLOCK - 2 * 60 * 60_000,
      pats: 0,
      lastProduceAt: CLOCK - 60_000,
    };
    const api = new FakeGardenApi(
      makeState({
        coins: 4_000_000,
        buildings: { coop: 0, barn: 0, pond: 1 },
        animals: { coop: [], barn: [], pond: [fish, null, null, null] },
        pondGrowth: 20,
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:farm"]')?.click();
    await settle();
    const titles = Array.from(host.querySelectorAll(".garden-board-title")).map(
      (title) => title.textContent ?? "",
    );
    expect(titles.some((title) => title.includes("Hồ cá"))).toBe(true);
    expect(titles.some((title) => title.includes("Tăng trưởng 20%"))).toBe(true);
    const cell = host.querySelector<HTMLButtonElement>(".garden-animal-cell");
    expect(cell?.textContent).toContain("Cá");
    cell?.click();
    await settle();
    const menu = host.querySelector(".garden-animal-menu");
    expect(menu?.textContent).toContain("20%");
    expect(menu?.textContent).toContain("Trứng cá");
    menu?.querySelector<HTMLButtonElement>('[data-act="animalMenuSell"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "sellAnimal")?.action).toMatchObject({
      building: "pond",
      slot: 0,
    });
  });

  it("buys an animal from an empty slot cell", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 4_000_000,
        buildings: { coop: 1, barn: 0, pond: 0 },
        animals: { coop: [hen, null, null, null], barn: [], pond: [] },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:farm"]')?.click();
    await settle();
    const empty = host.querySelector<HTMLButtonElement>(".garden-animal-cell.is-empty");
    empty?.click();
    await settle();

    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-act="buyAnimal"]'));
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent).toContain("Vịt");
    expect(rows[1]?.textContent).toContain("8.000c");
    rows[1]?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "buyAnimal")?.action).toMatchObject({
      building: "coop",
      slot: 1,
      animal: "duck",
    });
  });
});

describe("bulk supplies", () => {
  /** One growing carrot. */
  const crop = (slot: number, readyAt: number): PlotState => ({
    slot,
    seed: "carrot",
    plantedAt: CLOCK - 60_000,
    readyAt,
    effects: [],
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
    pest: false,
    protectedUntil: 0,
  });

  /** One growing apple tree. */
  const tree = (slot: number): TreeState => ({
    slot,
    tree: "apple",
    plantedAt: CLOCK - 60_000,
    readyAt: CLOCK + 600_000,
    effects: [],
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
    pest: false,
    protectedUntil: 0,
  });

  it("fertilizes the whole garden from one pick without owning the supply", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 1_000,
        plots: [crop(0, CLOCK + 600_000), crop(1, CLOCK + 600_000), crop(2, CLOCK - 1_000)],
        trees: [tree(0)],
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const quick = host.querySelectorAll<HTMLButtonElement>('[data-act="pickAllSupply"]')[0];
    expect(quick?.textContent).toContain("Bón phân nhanh");
    quick?.click();
    await settle();

    // Every fertilizer is offered, even with an empty bag.
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-act="quickSupplyAll"]'));
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.textContent?.includes("× 3"))).toBe(true);
    const speed = rows.find((row) => row.dataset.supply === "speedGrow");
    expect(speed?.disabled).toBe(false);
    speed?.click();
    await settle();

    const action = api.calls.find((call) => call.action?.kind === "fertilizeAll")?.action;
    expect(action).toMatchObject({ kind: "fertilizeAll", supply: "speedGrow" });
    expect(host.querySelector(".stage-status")?.textContent).toContain("Đã bón");
  });

  it("sprays the whole garden from one pick", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 100_000,
        plots: [crop(0, CLOCK + 600_000), crop(1, CLOCK + 600_000)],
        trees: [tree(0)],
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelectorAll<HTMLButtonElement>('[data-act="pickAllSupply"]')[1]?.click();
    await settle();
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-act="quickSupplyAll"]'));
    expect(rows).toHaveLength(4);
    const golden = rows.find((row) => row.dataset.supply === "goldenSpray");
    expect(golden?.disabled).toBe(false);
    golden?.click();
    await settle();

    expect(api.calls.find((call) => call.action?.kind === "sprayAll")?.action).toMatchObject({
      kind: "sprayAll",
      supply: "goldenSpray",
    });
    expect(host.querySelector(".stage-status")?.textContent).toContain("Đã xịt");
  });

  it("hides the pond when the snapshot predates it", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 9_000_000,
        buildings: { coop: 0, barn: 0 } as unknown as GardenSnapshot["buildings"],
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:farm"]')?.click();
    await settle();
    // An old worker has no pond key: no panel, no Build, above all no Upgrade.
    expect(host.querySelectorAll(".garden-farm-panel")).toHaveLength(2);
    const titles = Array.from(host.querySelectorAll(".garden-board-title")).map((el) => el.textContent ?? "");
    expect(titles.some((title) => title.includes("Hồ cá"))).toBe(false);
    expect(host.querySelector('[data-act="upgradeBuilding"]')).toBeNull();
  });
});

describe("rare tools", () => {
  /** One growing carrot, optionally pinned. */
  const crop = (slot: number, favorite = false): PlotState => ({
    slot,
    seed: "carrot",
    plantedAt: CLOCK - 60_000,
    readyAt: CLOCK + 600_000,
    effects: [],
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
    pest: false,
    protectedUntil: 0,
    favorite,
  });

  /** Opens the plot menu for one absolute crop slot. */
  async function openPlot(host: HTMLElement, slot: number): Promise<void> {
    host.querySelector<HTMLButtonElement>(`.garden-cell[data-area="crop"][data-slot="${slot}"]`)?.click();
    await settle();
  }

  it("offers the three hand tools in the plant menu", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 1_000,
        plots: [crop(0)],
        bag: {
          seeds: {},
          crops: [],
          supplies: {},
          tools: { reclaimer: 1, shovel: 1, favoriteLock: 1 },
        },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    await openPlot(host, 0);

    const labels = Array.from(host.querySelectorAll(".garden-menu-row")).map((row) => row.textContent ?? "");
    expect(labels.some((label) => label.includes("Thu hồi hạt (1)"))).toBe(true);
    expect(labels.some((label) => label.includes("Dời cây (1)"))).toBe(true);
    expect(labels.some((label) => label.includes("Khóa yêu thích (1)"))).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-act="menuFavorite"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "toggleFavorite")?.action).toMatchObject({
      kind: "toggleFavorite",
      slot: 0,
      tree: false,
    });
  });

  it("reclaims the seed from the plant menu", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 1_000,
        plots: [crop(0)],
        bag: { seeds: {}, crops: [], supplies: {}, tools: { reclaimer: 1 } },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    await openPlot(host, 0);
    host.querySelector<HTMLButtonElement>('[data-act="menuReclaim"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "reclaimSeed")?.action).toMatchObject({
      kind: "reclaimSeed",
      slot: 0,
    });
    expect(host.querySelector(".stage-status")?.textContent).toContain("Đã thu hồi hạt giống");
  });

  it("moves a crop to the empty cell clicked next", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 1_000,
        plots: [crop(0)],
        bag: { seeds: {}, crops: [], supplies: {}, tools: { shovel: 1 } },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    await openPlot(host, 0);

    host.querySelector<HTMLButtonElement>('[data-act="menuMove"]')?.click();
    await settle();
    expect(host.querySelector(".stage-status")?.textContent).toContain("Chọn ô trống");
    expect(host.querySelector(".garden-cell.is-move-source")).not.toBeNull();

    host.querySelector<HTMLButtonElement>('.garden-cell[data-area="crop"][data-slot="1"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "movePlant")?.action).toMatchObject({
      kind: "movePlant",
      from: 0,
      to: 1,
      tree: false,
    });
    expect(host.querySelector(".stage-status")?.textContent).toContain("Đã dời cây");
  });

  it("marks a pinned plant and refuses to harvest or uproot it", async () => {
    const api = new FakeGardenApi(makeState({ coins: 1_000, plots: [crop(0, true)] }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    const cell = host.querySelector('.garden-cell[data-area="crop"][data-slot="0"]');
    expect(cell?.classList.contains("is-favorite")).toBe(true);
    await openPlot(host, 0);

    const row = (act: string) => host.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
    expect(row("harvest")?.disabled).toBe(true);
    expect(row("uproot")?.disabled).toBe(true);
    expect(host.querySelector('[data-act="menuFavorite"]')?.textContent).toContain("Bỏ khóa yêu thích");
  });
});

describe("levels tab", () => {
  it("shows farming, ranching and artisaning bars", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:levels"]')?.click();
    await settle();
    const text = host.querySelector(".garden-levels")?.textContent ?? "";
    expect(text).toContain("Farming");
    expect(text).toContain("Ranching");
    expect(text).toContain("Artisaning");
    expect(text).toContain("Lv 0/10");
  });
});

describe("staff", () => {
  it("opens a popover from the staff slot like a plot cell", async () => {
    const api = new FakeGardenApi(makeState({ coins: 1_000_000 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('.garden-staff [data-act="staffSlot"]')?.click();
    await settle();
    const popover = host.querySelector(".garden-staff-menu");
    expect(popover).not.toBeNull();
    const hire = popover?.querySelector<HTMLButtonElement>('[data-act="staffMenuHire"]');
    expect(hire).not.toBeNull();
    hire?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "hireStaff")).toBe(true);
  });

  it("lists every hired hand with levels and jobs", async () => {
    const workers = Array.from({ length: 12 }, (_unused, index) => ({
      id: `w${index}`,
      name: `W${index}`,
      speed: 3,
      skill: 3,
      wage: 900,
      traits: [],
      jobs: index % 2 === 0 ? 2 : 1,
      role: "gardener" as const,
      level: 1 + (index % 4),
      xp: 30,
      lastWorkAt: CLOCK,
      lastPaidAt: CLOCK,
      unpaid: 0,
    }));
    const api = new FakeGardenApi(makeState({ coins: 1_000_000, extras: { ...EXTRAS, staff: workers } }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(host.querySelector(".garden-staff")?.textContent).toContain("12/100");
    expect(host.querySelector('[data-act="staffList"]')?.textContent).toContain("+4");
    host.querySelector<HTMLButtonElement>('[data-act="staffList"]')?.click();
    await settle();

    const rows = host.querySelectorAll('[data-act="staffMenuSelect"]');
    expect(rows).toHaveLength(12);
    host.querySelector<HTMLButtonElement>('[data-act="staffMenuSelect"]')?.click();
    await settle();
    const menu = host.querySelector(".garden-staff-menu");
    expect(menu?.textContent).toContain("Cấp 1");
    expect(menu?.textContent).toContain("việc/chu kỳ");
  });

  it("gifts coins and items from the extras tab", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 5_000,
        bag: { seeds: { carrot: 2 }, crops: [], supplies: { compost: 1 } },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:extras"]')?.click();
    await settle();

    const code = host.querySelector<HTMLInputElement>(".garden-gift-code");
    expect(code).not.toBeNull();
    if (code !== null) {
      code.value = "abcdef";
      code.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="giftCoins"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "giftCoins")?.action).toMatchObject({
      kind: "giftCoins",
      code: "ABCDEF",
      amount: 1000,
    });

    host.querySelector<HTMLButtonElement>('[data-act="giftSeed"]')?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "giftSeed")?.action).toMatchObject({
      kind: "giftSeed",
      code: "ABCDEF",
      seed: "carrot",
      qty: 1,
    });
  });

  it("shows a staff slot in the garden and hires from the extras tab", async () => {
    const api = new FakeGardenApi(makeState({ coins: 1_000_000 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(host.querySelector(".garden-staff")?.textContent).toContain("Trống");
    host.querySelector<HTMLButtonElement>('[data-act="tab:extras"]')?.click();
    await settle();
    const hire = host.querySelector<HTMLButtonElement>('[data-act="staffHire"]');
    expect(hire).not.toBeNull();
    hire?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "hireStaff")).toBe(true);
  });
});

describe("extras tab", () => {
  it("renders the extended systems and buys insurance plus a wheel spin", async () => {
    const api = new FakeGardenApi(makeState({ coins: 1_000_000 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:extras"]')?.click();
    await settle();
    expect(host.querySelector('[data-act="extrasInsurance"]')).not.toBeNull();
    expect(host.querySelector('[data-act="extrasWheel"]')).not.toBeNull();
    expect(host.querySelector('[data-act="extrasContract"]')).not.toBeNull();
    expect(host.querySelector('[data-act="extrasMerchant"]')).not.toBeNull();
    expect(host.querySelector('[data-act="extrasHatch"]')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('[data-act="extrasInsurance"]')?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "buyInsurance")).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-act="extrasWheel"]')?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "spinWheel")).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-act="extrasHatch"]')?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "hatchEgg")).toBe(true);
  });
});

describe("warehouse tab", () => {
  it("dries crops and fruit with the warehouse dryer", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 10_000_000,
        warehouse: { level: 1, machines: { dryer: { level: 1, lastCraftAt: 0 } } },
        bag: {
          seeds: {},
          crops: [
            { item: "carrot", effects: [], qty: 1 },
            { item: "apple", effects: [], qty: 1 },
          ],
          supplies: {},
        },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:warehouse"]')?.click();
    await settle();

    // Machines open a menu; no input rows are rendered inline.
    expect(host.querySelectorAll('[data-act="craftMachine"]')).toHaveLength(0);
    host.querySelector<HTMLButtonElement>('[data-act="machineMenuOpen"][data-machine="dryer"]')?.click();
    await settle();
    const fruit = host.querySelector<HTMLButtonElement>(
      '[data-act="machineCraft"][data-machine="dryer"][data-item="apple"]',
    );
    expect(fruit).not.toBeNull();
    fruit?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "craftMachine")?.action).toMatchObject({
      kind: "craftMachine",
      machine: "dryer",
      item: "apple",
    });
  });

  it("brews a keg job and only collects it when ready", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 10_000_000,
        warehouse: {
          level: 1,
          machines: {
            keg: {
              level: 1,
              lastCraftAt: CLOCK,
              job: { item: "apple", startedAt: CLOCK, readyAt: CLOCK + 600_000 },
            },
          },
        },
        bag: { seeds: {}, crops: [{ item: "apple", effects: [], qty: 1 }], supplies: {} },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:warehouse"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="machineMenuOpen"][data-machine="keg"]')?.click();
    await settle();

    const menu = host.querySelector(".garden-machine-menu");
    expect(menu?.textContent).toContain("Đang ủ Táo");
    expect(menu?.querySelector("[data-machine-until]")).not.toBeNull();
    // While brewing, the craft rows and the collect row stay hidden.
    expect(menu?.querySelector('[data-act="machineCraft"]')).toBeNull();
    expect(menu?.querySelector('[data-act="machineCollect"]')).toBeNull();

    // A ready keg offers collection.
    const readyApi = new FakeGardenApi(
      makeState({
        coins: 10_000_000,
        warehouse: {
          level: 1,
          machines: {
            keg: {
              level: 1,
              lastCraftAt: CLOCK - 600_000,
              job: { item: "apple", startedAt: CLOCK - 600_000, readyAt: CLOCK - 1 },
            },
          },
        },
      }),
    );
    const ready = await mountGame(readyApi);
    mounted.push(ready.game);
    ready.host.querySelector<HTMLButtonElement>('[data-act="tab:warehouse"]')?.click();
    await settle();
    ready.host.querySelector<HTMLButtonElement>('[data-act="machineMenuOpen"][data-machine="keg"]')?.click();
    await settle();
    ready.host.querySelector<HTMLButtonElement>('[data-act="machineCollect"]')?.click();
    await settle();
    expect(readyApi.calls.find((call) => call.action?.kind === "collectMachine")?.action).toMatchObject({
      kind: "collectMachine",
      machine: "keg",
    });
  });

  it("builds a warehouse and crafts produce with machines", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 10_000_000,
        warehouse: { level: 1, machines: { mayoMaker: { level: 1, lastCraftAt: 0 } } },
        bag: { seeds: {}, crops: [], supplies: {}, products: [{ product: "egg", star: 1, qty: 2 }] },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:warehouse"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-act="machineMenuOpen"][data-machine="mayoMaker"]')?.click();
    await settle();
    const craft = host.querySelector<HTMLButtonElement>(
      '[data-act="machineCraft"][data-machine="mayoMaker"]',
    );
    expect(craft).not.toBeNull();
    craft?.click();
    await settle();
    const call = api.calls.find((entry) => entry.action?.kind === "craftMachine");
    expect(call?.action).toMatchObject({ kind: "craftMachine", machine: "mayoMaker" });
  });
});

describe("bots tab", () => {
  it("lists bot gardens separately and visits one", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:bots"]')?.click();
    await settle();
    const row = host.querySelector<HTMLButtonElement>('[data-act="visitBot"]');
    expect(row?.textContent).toContain("Bot 01");
    row?.click();
    await settle();
    expect(host.querySelector(".stage-status")?.textContent).toContain("Chế độ xem");
  });
});

describe("chart tab", () => {
  it("lists item trends from the global market board", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:chart"]')?.click();
    await settle();
    const rows = host.querySelectorAll<HTMLElement>(".garden-chart-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains("is-up")).toBe(true);
    expect(rows[0]?.textContent).toContain("x1.50");
    expect(rows[1]?.classList.contains("is-down")).toBe(true);
    expect(rows[1]?.textContent).toContain("12/8");
  });
});

describe("market tab", () => {
  it("lists the shop offers and buys one seed", async () => {
    const api = new FakeGardenApi(makeState());
    const { host, game } = await mountGame(api);
    mounted.push(game);

    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();
    expect(host.querySelector("[data-restock-timer]")?.textContent).toContain("Đổi hàng");
    const cards = host.querySelectorAll<HTMLButtonElement>(".garden-buy-card");
    expect(cards.length).toBe(SEASON.shop.offers.length + 7 + SEASON.shop.tools.length);
    // Supplies and rare tools keep their own labelled sections.
    const supplies = host.querySelectorAll('.garden-buy-card[data-act="buySupply"]');
    expect(supplies).toHaveLength(7);
    const supplyNames = [...supplies].map((card) => card.textContent ?? "");
    expect(supplyNames.some((text) => text.includes("Phân tăng trưởng"))).toBe(true);
    expect(supplyNames.some((text) => text.includes("Spray bão tố"))).toBe(true);
    if (SEASON.shop.tools.length === 0) {
      expect(host.querySelector(".garden-market")?.textContent).toContain("không có công cụ hiếm");
    }
    const seedCard = host.querySelector<HTMLButtonElement>('.garden-buy-card[data-act="buy"]');
    seedCard?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "buySeed")).toBe(true);
  });

  it("grays out sold-out shop cards", async () => {
    const seed = SEASON.shop.offers[0]?.seed;
    if (seed === undefined) throw new Error("no offer");
    const api = new FakeGardenApi(makeState({ coins: 1_000, shopStock: { [seed]: 0 } }));
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();

    const card = host.querySelector<HTMLButtonElement>(`[data-act="buy"][data-seed="${seed}"]`);
    expect(card).not.toBeNull();
    expect(card?.disabled).toBe(true);
    expect(card?.classList.contains("is-sold-out")).toBe(true);
    expect(card?.textContent).toContain("Hết hàng");
  });

  it("shows crop quality stars and sells the matching stack", async () => {
    const api = new FakeGardenApi(
      makeState({
        coins: 1_000,
        bag: {
          seeds: {},
          crops: [{ item: "carrot", effects: [], star: 3, qty: 2 }],
          supplies: {},
        },
      }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();

    const row = host.querySelector<HTMLButtonElement>('[data-act="sell"]');
    expect(row?.textContent).toContain("3★");
    row?.click();
    await settle();
    expect(api.calls.find((call) => call.action?.kind === "sellCrop")?.action).toMatchObject({
      kind: "sellCrop",
      item: "carrot",
      star: 3,
      qty: 2,
    });
  });

  it("lists rare seeds in their own market category", async () => {
    const season = {
      ...SEASON,
      shop: {
        ...SEASON.shop,
        offers: [...SEASON.shop.offers, { seed: "beanstalk" as const, price: 3_000_000, stock: 1 }],
      },
    };
    const api = new FakeGardenApi(makeState({ coins: 50_000_000 }));
    api.seasonValue = season;
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();

    expect(host.textContent).toContain("Hạt hiếm");
    const card = host.querySelector<HTMLButtonElement>('[data-act="buy"][data-seed="beanstalk"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("3.000.000c");
  });

  it("buys seeds and supplies in bulk from the quantity selector", async () => {
    const api = new FakeGardenApi(makeState({ coins: 5_000 }));
    const { host, game } = await mountGame(api);
    mounted.push(game);
    host.querySelector<HTMLButtonElement>('[data-act="tab:market"]')?.click();
    await settle();

    host.querySelector<HTMLButtonElement>('[data-act="setBuyQty"][data-qty="10"]')?.click();
    await settle();
    host.querySelector<HTMLButtonElement>('.garden-buy-card[data-act="buy"]')?.click();
    await settle();
    const seedBuy = api.calls.find((call) => call.action?.kind === "buySeed");
    const stock = SEASON.shop.offers[0]?.stock ?? 1;
    expect(seedBuy?.action).toMatchObject({ kind: "buySeed", qty: Math.min(10, stock) });

    for (const qty of [25, 50]) {
      host.querySelector<HTMLButtonElement>(`[data-act="setBuyQty"][data-qty="${qty}"]`)?.click();
      await settle();
      host.querySelector<HTMLButtonElement>('[data-act="buySupply"]')?.click();
      await settle();
      const supplyBuy = api.calls.filter((call) => call.action?.kind === "buySupply").at(-1);
      expect((supplyBuy?.action as { qty?: number } | undefined)?.qty).toBe(qty);
    }
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
