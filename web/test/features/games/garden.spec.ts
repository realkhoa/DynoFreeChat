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
  EPOCH_MS,
  EVENT_WAVE_MS,
  seasonAt,
  type GardenAction,
  type GardenSnapshot,
  type PlotState,
  type SeasonSnapshot,
  type VisitSnapshot,
} from "@dyno/shared/garden";
import { createAsciiGardenGame } from "@/features/games/garden/game";
import type { GardenApi } from "@/features/games/garden/api";
import { setLocale } from "@/shared/i18n";

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
  effect: "golden",
  watered: true,
  fertilized: true,
};

/** A growing tomato on plot 0. */
const GROWING_PLOT: PlotState = {
  slot: 0,
  seed: "tomato",
  plantedAt: CLOCK - 30_000,
  readyAt: CLOCK + 120_000,
  effect: null,
  watered: false,
  fertilized: false,
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
    patches: 1,
    plots: new Array<PlotState | null>(9).fill(null),
    bag: { seeds: { carrot: 3 }, crops: [] },
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
    patches: 1,
    plots: new Array<PlotState | null>(9).fill(null),
    bag: { seeds: {}, crops: [] },
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
  it("renders three tabs, nine plots and the HUD", async () => {
    const api = new FakeGardenApi(
      makeState({ plots: [RIPE_PLOT, ...new Array<PlotState | null>(8).fill(null)] }),
    );
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(host.querySelectorAll(".garden-tab")).toHaveLength(3);
    expect(host.querySelectorAll(".garden-cell")).toHaveLength(9);
    expect(host.querySelectorAll(".garden-cell.is-ready")).toHaveLength(1);
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
    const seeds = host.querySelectorAll<HTMLButtonElement>(".garden-seeds .garden-row");
    expect(seeds).toHaveLength(4);

    seeds[0]?.click();
    await settle();
    const planted = api.calls.find((call) => call.action?.kind === "plant");
    expect(planted?.action).toMatchObject({ kind: "plant", slot: 1, seed: "carrot" });
  });

  it("shows the owner actions for a ripe crop and harvests it", async () => {
    const api = new FakeGardenApi(
      makeState({ plots: [RIPE_PLOT, ...new Array<PlotState | null>(8).fill(null)] }),
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

  it("paginates bought 3x3 patches and offers the next one", async () => {
    const plots = new Array<PlotState | null>(18).fill(null);
    plots[12] = { ...RIPE_PLOT, slot: 12 };
    const api = new FakeGardenApi(makeState({ patches: 2, plots }));
    const { host, game } = await mountGame(api);
    mounted.push(game);

    expect(host.querySelector(".garden-page")?.textContent).toContain("1/3");
    const next = host.querySelector<HTMLButtonElement>('[data-act="nextPage"]');
    next?.click();
    await settle();
    expect(host.querySelector(".garden-page")?.textContent).toContain("2/3");
    expect(host.querySelectorAll<HTMLElement>(".garden-cell")[0]?.dataset.slot).toBe("9");

    host.querySelector<HTMLButtonElement>('[data-act="nextPage"]')?.click();
    await settle();
    // Third page is the not-yet-bought preview, with a disabled buy action.
    expect(host.querySelector(".garden-page")?.textContent).toContain("3/3");
    const buy = host.querySelector<HTMLButtonElement>('[data-act="buyPatch"]');
    expect(buy).not.toBeNull();
    expect(buy?.disabled).toBe(true);
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
    const rows = host.querySelectorAll<HTMLButtonElement>(".garden-market .garden-row");
    expect(rows).toHaveLength(4);

    rows[0]?.click();
    await settle();
    expect(api.calls.some((call) => call.action?.kind === "buySeed")).toBe(true);
  });
});

describe("visit mode", () => {
  it("opens read-only and lets the visitor water a crop", async () => {
    const api = new FakeGardenApi(makeState());
    api.visitValue = makeVisit({ plots: [GROWING_PLOT, ...new Array<PlotState | null>(8).fill(null)] });
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
