/**
 * @file garden.ts
 * @brief Durable Objects that own ASCII Garden state and its public directory.
 * @details `Garden` is one player's authoritative database row set: plots, bag,
 * wallet, credentials and helper log. `GardenHub` keeps the code→player mapping
 * and the leaderboard, so visits and rankings never scan every garden. The pure
 * economy lives in `garden-rules.ts`; this module only stores, authenticates and
 * publishes.
 */

import { DurableObject } from "cloudflare:workers";
import {
  ACTIONS_PER_MINUTE,
  GARDEN_PROTOCOL_VERSION,
  RAID_MAX_HP,
  RAID_HIT_DAMAGE,
  raidHitCost,
  type GuildSnapshot,
  raidWindowAt,
  raidEndsAt,
  GUEST_WATER_CUT_RATIO,
  CROPS_PER_TAB,
  MAX_TABS,
  PLOTS_PER_PATCH,
  TREES_PER_TAB,
  REGISTERS_PER_WINDOW,
  REGISTER_WINDOW_MS,
  parseGardenAction,
  canonicalEffects,
  cropKey,
  parseCropKey,
  applyBuyMarket,
  applyMarket,
  seasonAt,
  seedById,
  supplyById,
  toolById,
  SOIL_START,
  SPECIAL_PATCHES,
  SPECIAL_PLOTS_PER_PATCH,
  SPECIAL_SLOTS,
  GREENHOUSE_SLOTS,
  MUSHROOM_TRAYS,
  BUILDING_IDS,
  buildingSlots,
  totalCrops,
  weekKeyAt,
  DEFAULT_SKILLS,
  type BagState,
  type CropStack,
  type ProductStack,
  type ToolId,
  type GardenAction,
  type GardenSnapshot,
  type LeaderboardEntry,
  type PlotState,
  type ActiveFertilizer,
  type ActiveSpray,
  type EffectId,
  type SeasonSnapshot,
  type SaleRecord,
  effectById,
  type AnySeedId,
  type SeedId,
  type SupplyId,
  type TreeId,
  type TreeState,
  type VisitSnapshot,
  type VisitorSummary,
  STOCK_CATALOG,
  stockBySymbol,
  stockCoinPrice,
  type StockDefinition,
  type StockQuote,
} from "@dyno/shared/garden";
import { DEFAULT_COLOR, sanitizeColor, sanitizeNick } from "@dyno/shared/protocol";
import type { Env } from "./env";
import { json, readJson } from "./http";
import { BOT_ACTION_LIMIT, planBotActions } from "./bot-brain";
import { planAiActions } from "./bot-ai";
import {
  applyGardenAction,
  advanceQuests,
  createLedger,
  emptyCrops,
  emptyTrees,
  settleFarm,
  settleThirst,
  settleMachines,
  settleTools,
  settlePest,
  settleDisease,
  settleHazards,
  settleExtras,
  settleStaff,
  settleAttachments,
  settleSpecialReset,
  extrasSnapshot,
  ledgerSnapshot,
  type GardenLedger,
} from "./garden-rules";
import { timingSafeEqualHex } from "./pass";
import { randomRecoveryKey, randomToken, sha256Hex } from "./secrets";
import { createRng, hash32 } from "@dyno/shared/garden";
import type { SqlRow } from "./sql";

/** Name of the singleton Hub object. */
export const HUB_NAME = "hub";

/** Header carrying the raw write token from the Worker to a garden object. */
export const GARDEN_TOKEN_HEADER = "x-dyno-garden-token";

/** Header carrying market multipliers from the Worker to a garden object. */
export const MARKET_HEADER = "x-dyno-market";

/** Internal header that authorises a bot automation tick. */
export const BOT_HEADER = "x-dyno-bot-tick";

/** Internal header used for gift transfers between two Garden objects. */
export const GIFT_HEADER = "x-dyno-gift";

/** Owners seen less than this long ago count as online visitors see it. */
export const ONLINE_WINDOW_MS = 30_000;

/** Visitors listed on a garden page. */
export const VISITOR_LIMIT = 12;

/**
 * @brief Derives the owned patch count from a stored meta row.
 * @param value Stored metadata; saves written before the 3x3 patch model only
 * carry `unlocked`, so those gardens keep their old unlock count as one patch.
 * @details Never reduces what a player already had: a legacy garden with four
 * unlocked plots becomes one fully usable 3x3 patch, with every planted crop kept.
 */
export function deriveTabs(value: { tabs?: unknown; patches?: unknown; unlocked?: unknown }): number {
  if (typeof value.tabs === "number" && Number.isInteger(value.tabs) && value.tabs >= 1) {
    return Math.min(MAX_TABS, value.tabs);
  }
  const patches =
    typeof value.patches === "number" && Number.isFinite(value.patches) && value.patches >= 1
      ? value.patches
      : typeof value.unlocked === "number" && Number.isFinite(value.unlocked)
        ? Math.max(1, Math.ceil(value.unlocked / PLOTS_PER_PATCH))
        : 1;
  // Old saves only had `patches * 9` crop and tree slots; promote to enough tabs
  // for both grids so no planted slot is dropped.
  const oldCropSlots = patches * PLOTS_PER_PATCH;
  return Math.min(
    MAX_TABS,
    Math.max(1, Math.ceil(oldCropSlots / CROPS_PER_TAB), Math.ceil(oldCropSlots / TREES_PER_TAB)),
  );
}

/**
 * @brief Derives which crop patches are open in each tab.
 * @param stored Value from an old or current save.
 * @param plots Read crop rows, used to keep every planted slot reachable.
 * @param tabs Owned tab count.
 */
export function deriveUnlockedPatches(stored: unknown, plots: (PlotState | null)[], tabs: number): number[] {
  const patches: number[] = [];
  for (let tab = 0; tab < tabs; tab += 1) {
    let open = 1;
    const local = Array.isArray(stored) && typeof stored[tab] === "number" ? stored[tab] : 0;
    if (Number.isFinite(local)) open = Math.min(PLOTS_PER_PATCH, Math.max(1, Math.floor(local)));
    // Never lock a slot that already holds a plant from an older layout.
    for (let patch = 0; patch < PLOTS_PER_PATCH; patch += 1) {
      for (let plot = 0; plot < PLOTS_PER_PATCH; plot += 1) {
        const slot = tab * CROPS_PER_TAB + patch * PLOTS_PER_PATCH + plot;
        if ((plots[slot] ?? null) !== null) open = Math.max(open, patch + 1);
      }
    }
    patches.push(open);
  }
  return patches;
}

/** @brief Units of each seed/supply one purchase action bought. */
export function boughtDiff(action: GardenAction): Record<string, number> {
  if (action.kind === "buySeed") return { [action.seed]: action.qty };
  if (action.kind === "buySupply") return { [action.supply]: action.qty };
  return {};
}

/**
 * @brief Units of each item removed from the bag by one action.
 * @param before Bag before the action.
 * @param after Bag after the action.
 */
export function soldDiff(before: readonly CropStack[], after: readonly CropStack[]): Record<string, number> {
  const sold: Record<string, number> = {};
  for (const stack of before) {
    const left = after.find(
      (entry) =>
        entry.item === stack.item &&
        cropKey(entry.item, entry.effects, entry.star ?? 1) ===
          cropKey(stack.item, stack.effects, stack.star ?? 1),
    );
    const removed = stack.qty - (left?.qty ?? 0);
    if (removed > 0) sold[stack.item] = (sold[stack.item] ?? 0) + removed;
  }
  return sold;
}

/** Stored metadata: the ledger minus the rows kept in their own tables. */
type StoredMeta = Omit<GardenLedger, "plots" | "trees" | "bag">;

type MetaRow = SqlRow<{ value: string }>;

type PlotRow = SqlRow<{
  slot: number;
  seed: string;
  planted_at: number;
  ready_at: number;
  effect: string | null;
  watered: number;
  fertilized: number;
  harvests: number;
  fertilizer: string | null;
  spray: string | null;
  pest: number;
  protected_until: number;
  favorite: number;
  disease: number;
  mutation_boost: number;
  bad_luck: number;
  dead: number;
  grow_ms: number;
}>;

type TreeRow = SqlRow<{
  slot: number;
  tree: string;
  planted_at: number;
  ready_at: number;
  effect: string | null;
  watered: number;
  fertilized: number;
  harvests: number;
  fertilizer: string | null;
  spray: string | null;
  pest: number;
  protected_until: number;
  favorite: number;
  disease: number;
  mutation_boost: number;
  bad_luck: number;
  dead: number;
  grow_ms: number;
}>;

type BagRow = SqlRow<{ kind: string; item: string; qty: number }>;

/** @brief Comparable signature of a live crop row. */
function plotStateKey(plot: PlotState): string {
  return [
    plot.seed,
    plot.plantedAt,
    plot.readyAt,
    JSON.stringify(plot.effects),
    plot.watered ? 1 : 0,
    plot.fertilized ? 1 : 0,
    plot.harvests,
    plot.fertilizer === null ? "" : JSON.stringify(plot.fertilizer),
    plot.spray === null ? "" : JSON.stringify(plot.spray),
    plot.pest ? 1 : 0,
    plot.protectedUntil,
    plot.favorite === true ? 1 : 0,
    plot.diseasedAt ?? 0,
    plot.mutationBoost ?? 0,
    plot.badLuck ?? 0,
    plot.dead === true ? 1 : 0,
    plot.growMs ?? 0,
  ].join("|");
}

/** @brief Comparable signature of a stored crop row. */
function plotRowKey(row: PlotRow): string {
  return [
    row.seed,
    row.planted_at,
    row.ready_at,
    row.effect ?? "",
    row.watered,
    row.fertilized,
    row.harvests,
    row.fertilizer ?? "",
    row.spray ?? "",
    row.pest,
    row.protected_until,
    row.favorite,
    row.disease,
    row.mutation_boost,
    row.bad_luck,
    row.dead,
    row.grow_ms,
  ].join("|");
}

/** @brief Comparable signature of a live fruit row. */
function treeStateKey(tree: TreeState): string {
  return [
    tree.tree,
    tree.plantedAt,
    tree.readyAt,
    JSON.stringify(tree.effects),
    tree.watered ? 1 : 0,
    tree.fertilized ? 1 : 0,
    tree.harvests,
    tree.fertilizer === null ? "" : JSON.stringify(tree.fertilizer),
    tree.spray === null ? "" : JSON.stringify(tree.spray),
    tree.pest ? 1 : 0,
    tree.protectedUntil,
    tree.favorite === true ? 1 : 0,
    tree.diseasedAt ?? 0,
    tree.mutationBoost ?? 0,
    tree.badLuck ?? 0,
    tree.dead === true ? 1 : 0,
    tree.growMs ?? 0,
  ].join("|");
}

/** @brief Comparable signature of a stored fruit row. */
function treeRowKey(row: TreeRow): string {
  return [
    row.tree,
    row.planted_at,
    row.ready_at,
    row.effect ?? "",
    row.watered,
    row.fertilized,
    row.harvests,
    row.fertilizer ?? "",
    row.spray ?? "",
    row.pest,
    row.protected_until,
    row.favorite,
    row.disease,
    row.mutation_boost,
    row.bad_luck,
    row.dead,
    row.grow_ms,
  ].join("|");
}

type VisitorRow = SqlRow<{
  player_id: string;
  nick: string;
  color: string;
  visited_at: number;
  waters: number;
  cheers: number;
}>;

/** @brief One authoritative garden. */
export class Garden extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      this.ensureSchema();
    } catch {
      // Write quota exhausted: existing tables still serve reads.
    }
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /** @brief Creates the tables on first use and after a reset. */
  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plots (
        slot INTEGER PRIMARY KEY,
        seed TEXT NOT NULL,
        planted_at INTEGER NOT NULL,
        ready_at INTEGER NOT NULL,
        effect TEXT,
        watered INTEGER NOT NULL DEFAULT 0,
        fertilized INTEGER NOT NULL DEFAULT 0,
        harvests INTEGER NOT NULL DEFAULT 0,
        fertilizer TEXT,
        spray TEXT,
        pest INTEGER NOT NULL DEFAULT 0,
        protected_until INTEGER NOT NULL DEFAULT 0,
        disease INTEGER NOT NULL DEFAULT 0,
        mutation_boost REAL NOT NULL DEFAULT 0,
        bad_luck REAL NOT NULL DEFAULT 0,
        dead INTEGER NOT NULL DEFAULT 0,
        grow_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS trees (
        slot INTEGER PRIMARY KEY,
        tree TEXT NOT NULL,
        planted_at INTEGER NOT NULL,
        ready_at INTEGER NOT NULL,
        effect TEXT,
        watered INTEGER NOT NULL DEFAULT 0,
        fertilized INTEGER NOT NULL DEFAULT 0,
        harvests INTEGER NOT NULL DEFAULT 0,
        fertilizer TEXT,
        spray TEXT,
        pest INTEGER NOT NULL DEFAULT 0,
        protected_until INTEGER NOT NULL DEFAULT 0,
        disease INTEGER NOT NULL DEFAULT 0,
        mutation_boost REAL NOT NULL DEFAULT 0,
        bad_luck REAL NOT NULL DEFAULT 0,
        dead INTEGER NOT NULL DEFAULT 0,
        grow_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS bag (
        kind TEXT NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (kind, item)
      );
      CREATE TABLE IF NOT EXISTS visitors (
        player_id TEXT PRIMARY KEY,
        nick TEXT NOT NULL,
        color TEXT NOT NULL,
        visited_at INTEGER NOT NULL,
        waters INTEGER NOT NULL DEFAULT 0,
        cheers INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Existing gardens predate the reharvest counter: add the column in place,
    // keeping every plot row and every other column untouched.
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(plots)").toArray();
    if (!columns.some((column) => column.name === "harvests")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN harvests INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "fertilizer")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN fertilizer TEXT");
    }
    if (!columns.some((column) => column.name === "spray")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN spray TEXT");
    }
    if (!columns.some((column) => column.name === "pest")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN pest INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE plots ADD COLUMN protected_until INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "favorite")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "disease")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN disease INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "mutation_boost")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN mutation_boost REAL NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE plots ADD COLUMN bad_luck REAL NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "dead")) {
      this.sql.exec("ALTER TABLE plots ADD COLUMN dead INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE plots ADD COLUMN grow_ms INTEGER NOT NULL DEFAULT 0");
      // Plants that predate the thirst rule must not die on the first read.
      this.sql.exec("UPDATE plots SET watered = 1");
    }
    const treeColumns = this.sql.exec<{ name: string }>("PRAGMA table_info(trees)").toArray();
    if (!treeColumns.some((column) => column.name === "fertilizer")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN fertilizer TEXT");
    }
    if (!treeColumns.some((column) => column.name === "spray")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN spray TEXT");
    }
    if (!treeColumns.some((column) => column.name === "pest")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN pest INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE trees ADD COLUMN protected_until INTEGER NOT NULL DEFAULT 0");
    }
    if (!treeColumns.some((column) => column.name === "favorite")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
    }
    if (!treeColumns.some((column) => column.name === "disease")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN disease INTEGER NOT NULL DEFAULT 0");
    }
    if (!treeColumns.some((column) => column.name === "mutation_boost")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN mutation_boost REAL NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE trees ADD COLUMN bad_luck REAL NOT NULL DEFAULT 0");
    }
    if (!treeColumns.some((column) => column.name === "dead")) {
      this.sql.exec("ALTER TABLE trees ADD COLUMN dead INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE trees ADD COLUMN grow_ms INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("UPDATE trees SET watered = 1");
    }
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS help (
        visitor_id TEXT NOT NULL,
        slot INTEGER NOT NULL,
        day INTEGER NOT NULL,
        PRIMARY KEY (visitor_id, slot, day)
      );
    `);
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/register") return this.register(request);
    if (request.method === "POST" && url.pathname === "/bot-tick") return this.botTick(request);
    if (request.method === "POST" && url.pathname === "/gift") return this.giftInbox(request);
    if (request.method === "GET" && url.pathname === "/state") return this.state(request);
    if (request.method === "POST" && url.pathname === "/act") return this.act(request);
    if (request.method === "GET" && url.pathname === "/snapshot") return this.snapshot();
    if (request.method === "POST" && url.pathname === "/profile") return this.profile(request);
    if (request.method === "POST" && url.pathname === "/recipe") return this.learnRecipe(request);
    if (request.method === "POST" && url.pathname === "/raid") return this.hitRaid(request);
    if (request.method === "POST" && url.pathname === "/guild/donate") return this.donateGuild(request);
    if (request.method === "POST" && url.pathname === "/guild/contribute") {
      return this.contributeGuild(request);
    }
    if (request.method === "POST" && url.pathname === "/stocks/trade") {
      return this.tradeStock(request);
    }
    if (request.method === "POST" && url.pathname === "/recovery") return this.rotateRecovery(request);
    if (request.method === "POST" && url.pathname === "/issue-token") return this.issueToken(request);
    if (request.method === "POST" && url.pathname === "/identity") return this.identity(request);
    if (request.method === "POST" && url.pathname === "/water-guest") return this.waterGuest(request);
    if (request.method === "POST" && url.pathname === "/cheer-guest") return this.cheerGuest(request);
    if (request.method === "POST" && url.pathname === "/destroy") return this.destroy();
    return json({ code: "NOT_FOUND" }, 404);
  }

  // ---------------------------------------------------------------- storage

  /** @brief Reads the whole ledger, or `null` when this garden never registered. */
  private read(): GardenLedger | null {
    const row = this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'ledger'").toArray()[0];
    if (row === undefined) return null;
    const raw = JSON.parse(row.value) as StoredMeta & { patches?: number; unlocked?: number };
    // Old saves keep their planted slots; only the tab count is derived.
    const tabs = deriveTabs(raw);
    const plots = this.readPlots(tabs);
    const stats = raw.stats ?? { planted: 0, harvested: 0, earned: 0, spent: 0 };
    const meta: StoredMeta = {
      ...raw,
      tabs,
      unlockedPatches: deriveUnlockedPatches(raw.unlockedPatches, plots, tabs),
      buildings: {
        coop: raw.buildings?.coop ?? 0,
        barn: raw.buildings?.barn ?? 0,
        pond: raw.buildings?.pond ?? 0,
      },
      animals: {
        coop: raw.animals?.coop ?? [],
        barn: raw.animals?.barn ?? [],
        pond: raw.animals?.pond ?? [],
      },
      farmSettledAt: raw.farmSettledAt ?? raw.updatedAt ?? 0,
      shopStock: raw.shopStock ?? {},
      pondGrowth: raw.pondGrowth ?? 0,
      attachments: raw.attachments ?? {},
      attachmentSettledAt: raw.attachmentSettledAt ?? raw.updatedAt ?? 0,
      toolsSettledAt: raw.toolsSettledAt ?? raw.updatedAt ?? 0,
      pestSettledAt: raw.pestSettledAt ?? raw.updatedAt ?? 0,
      diseaseSettledAt: raw.diseaseSettledAt ?? raw.updatedAt ?? 0,
      hazardSettledAt: raw.hazardSettledAt ?? raw.updatedAt ?? 0,
      damagedPlots: Array.from(
        { length: totalCrops(tabs) },
        (_unused, index) => raw.damagedPlots?.[index] === true,
      ),
      soil: this.readSoil(tabs, raw.soil),
      specialOwned: Math.max(0, Math.min(SPECIAL_SLOTS, raw.specialOwned ?? 0)),
      specialVersion: typeof raw.specialVersion === "number" ? raw.specialVersion : 0,
      specialPatches:
        typeof raw.specialPatches === "number"
          ? Math.max(0, Math.min(SPECIAL_PATCHES, raw.specialPatches))
          : 0,
      specialUnlocked: Array.from({ length: SPECIAL_PATCHES }, (_unused, index) =>
        Math.max(0, Math.min(SPECIAL_PLOTS_PER_PATCH, raw.specialUnlocked?.[index] ?? 0)),
      ),
      specialPlots: Array.from({ length: SPECIAL_SLOTS }, (_unused, index) => {
        const plot = raw.specialPlots?.[index] ?? null;
        return plot === null ? null : { ...plot };
      }),
      greenhousePlots: Array.from({ length: GREENHOUSE_SLOTS }, (_unused, index) => {
        const plot = raw.greenhousePlots?.[index] ?? null;
        return plot === null ? null : { ...plot };
      }),
      hybrids: (raw.hybrids ?? []).map((hybrid) => ({ ...hybrid, parents: [...hybrid.parents] })),
      hybridCounter: typeof raw.hybridCounter === "number" ? raw.hybridCounter : (raw.hybrids?.length ?? 0),
      ...(raw.lastHybridId === undefined ? {} : { lastHybridId: raw.lastHybridId }),
      mushroomTrays: Array.from({ length: MUSHROOM_TRAYS }, (_unused, index) => {
        const tray = raw.mushroomTrays?.[index] ?? null;
        return tray === null ? null : { ...tray, slot: index };
      }),
      mushroomSpawn: raw.mushroomSpawn ?? {},
      lastCrop: raw.lastCrop ?? new Array<SeedId | null>(totalCrops(tabs)).fill(null),
      greenhouse: raw.greenhouse ?? 0,
      pet: raw.pet ?? 0,
      pets: raw.pets ?? {},
      equippedPet: raw.equippedPet ?? null,
      lastHatch: raw.lastHatch ?? "",
      eggCount: raw.eggCount ?? 0,
      eggPity: raw.eggPity ?? 0,
      skills: raw.skills ?? { ...DEFAULT_SKILLS },
      // Saves written before staff levels existed default to a rookie.
      staff: (raw.staff ?? []).map((worker) => ({
        ...worker,
        level: typeof worker.level === "number" ? worker.level : 1,
        xp: typeof worker.xp === "number" ? worker.xp : 0,
      })),
      staffClaims: raw.staffClaims ?? [],
      insuranceUntil: raw.insuranceUntil ?? 0,
      spliceBonus: raw.spliceBonus ?? 0,
      streak: raw.streak ?? 0,
      lastStreakDay: raw.lastStreakDay ?? 0,
      achievements: raw.achievements ?? [],
      collection: raw.collection ?? [],
      codexClaimed: raw.codexClaimed ?? [],
      timeline: raw.timeline ?? [],
      raidLastAt: typeof raw.raidLastAt === "number" ? raw.raidLastAt : 0,
      recipes: raw.recipes ?? [],
      recipeCookedAt: raw.recipeCookedAt ?? {},
      chainStep: typeof raw.chainStep === "number" ? raw.chainStep : 0,
      kitchen: raw.kitchen === true,
      wheelSpins: raw.wheelSpins ?? 0,
      wheelPity: raw.wheelPity ?? 0,
      wheelLast: raw.wheelLast ?? "",
      wheelDay: typeof raw.wheelDay === "number" ? raw.wheelDay : 0,
      prestige: typeof raw.prestige === "number" ? raw.prestige : 0,
      relics: Array.isArray(raw.relics) ? [...raw.relics] : [],
      equippedRelics: Array.isArray(raw.equippedRelics) ? [...raw.equippedRelics] : [],
      petExpeditions: Array.isArray(raw.petExpeditions)
        ? raw.petExpeditions.map((entry) => ({ ...entry }))
        : [],
      petSkillAt: typeof raw.petSkillAt === "number" ? raw.petSkillAt : 0,
      stocks: raw.stocks ?? {},
      prestigeSkills: {
        merchant: raw.prestigeSkills?.merchant ?? 0,
        farmer: raw.prestigeSkills?.farmer ?? 0,
        artisan: raw.prestigeSkills?.artisan ?? 0,
      },
      questDay: typeof raw.questDay === "number" ? raw.questDay : 0,
      questProgress: raw.questProgress ?? {},
      questClaims: raw.questClaims ?? [],
      taxDay: typeof raw.taxDay === "number" ? raw.taxDay : 0,
      taxLast: typeof raw.taxLast === "number" ? raw.taxLast : 0,
      futures: raw.futures ?? [],
      contractClaims: raw.contractClaims ?? [],
      merchantClaims: raw.merchantClaims ?? [],
      weekKey: raw.weekKey ?? weekKeyAt(Date.now()),
      weekEarned: raw.weekEarned ?? 0,
      weekHarvested: raw.weekHarvested ?? 0,
      lastEarned: raw.lastEarned ?? stats.earned,
      lastHarvested: raw.lastHarvested ?? stats.harvested,
      warehouse: raw.warehouse ?? 0,
      machines: raw.machines ?? {},
      // Saves written before ROI tracking have no spent counter.
      stats: {
        planted: stats.planted ?? 0,
        harvested: stats.harvested ?? 0,
        earned: stats.earned ?? 0,
        spent: stats.spent ?? 0,
        tax: stats.tax ?? 0,
      },
      publishedPrestige: typeof raw.publishedPrestige === "number" ? raw.publishedPrestige : 0,
      actionWindow:
        typeof raw.actionWindow === "number" && Number.isFinite(raw.actionWindow) && raw.actionWindow > 0
          ? raw.actionWindow
          : 0,
      actionCount:
        typeof raw.actionCount === "number" && Number.isFinite(raw.actionCount) && raw.actionCount >= 0
          ? raw.actionCount
          : 0,
    };
    const ledger: GardenLedger = {
      ...meta,
      plots,
      trees: this.readTrees(tabs),
      bag: this.readBag(),
    };
    // Older saves were sized for the old 4/6/9/12 ladder: grow the animal lists
    // up to the current level's capacity so the new square ladder fits.
    for (const building of BUILDING_IDS) {
      const level = ledger.buildings[building] ?? 0;
      const capacity = level > 0 ? buildingSlots(building, level) : 0;
      const list = ledger.animals[building] ?? [];
      while (list.length < capacity) list.push(null);
      if (list.length > capacity && capacity > 0) list.length = capacity;
      ledger.animals[building] = list;
    }
    return ledger;
  }

  /**
   * @brief Reads the plot rows into a dense vector for the owned patches.
   * @param patches Owned patch count.
   */
  /** @brief Keeps the soil vector dense and inside `0..100`. */
  private readSoil(tabs: number, stored: unknown): number[] {
    const length = totalCrops(tabs);
    const soil: number[] = new Array<number>(length).fill(SOIL_START);
    if (Array.isArray(stored)) {
      for (let index = 0; index < length; index += 1) {
        const value = stored[index];
        if (typeof value === "number" && Number.isFinite(value)) {
          soil[index] = Math.max(0, Math.min(100, Math.floor(value)));
        }
      }
    }
    return soil;
  }

  private readPlots(tabs: number): (PlotState | null)[] {
    const plots = emptyCrops(tabs);
    const rows = this.sql
      .exec<PlotRow>(
        "SELECT slot, seed, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray, pest, protected_until, favorite, disease, mutation_boost, bad_luck, dead, grow_ms FROM plots",
      )
      .toArray();
    for (const row of rows) {
      plots[row.slot] = {
        slot: row.slot,
        seed: row.seed as SeedId,
        plantedAt: row.planted_at,
        readyAt: row.ready_at,
        effects: parseEffects(row.effect),
        pest: row.pest === 1,
        protectedUntil: row.protected_until,
        ...(row.disease > 0 ? { diseasedAt: row.disease } : {}),
        ...(row.mutation_boost > 0 ? { mutationBoost: row.mutation_boost } : {}),
        ...(row.bad_luck > 0 ? { badLuck: row.bad_luck } : {}),
        watered: row.watered === 1,
        fertilized: row.fertilized === 1,
        harvests: row.harvests,
        fertilizer: parseFertilizer(row.fertilizer),
        spray: parseSpray(row.spray),
        favorite: row.favorite === 1,
        dead: row.dead === 1,
        ...(row.grow_ms > 0 ? { growMs: row.grow_ms } : {}),
      };
    }
    return plots;
  }

  /**
   * @brief Reads the tree rows into a dense vector for the owned patches.
   * @param patches Owned patch count.
   */
  private readTrees(tabs: number): (TreeState | null)[] {
    const trees = emptyTrees(tabs);
    const rows = this.sql
      .exec<TreeRow>(
        "SELECT slot, tree, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray, pest, protected_until, favorite, disease, mutation_boost, bad_luck, dead, grow_ms FROM trees",
      )
      .toArray();
    for (const row of rows) {
      trees[row.slot] = {
        slot: row.slot,
        tree: row.tree as TreeId,
        plantedAt: row.planted_at,
        readyAt: row.ready_at,
        effects: parseEffects(row.effect),
        pest: row.pest === 1,
        protectedUntil: row.protected_until,
        ...(row.disease > 0 ? { diseasedAt: row.disease } : {}),
        ...(row.mutation_boost > 0 ? { mutationBoost: row.mutation_boost } : {}),
        ...(row.bad_luck > 0 ? { badLuck: row.bad_luck } : {}),
        watered: row.watered === 1,
        fertilized: row.fertilized === 1,
        harvests: row.harvests,
        fertilizer: parseFertilizer(row.fertilizer),
        spray: parseSpray(row.spray),
        favorite: row.favorite === 1,
        dead: row.dead === 1,
        ...(row.grow_ms > 0 ? { growMs: row.grow_ms } : {}),
      };
    }
    return trees;
  }

  /** @brief Reads the bag rows into seeds, crops, supplies and products. */
  private readBag(): GardenLedger["bag"] {
    const seeds: Partial<Record<AnySeedId, number>> = {};
    const crops: CropStack[] = [];
    const supplies: Partial<Record<SupplyId, number>> = {};
    const products: ProductStack[] = [];
    const tools: Partial<Record<ToolId, number>> = {};
    const rows = this.sql.exec<BagRow>("SELECT kind, item, qty FROM bag").toArray();
    for (const row of rows) {
      if (row.kind === "seed") {
        seeds[row.item as AnySeedId] = row.qty;
        continue;
      }
      if (row.kind === "supply") {
        supplies[row.item as SupplyId] = row.qty;
        continue;
      }
      if (row.kind === "tool") {
        tools[row.item as ToolId] = row.qty;
        continue;
      }
      if (row.kind === "product") {
        const [product, starPart, ...effectParts] = row.item.split(":");
        const star = Number(starPart);
        const effects = effectParts
          .map((part) => effectById(part)?.id)
          .filter((id): id is EffectId => id !== undefined);
        if (product !== undefined && Number.isInteger(star) && star >= 1 && star <= 5) {
          products.push({
            product: product as ProductStack["product"],
            star,
            ...(effects.length === 0 ? {} : { effects: canonicalEffects(effects) }),
            qty: row.qty,
          });
        }
        continue;
      }
      const parsed = parseCropKey(row.item);
      if (parsed !== null) {
        crops.push({
          item: parsed.item,
          effects: parsed.effects,
          ...(parsed.star > 1 ? { star: parsed.star } : {}),
          ...(row.kind === "cropPest" ? { pest: true } : {}),
          qty: row.qty,
        });
      }
    }
    return { seeds, crops, supplies, products, tools };
  }

  /** @brief Writes a complete ledger atomically, so a crash cannot lose the old one. */
  private write(ledger: GardenLedger): void {
    this.ctx.storage.transactionSync(() => this.writeRows(ledger));
  }

  /** @brief Writes only metadata; used by presence stamps without touching plants. */
  private writeMeta(ledger: GardenLedger): void {
    const { plots: _plots, trees: _trees, bag: _bag, ...meta } = ledger;
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('ledger', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(meta),
    );
  }

  /**
   * @brief Persists the ledger by diffing against the stored rows.
   * @details Every Durable Object write counts against the daily row quota, so
   * the old delete-all-and-reinsert strategy burned it on every action (and on
   * every presence stamp). Only changed rows are written now.
   */
  private writeRows(ledger: GardenLedger): void {
    this.writeMeta(ledger);
    this.syncPlots(ledger.plots);
    this.syncTrees(ledger.trees);
    this.syncBag(ledger.bag);
  }

  /** @brief Writes only the crop rows that actually changed. */
  private syncPlots(plots: readonly (PlotState | null)[]): void {
    const stored = new Map<number, string>();
    for (const row of this.sql.exec<PlotRow>("SELECT * FROM plots").toArray()) {
      stored.set(row.slot, plotRowKey(row));
    }
    const desired = new Map<number, PlotState>();
    for (const plot of plots) {
      if (plot !== null) desired.set(plot.slot, plot);
    }
    for (const slot of stored.keys()) {
      if (!desired.has(slot)) this.sql.exec("DELETE FROM plots WHERE slot = ?", slot);
    }
    for (const [slot, plot] of desired) {
      const key = plotStateKey(plot);
      if (stored.get(slot) === key) continue;
      this.sql.exec(
        `INSERT INTO plots (slot, seed, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray, pest, protected_until, favorite, disease, mutation_boost, bad_luck, dead, grow_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slot) DO UPDATE SET seed = excluded.seed, planted_at = excluded.planted_at,
           ready_at = excluded.ready_at, effect = excluded.effect, watered = excluded.watered,
           fertilized = excluded.fertilized, harvests = excluded.harvests,
           fertilizer = excluded.fertilizer, spray = excluded.spray,
           pest = excluded.pest, protected_until = excluded.protected_until,
           favorite = excluded.favorite, disease = excluded.disease,
           mutation_boost = excluded.mutation_boost, bad_luck = excluded.bad_luck, dead = excluded.dead, grow_ms = excluded.grow_ms`,
        plot.slot,
        plot.seed,
        plot.plantedAt,
        plot.readyAt,
        JSON.stringify(plot.effects),
        plot.watered ? 1 : 0,
        plot.fertilized ? 1 : 0,
        plot.harvests,
        plot.fertilizer === null ? null : JSON.stringify(plot.fertilizer),
        plot.spray === null ? null : JSON.stringify(plot.spray),
        plot.pest ? 1 : 0,
        plot.protectedUntil,
        plot.favorite === true ? 1 : 0,
        plot.diseasedAt ?? 0,
        plot.mutationBoost ?? 0,
        plot.badLuck ?? 0,
        plot.dead === true ? 1 : 0,
        plot.growMs ?? 0,
      );
    }
  }

  /** @brief Writes only the fruit rows that actually changed. */
  private syncTrees(trees: readonly (TreeState | null)[]): void {
    const stored = new Map<number, string>();
    for (const row of this.sql.exec<TreeRow>("SELECT * FROM trees").toArray()) {
      stored.set(row.slot, treeRowKey(row));
    }
    const desired = new Map<number, TreeState>();
    for (const tree of trees) {
      if (tree !== null) desired.set(tree.slot, tree);
    }
    for (const slot of stored.keys()) {
      if (!desired.has(slot)) this.sql.exec("DELETE FROM trees WHERE slot = ?", slot);
    }
    for (const [slot, tree] of desired) {
      const key = treeStateKey(tree);
      if (stored.get(slot) === key) continue;
      this.sql.exec(
        `INSERT INTO trees (slot, tree, planted_at, ready_at, effect, watered, fertilized, harvests, fertilizer, spray, pest, protected_until, favorite, disease, mutation_boost, bad_luck, dead, grow_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slot) DO UPDATE SET tree = excluded.tree, planted_at = excluded.planted_at,
           ready_at = excluded.ready_at, effect = excluded.effect, watered = excluded.watered,
           fertilized = excluded.fertilized, harvests = excluded.harvests,
           fertilizer = excluded.fertilizer, spray = excluded.spray,
           pest = excluded.pest, protected_until = excluded.protected_until,
           favorite = excluded.favorite, disease = excluded.disease,
           mutation_boost = excluded.mutation_boost, bad_luck = excluded.bad_luck, dead = excluded.dead, grow_ms = excluded.grow_ms`,
        tree.slot,
        tree.tree,
        tree.plantedAt,
        tree.readyAt,
        JSON.stringify(tree.effects),
        tree.watered ? 1 : 0,
        tree.fertilized ? 1 : 0,
        tree.harvests,
        tree.fertilizer === null ? null : JSON.stringify(tree.fertilizer),
        tree.spray === null ? null : JSON.stringify(tree.spray),
        tree.pest ? 1 : 0,
        tree.protectedUntil,
        tree.favorite === true ? 1 : 0,
        tree.diseasedAt ?? 0,
        tree.mutationBoost ?? 0,
        tree.badLuck ?? 0,
        tree.dead === true ? 1 : 0,
        tree.growMs ?? 0,
      );
    }
  }

  /** @brief Writes only the bag rows that actually changed. */
  private syncBag(bag: BagState): void {
    const stored = new Map<string, number>();
    for (const row of this.sql.exec<BagRow>("SELECT kind, item, qty FROM bag").toArray()) {
      stored.set(`${row.kind}:${row.item}`, row.qty);
    }
    const desired = new Map<string, number>();
    for (const [supply, qty] of Object.entries(bag.supplies)) {
      if (qty !== undefined && qty > 0) desired.set(`supply:${supply}`, qty);
    }
    for (const [seed, qty] of Object.entries(bag.seeds)) {
      if (qty !== undefined && qty > 0) desired.set(`seed:${seed}`, qty);
    }
    // Infested stacks sell at half price, so their row kind carries the flag.
    for (const stack of bag.crops) {
      const kind = stack.pest === true ? "cropPest" : "crop";
      desired.set(`${kind}:${cropKey(stack.item, stack.effects, stack.star ?? 1)}`, stack.qty);
    }
    for (const stack of bag.products ?? []) {
      const effects = canonicalEffects(stack.effects ?? []);
      const suffix = effects.length === 0 ? "" : `:${effects.join(":")}`;
      desired.set(`product:${stack.product}:${stack.star}${suffix}`, stack.qty);
    }
    for (const [tool, qty] of Object.entries(bag.tools ?? {})) {
      if (qty !== undefined && qty > 0) desired.set(`tool:${tool}`, qty);
    }

    for (const [key, qty] of desired) {
      if (stored.get(key) === qty) continue;
      const [kind, ...rest] = key.split(":");
      this.sql.exec(
        `INSERT INTO bag (kind, item, qty) VALUES (?, ?, ?)
         ON CONFLICT(kind, item) DO UPDATE SET qty = excluded.qty`,
        kind ?? "",
        rest.join(":"),
        qty,
      );
    }
    for (const key of stored.keys()) {
      if (desired.has(key)) continue;
      const [kind, ...rest] = key.split(":");
      this.sql.exec("DELETE FROM bag WHERE kind = ? AND item = ?", kind ?? "", rest.join(":"));
    }
  }

  /** @brief Deletes every row; used to roll back a failed registration. */
  private destroy(): Response {
    for (const table of ["meta", "plots", "trees", "bag", "visitors", "help"]) {
      this.sql.exec(`DELETE FROM ${table}`);
    }
    return json({ ok: true });
  }

  // ------------------------------------------------------------------- auth

  /** @brief Moves coins from the garden into its guild bank. */
  private async donateGuild(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();
    const body = await readJson(request);
    const amount =
      typeof body.amount === "number" ? Math.max(1, Math.min(10_000_000, Math.floor(body.amount))) : 0;
    if (amount < 1 || ledger.coins < amount) return json({ code: "NOT_ENOUGH_COINS" }, 400);
    const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
    const response = await hub.fetch("https://hub/guild/donate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: ledger.playerId, amount }),
    });
    if (!response.ok) return json({ code: "BAD_REQUEST" }, 400);
    const payload = (await response.json()) as { guild?: unknown };
    const next = structuredClone(ledger);
    next.coins -= amount;
    next.stats.spent += amount;
    this.write(next);
    return json({ ok: true, guild: payload.guild, coins: next.coins });
  }

  /**
   * @brief Contributes items from the player's bag toward the guild's shared co-op project.
   * @param request HTTP request containing `{ qty }`.
   * @return Updated guild snapshot and player coins, or error response.
   */
  private async contributeGuild(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();
    const body = await readJson(request);
    const qty = typeof body.qty === "number" ? Math.max(1, Math.min(100, Math.floor(body.qty))) : 1;

    const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
    const mineRes = await hub.fetch(`https://hub/guild/mine?playerId=${encodeURIComponent(ledger.playerId)}`);
    if (!mineRes.ok) return json({ code: "BAD_REQUEST" }, 400);
    const minePayload = (await mineRes.json()) as { guild: GuildSnapshot | null };
    const project = minePayload.guild?.project;
    if (minePayload.guild === null || project === undefined) return json({ code: "BAD_REQUEST" }, 400);

    const next = structuredClone(ledger);
    const haveProd = next.bag.products
      .filter((s) => s.product === project.item)
      .reduce((sum, s) => sum + s.qty, 0);
    if (haveProd < qty) return json({ code: "NO_PRODUCT" }, 400);

    let left = qty;
    next.bag.products = next.bag.products
      .map((stack) => {
        if (left <= 0 || stack.product !== project.item) return stack;
        const take = Math.min(left, stack.qty);
        left -= take;
        return { ...stack, qty: stack.qty - take };
      })
      .filter((stack) => stack.qty > 0);

    const contribRes = await hub.fetch("https://hub/guild/contribute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: ledger.playerId, qty }),
    });
    if (!contribRes.ok) return json({ code: "BAD_REQUEST" }, 400);
    const payload = (await contribRes.json()) as { guild?: unknown };
    const reward = qty * 1_000;
    next.coins += reward;
    next.stats.earned += reward;
    this.write(next);
    return json({ ok: true, guild: payload.guild, coins: next.coins });
  }

  /**
   * @brief Executes a buy or sell stock order against live hub quotes.
   * @param request HTTP request with `{ side: "buy" | "sell", symbol, shares }`.
   * @return Updated garden snapshot and current stock quotes.
   */
  private async tradeStock(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();
    const body = await readJson(request);
    const side = body.side === "sell" ? "sell" : body.side === "buy" ? "buy" : null;
    const symbol = typeof body.symbol === "string" ? body.symbol : "";
    const shares = typeof body.shares === "number" && Number.isInteger(body.shares) ? body.shares : 0;
    if (side === null || stockBySymbol(symbol) === undefined || shares < 1 || shares > 10_000) {
      return json({ code: "BAD_REQUEST" }, 400);
    }

    const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
    const stockRes = await hub.fetch("https://hub/stocks");
    if (!stockRes.ok) return json({ code: "BAD_REQUEST" }, 502);
    const stockData = (await stockRes.json()) as { quotes: StockQuote[] };
    const quote = stockData.quotes.find((q) => q.symbol === symbol);
    if (quote === undefined) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    const next = structuredClone(ledger);
    const portfolio = { ...(next.stocks ?? {}) };
    const current = portfolio[symbol] ?? { shares: 0, avgCostCoins: 0 };
    const totalCoins = quote.coinPrice * shares;

    if (side === "buy") {
      if (next.coins < totalCoins) return json({ code: "NOT_ENOUGH_COINS" }, 400);
      next.coins -= totalCoins;
      next.stats.spent += totalCoins;
      const newShares = current.shares + shares;
      const newAvg = Math.round((current.shares * current.avgCostCoins + totalCoins) / newShares);
      portfolio[symbol] = { shares: newShares, avgCostCoins: newAvg };
    } else {
      if (current.shares < shares) return json({ code: "NO_PRODUCT" }, 400);
      next.coins += totalCoins;
      next.stats.earned += totalCoins;
      const left = current.shares - shares;
      if (left <= 0) delete portfolio[symbol];
      else portfolio[symbol] = { shares: left, avgCostCoins: current.avgCostCoins };
    }

    next.stocks = portfolio;
    next.rev += 1;
    next.updatedAt = now;
    next.lastSeen = now;
    this.write(next);
    const season = this.seasonFor(request, now);
    return json({
      ok: true,
      state: this.snapshotWithStock(next, season),
      quotes: stockData.quotes,
    });
  }

  /** @brief Charges 5% of total coins for one raid strike and forwards damage to the hub boss. */
  private async hitRaid(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();
    const now = Date.now();
    if (now - (ledger.raidLastAt ?? 0) < 60 * 60_000) {
      return json({ code: "TRY_LATER" }, 429);
    }
    const baseCost = raidHitCost(ledger.coins);
    const cost = (ledger.equippedRelics ?? []).includes("phoenixTalisman")
      ? Math.round(baseCost * 0.5)
      : baseCost;
    if (cost <= 0 || ledger.coins < cost) return json({ code: "NOT_ENOUGH_COINS" }, 400);
    const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
    const response = await hub.fetch("https://hub/raid/hit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ damage: RAID_HIT_DAMAGE }),
    });
    if (!response.ok) return json({ code: "TRY_LATER" }, 502);
    const raid = (await response.json()) as Record<string, unknown>;
    const next = structuredClone(ledger);
    next.coins -= cost;
    next.stats.spent += cost;
    next.raidLastAt = now;
    if (raid.defeated === true) {
      next.coins += 1_000_000;
      next.stats.earned += 1_000_000;
    }
    this.write(next);
    return json({ ok: true, raid, coins: next.coins });
  }

  /** @brief Stores one AI-approved custom recipe, capped at twenty. */
  private async learnRecipe(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();
    const body = await readJson(request);
    const inputs = Array.isArray(body.inputs)
      ? body.inputs.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
      : [];
    const output = typeof body.output === "string" ? body.output.trim().slice(0, 40) : "";
    const price =
      typeof body.price === "number" ? Math.max(1, Math.min(5_000_000_000, Math.floor(body.price))) : 0;
    if (inputs.length < 2 || output.length === 0) return json({ code: "BAD_REQUEST" }, 400);
    const id = `${inputs.join("+")}>${output}`.toLowerCase();
    const existing = (ledger.recipes ?? []).find((recipe) => recipe.id === id);
    if (existing !== undefined) return json({ ok: true, recipe: existing });
    if ((ledger.recipes ?? []).length >= 20) return json({ code: "BAD_REQUEST" }, 400);
    const next = structuredClone(ledger);
    const recipe = { id, inputs, output, price, createdAt: Date.now() };
    next.recipes = [...(next.recipes ?? []), recipe].slice(-20);
    next.rev += 1;
    next.updatedAt = recipe.createdAt;
    next.lastSeen = recipe.createdAt;
    this.write(next);
    return json({ ok: true, recipe });
  }

  /** @brief Authenticates one owner request against the stored token digest. */
  private async authorize(request: Request): Promise<GardenLedger | null> {
    const token = request.headers.get(GARDEN_TOKEN_HEADER);
    if (token === null || token.length !== 64) return null;
    const ledger = this.read();
    if (ledger === null) return null;
    const digest = await sha256Hex(token);
    return timingSafeEqualHex(digest, ledger.tokenHash) ? ledger : null;
  }

  /** @brief Standard unauthorized response. */
  private unauthorized(): Response {
    return json({ code: "UNAUTHORIZED" }, 401);
  }

  // --------------------------------------------------------------- lifetime

  /** @brief Registers a brand-new garden and mints its write token. */
  private async register(request: Request): Promise<Response> {
    if (this.read() !== null) return json({ code: "BAD_REQUEST" }, 400);

    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const code = typeof body.code === "string" ? body.code : "";
    const recoveryHash = typeof body.recoveryHash === "string" ? body.recoveryHash : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (playerId.length === 0 || code.length === 0 || recoveryHash.length !== 64 || !nick.ok) {
      return json({ code: "BAD_REQUEST" }, 400);
    }

    const now = Date.now();
    const token = randomToken();
    const ledger = createLedger({
      playerId,
      nick: nick.nick,
      color: sanitizeColor(body.color),
      code,
      tokenHash: await sha256Hex(token),
      recoveryHash,
      now,
    });
    this.write(ledger);
    return json({
      token,
      state: ledgerSnapshot(ledger),
      season: seasonAt(now),
      serverNow: now,
    });
  }

  /**
   * @brief Runs one bounded automation step for a bot garden.
   * @details Called by the BotManager cron with the market header attached.
   * The plan is capped by the brain, every action still goes through the normal
   * rules (coins, stock, patch locks), and the whole tick writes once.
   */
  private async botTick(request: Request): Promise<Response> {
    const secret = this.env.BOT_SECRET;
    if (secret !== undefined && request.headers.get(BOT_HEADER) !== secret) {
      return json({ code: "UNAUTHORIZED" }, 401);
    }
    const ledger = this.read();
    if (ledger === null) return json({ code: "NOT_REGISTERED" }, 404);

    const now = Date.now();
    const season = this.seasonFor(request, now);
    const body = await readJson(request);
    const focusRaw = typeof body.focus === "string" ? body.focus : undefined;
    const focus = focusRaw === undefined ? undefined : (["carrot"] as const).find((id) => id === focusRaw);
    // What the other gardens are growing, forwarded by the BotManager survey.
    const survey: Record<string, number> = {};
    const surveyRaw = body.survey;
    if (surveyRaw !== null && typeof surveyRaw === "object") {
      for (const [id, count] of Object.entries(surveyRaw as Record<string, unknown>)) {
        if (typeof count === "number" && Number.isFinite(count) && count > 0) survey[id] = count;
      }
    }
    const plantedNow = (source: GardenLedger): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const plot of source.plots) {
        if (plot !== null) counts[plot.seed] = (counts[plot.seed] ?? 0) + 1;
      }
      for (const tree of source.trees) {
        if (tree !== null) counts[tree.tree] = (counts[tree.tree] ?? 0) + 1;
      }
      return counts;
    };
    const rng = createRng(hash32(`bot:${ledger.playerId}:${Math.floor(now / 60_000)}`));
    // The five AI bots ask an LLM for a plan first; invalid plans fall back to
    // the deterministic heuristic so a bad model day never stalls the market.
    let aiMeta: {
      used: boolean;
      model?: string;
      error?: string;
      reasoning?: string;
      actions?: string[];
      cot?: string;
    } = { used: false };
    let planned: GardenAction[] | null = null;
    if (body.ai === true) {
      const aiPlan = await planAiActions(this.env, ledger, season, now, survey, fetch, ledger.playerId);
      aiMeta = { used: aiPlan.actions.length > 0, model: aiPlan.model };
      if (aiPlan.error !== null) aiMeta.error = aiPlan.error;
      if (aiPlan.reasoning !== null) aiMeta.reasoning = aiPlan.reasoning;
      if (aiPlan.rawReasoning !== null) aiMeta.cot = aiPlan.rawReasoning;
      if (aiPlan.actions.length > 0) planned = aiPlan.actions;
    }
    const heuristic = planBotActions(ledger, season, now, rng, BOT_ACTION_LIMIT, focus, survey);
    const actions = planned ?? heuristic;
    if (actions.length === 0) {
      return json({ ok: true, actions: 0, coins: ledger.coins, planted: plantedNow(ledger), ai: aiMeta });
    }

    let current = ledger;
    const sold: Record<string, number> = {};
    const bought: Record<string, number> = {};
    for (const action of actions) {
      const result = applyGardenAction(current, { ...action, auto: true }, season, now);
      if (!result.ok) continue;
      const diffSold = soldDiff(current.bag.crops, result.ledger.bag.crops);
      for (const [item, qty] of Object.entries(diffSold)) sold[item] = (sold[item] ?? 0) + qty;
      const diffBought = boughtDiff(action);
      for (const [item, qty] of Object.entries(diffBought)) bought[item] = (bought[item] ?? 0) + qty;
      current = result.ledger;
    }

    if (current.rev !== ledger.rev || current.coins !== ledger.coins) {
      this.write(current);
      if (
        current.coins !== ledger.coins ||
        current.stats.earned !== ledger.stats.earned ||
        current.stats.harvested !== ledger.stats.harvested
      ) {
        await this.publish(current);
      }
    }
    return json({
      ok: true,
      actions: actions.length,
      coins: current.coins,
      earned: current.stats.earned,
      harvested: current.stats.harvested,
      bag: current.bag.crops.length,
      sold,
      bought,
      planted: plantedNow(current),
      ai: { ...aiMeta, actions: actions.map((action) => action.kind) },
    });
  }

  /**
   * @brief Applies the market multipliers the Worker forwarded with the request.
   * @param request Internal request carrying `x-dyno-market` (URI-encoded JSON).
   * @param now Server clock.
   * @details Selling and previews must agree with the shared board, so the season
   * used for rules already includes market pressure.
   */
  private seasonFor(request: Request, now: number): SeasonSnapshot {
    const season = seasonAt(now);
    const raw = request.headers.get(MARKET_HEADER);
    if (raw === null) return season;
    try {
      const payload = JSON.parse(decodeURIComponent(raw)) as {
        sell?: Partial<Record<string, number>>;
        buy?: Partial<Record<string, number>>;
      };
      const clean = (
        source: Partial<Record<string, number>> | undefined,
      ): Partial<Record<string, number>> => {
        const typed: Partial<Record<string, number>> = {};
        for (const [item, value] of Object.entries(source ?? {})) {
          if (typeof value === "number" && Number.isFinite(value)) typed[item] = value;
        }
        return typed;
      };
      let adjusted = applyMarket(season, clean(payload.sell));
      const buy = clean(payload.buy);
      if (Object.keys(buy).length > 0) adjusted = applyBuyMarket(adjusted, buy);
      return adjusted;
    } catch {
      return season;
    }
  }

  /** @brief Snapshot with the shop stock of the live restock only. */
  private snapshotWithStock(ledger: GardenLedger, season: SeasonSnapshot): GardenSnapshot {
    const snapshot = ledgerSnapshot(ledger);
    return {
      ...snapshot,
      shopStock: ledger.shopRestockAt === season.shop.restockAt ? { ...ledger.shopStock } : {},
    };
  }

  /** @brief Returns the owner snapshot and refreshes the presence stamp. */
  private async state(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const now = Date.now();
    const settled = settleStaff(
      settleExtras(
        settleSpecialReset(
          settlePest(
            settleTools(
              settleAttachments(settleFarm(settleMachines(settleThirst(ledger, now), now), now), now),
              now,
            ),
            now,
          ),
          now,
        ),
        now,
      ),
      now,
    );
    if (settled !== ledger) this.write(settled);
    const ledgerNow = settled;
    await this.syncPrestige(ledgerNow);
    if (now - ledgerNow.lastSeen > 60_000) {
      // Presence stamps must not rewrite every plant row: one meta row is enough.
      ledgerNow.lastSeen = now;
      try {
        this.writeMeta(ledgerNow);
      } catch {
        // Out of write quota: a read must still succeed.
      }
    }
    const season = this.seasonFor(request, now);
    return json({
      state: this.snapshotWithStock(ledgerNow, season),
      season,
      serverNow: now,
    });
  }

  /** @brief Applies one owner action against the current revision. */
  private async act(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const body = await readJson(request);
    if (typeof body.rev !== "number" || body.rev !== ledger.rev) {
      return json({ code: "STALE_REV" }, 409);
    }
    const action = parseGardenAction(body.action);
    if (action === null) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    // Gifts move value between two gardens, so they cannot be a pure rule.
    if (
      action.kind === "giftCoins" ||
      action.kind === "giftSeed" ||
      action.kind === "giftSupply" ||
      action.kind === "giftTool"
    ) {
      return this.sendGift(ledger, action, now, request);
    }
    const season = this.seasonFor(request, now);
    // Machines settle after the action, so an explicit collect still finds its
    // finished job; state reads settle them anyway.
    const settled = settleStaff(
      settleExtras(
        settleSpecialReset(
          settlePest(
            settleTools(settleAttachments(settleFarm(settleThirst(ledger, now), now), now), now),
            now,
          ),
          now,
        ),
        now,
      ),
      now,
    );
    const result = applyGardenAction(settled, action as GardenAction, season, now);
    if (!result.ok) return json({ code: result.code }, 400);

    // Claiming and prestiging handle their own bookkeeping.
    const advanced =
      action.kind === "claimQuest" || action.kind === "prestige"
        ? result.ledger
        : advanceQuests(settled, result.ledger, action, now);
    const finalLedger = settleMachines(advanced, now);
    this.write(finalLedger);
    await this.syncPrestige(finalLedger);

    // Big sales echo into the world chat; one message per action at most.
    const beforeCount = settled.sales?.length ?? 0;
    const freshSales = (finalLedger.sales ?? []).slice(beforeCount);
    for (const sale of freshSales.filter((entry) => entry.gross > 0)) {
      await this.recordGlobalSale(finalLedger, sale);
      await this.announceWorldSale(finalLedger, sale);
    }
    // Leaderboard writes cost a row each: water/fertilize/spray never change the
    // published numbers, so only publish when coins, tabs or harvest stats move.
    if (
      finalLedger.coins !== ledger.coins ||
      finalLedger.tabs !== ledger.tabs ||
      finalLedger.stats.earned !== ledger.stats.earned ||
      finalLedger.stats.harvested !== ledger.stats.harvested
    ) {
      await this.publish(finalLedger);
    }
    return json({
      state: this.snapshotWithStock(finalLedger, season),
      season,
      serverNow: now,
      sold: soldDiff(ledger.bag.crops, finalLedger.bag.crops),
      bought: boughtDiff(action),
    });
  }

  /** @brief Appends one sale to the hub's public global log. */
  private async recordGlobalSale(ledger: GardenLedger, entry: SaleRecord): Promise<void> {
    try {
      const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
      await hub.fetch("https://hub/sale", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dyno-sale": this.env.BOT_SECRET ?? "",
        },
        body: JSON.stringify({
          playerId: ledger.playerId,
          code: ledger.code,
          nick: ledger.nick,
          prestige: ledger.prestige,
          ...entry,
        }),
      });
    } catch {
      // The public log must never fail a sale.
    }
  }

  /** @brief Announces a big sale in the public world chat. */
  private async announceWorldSale(ledger: GardenLedger, entry: SaleRecord): Promise<void> {
    try {
      const room = this.env.CHAT_ROOM.get(this.env.CHAT_ROOM.idFromName("world"));
      const effects = (entry.effects ?? []).join("+");
      const star = entry.star === undefined ? "" : ` ${entry.star}★`;
      const bonus = effects.length > 0 ? ` [${effects}]` : "";
      const text =
        `💥 #${ledger.code} ${ledger.nick} vừa bán ${entry.qty}× ${entry.item}${star}${bonus}` +
        ` được ${entry.net.toLocaleString("en-US")}c!`;
      await room.fetch("https://room/announce", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dyno-announce": this.env.BOT_SECRET ?? "",
        },
        body: JSON.stringify({ nick: "world", color: "#d7ba7d", text }),
      });
    } catch {
      // Chat outages must never fail a sale.
    }
  }

  /**
   * @brief Moves coins or goods from this garden to another one.
   * @details The recipient is resolved through the hub's code table, credited
   * first, and only then debited here so a failed transfer never creates value.
   */
  private async sendGift(
    ledger: GardenLedger,
    action: Extract<GardenAction, { kind: "giftCoins" | "giftSeed" | "giftSupply" | "giftTool" }>,
    now: number,
    request: Request,
  ): Promise<Response> {
    if (action.code === ledger.code) return json({ code: "GIFT_SELF" }, 400);

    const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
    const found = await hub.fetch(`https://hub/by-code?code=${encodeURIComponent(action.code)}`);
    if (!found.ok) return json({ code: "BAD_CODE" }, 400);
    const target = (await found.json()) as { playerId?: unknown };
    if (typeof target.playerId !== "string" || target.playerId.length === 0) {
      return json({ code: "BAD_CODE" }, 400);
    }

    const next = structuredClone(ledger);
    let payload: Record<string, unknown>;
    if (action.kind === "giftCoins") {
      if (next.coins < action.amount) return json({ code: "NOT_ENOUGH_COINS" }, 400);
      next.coins -= action.amount;
      payload = { kind: "coins", amount: action.amount };
    } else if (action.kind === "giftSeed") {
      const owned = next.bag.seeds[action.seed] ?? 0;
      if (owned < action.qty) return json({ code: "NO_SEED" }, 400);
      next.bag.seeds[action.seed] = owned - action.qty;
      payload = { kind: "seed", id: action.seed, qty: action.qty };
    } else if (action.kind === "giftSupply") {
      const owned = next.bag.supplies[action.supply] ?? 0;
      if (owned < action.qty) return json({ code: "NO_SUPPLY" }, 400);
      next.bag.supplies[action.supply] = owned - action.qty;
      payload = { kind: "supply", id: action.supply, qty: action.qty };
    } else {
      const tools = (next.bag.tools ??= {});
      const owned = tools[action.tool] ?? 0;
      if (owned < action.qty) return json({ code: "NO_TOOL" }, 400);
      tools[action.tool] = owned - action.qty;
      payload = { kind: "tool", id: action.tool, qty: action.qty };
    }

    const inbox = this.env.GARDEN.get(this.env.GARDEN.idFromName(target.playerId));
    const delivered = await inbox.fetch("https://garden/gift", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [GIFT_HEADER]: this.env.BOT_SECRET ?? "",
      },
      body: JSON.stringify({
        ...payload,
        fromCode: ledger.code,
        fromNick: ledger.nick,
        fromPrestige: ledger.prestige,
      }),
    });
    if (!delivered.ok) {
      const body = (await delivered.json()) as { code?: unknown };
      return json({ code: typeof body.code === "string" ? body.code : "BAD_REQUEST" }, delivered.status);
    }

    next.rev += 1;
    next.updatedAt = now;
    next.lastSeen = now;
    this.write(next);
    if (action.kind === "giftCoins") await this.publish(next);
    const season = this.seasonFor(request, now);
    return json({
      state: this.snapshotWithStock(next, season),
      season,
      serverNow: now,
    });
  }

  /** @brief Credits one incoming gift; internal gardens only. */
  private async giftInbox(request: Request): Promise<Response> {
    const secret = this.env.BOT_SECRET;
    if (secret !== undefined && secret.length > 0 && request.headers.get(GIFT_HEADER) !== secret) {
      return json({ code: "UNAUTHORIZED" }, 401);
    }
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);

    const body = await readJson(request);
    const kind = body.kind;
    const fromPrestige = typeof body.fromPrestige === "number" ? body.fromPrestige : 0;
    if (kind === "coins" && fromPrestige < ledger.prestige) {
      return json({ code: "PRESTIGE_LOCKED" }, 400);
    }
    const now = Date.now();
    const next = structuredClone(ledger);
    if (kind === "coins") {
      const amount = body.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
        return json({ code: "BAD_REQUEST" }, 400);
      }
      next.coins += amount;
    } else if (kind === "seed" || kind === "supply" || kind === "tool") {
      const id = typeof body.id === "string" ? body.id : "";
      const qty = body.qty;
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        return json({ code: "BAD_REQUEST" }, 400);
      }
      if (kind === "seed") {
        if (seedById(id) === undefined) return json({ code: "BAD_REQUEST" }, 400);
        next.bag.seeds[id as SeedId] = (next.bag.seeds[id as SeedId] ?? 0) + qty;
      } else if (kind === "supply") {
        if (supplyById(id) === undefined) return json({ code: "BAD_REQUEST" }, 400);
        next.bag.supplies[id as SupplyId] = (next.bag.supplies[id as SupplyId] ?? 0) + qty;
      } else {
        if (toolById(id) === undefined) return json({ code: "BAD_REQUEST" }, 400);
        next.bag.tools = { ...(next.bag.tools ?? {}) };
        next.bag.tools[id as ToolId] = (next.bag.tools[id as ToolId] ?? 0) + qty;
      }
    } else {
      return json({ code: "BAD_REQUEST" }, 400);
    }
    next.rev += 1;
    next.updatedAt = now;
    this.write(next);
    return json({ ok: true });
  }

  /** @brief Renames the player without touching the garden identity. */
  private async profile(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const body = await readJson(request);
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (!nick.ok) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    ledger.nick = nick.nick;
    ledger.color = sanitizeColor(body.color);
    this.write(ledger);
    await this.publish(ledger);
    return json({ state: ledgerSnapshot(ledger), season: seasonAt(now), serverNow: now });
  }

  /** @brief Mints a new recovery key, invalidating the old one. */
  private async rotateRecovery(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();

    const recovery = randomRecoveryKey();
    ledger.recoveryHash = await sha256Hex(recovery);
    this.write(ledger);
    return json({ recovery });
  }

  /** @brief Exchanges a recovery key digest for a fresh write token. */
  private async issueToken(request: Request): Promise<Response> {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);

    const body = await readJson(request);
    const recoveryHash = typeof body.recoveryHash === "string" ? body.recoveryHash : "";
    if (!timingSafeEqualHex(recoveryHash, ledger.recoveryHash)) {
      return json({ code: "BAD_RECOVERY" }, 400);
    }

    const now = Date.now();
    const token = randomToken();
    ledger.tokenHash = await sha256Hex(token);
    ledger.rev += 1;
    ledger.updatedAt = now;
    ledger.lastSeen = now;
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (nick.ok) ledger.nick = nick.nick;
    if (typeof body.color === "string") ledger.color = sanitizeColor(body.color);
    this.write(ledger);
    await this.publish(ledger);
    return json({ token, state: ledgerSnapshot(ledger), season: seasonAt(now), serverNow: now });
  }

  /** @brief Verifies a token and returns the identity behind it. */
  private async identity(request: Request): Promise<Response> {
    const ledger = await this.authorize(request);
    if (ledger === null) return this.unauthorized();
    return json({ playerId: ledger.playerId, nick: ledger.nick, color: ledger.color });
  }

  // ------------------------------------------------------------------ visits

  /** @brief Public read-only snapshot used by the visit page. */
  private snapshot(): Response {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);
    const now = Date.now();
    return json({ garden: this.visitSnapshot(ledger, now), season: seasonAt(now), serverNow: now });
  }

  /** @brief Builds the public projection of one garden. */
  private visitSnapshot(ledger: GardenLedger, now: number): VisitSnapshot {
    return {
      nick: ledger.nick,
      color: ledger.color,
      code: ledger.code,
      coins: ledger.coins,
      tabs: ledger.tabs,
      unlockedPatches: [...ledger.unlockedPatches],
      plots: ledger.plots.map((plot) => (plot === null ? null : { ...plot })),
      trees: ledger.trees.map((tree) => (tree === null ? null : { ...tree })),
      bag: {
        seeds: { ...ledger.bag.seeds },
        crops: ledger.bag.crops.map((stack) => ({ ...stack })),
        supplies: { ...ledger.bag.supplies },
        products: (ledger.bag.products ?? []).map((stack) => ({ ...stack })),
        tools: { ...ledger.bag.tools },
      },
      buildings: { ...ledger.buildings },
      animals: {
        coop: ledger.animals.coop.map((animal) => (animal === null ? null : { ...animal })),
        barn: ledger.animals.barn.map((animal) => (animal === null ? null : { ...animal })),
        pond: (ledger.animals.pond ?? []).map((animal) => (animal === null ? null : { ...animal })),
      },
      pondGrowth: ledger.pondGrowth ?? 0,
      attachments: { ...(ledger.attachments ?? {}) },
      specialOwned: Math.min(SPECIAL_SLOTS, ledger.specialOwned ?? 0),
      specialPatches: ledger.specialPatches ?? 0,
      specialUnlocked: [...(ledger.specialUnlocked ?? [])],
      specialPlots: (ledger.specialPlots ?? []).map((plot) => (plot === null ? null : { ...plot })),
      greenhousePlots: Array.from({ length: GREENHOUSE_SLOTS }, (_unused, index) => {
        const plot = ledger.greenhousePlots?.[index] ?? null;
        return plot === null ? null : { ...plot };
      }),
      hybrids: (ledger.hybrids ?? []).map((hybrid) => ({ ...hybrid, parents: [...hybrid.parents] })),
      warehouse: {
        level: ledger.warehouse,
        machines: { ...ledger.machines },
      },
      soil: [...ledger.soil],
      extras: extrasSnapshot(ledger),
      skills: {
        farming: { ...ledger.skills.farming },
        ranching: { ...ledger.skills.ranching },
        artisaning: { ...ledger.skills.artisaning },
      },
      stats: { ...ledger.stats },
      sales: (ledger.sales ?? []).map((entry) => ({ ...entry })),
      updatedAt: ledger.updatedAt,
      lastSeen: ledger.lastSeen,
      online: now - ledger.lastSeen < ONLINE_WINDOW_MS,
      visitors: this.visitors(),
    };
  }

  /** @brief Reads the helper log, most recent first. */
  private visitors(): VisitorSummary[] {
    const rows = this.sql
      .exec<VisitorRow>(
        "SELECT player_id, nick, color, visited_at, waters, cheers FROM visitors ORDER BY visited_at DESC LIMIT ?",
        VISITOR_LIMIT,
      )
      .toArray();
    return rows.map((row) => ({
      playerId: row.player_id,
      nick: row.nick,
      color: row.color,
      visitedAt: row.visited_at,
      waters: row.waters,
      cheers: row.cheers,
    }));
  }

  /** @brief Applies one guest watering and records the helper. */
  private async waterGuest(request: Request): Promise<Response> {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);

    const body = await readJson(request);
    const visitorId = typeof body.visitorId === "string" ? body.visitorId : "";
    const slot = body.slot;
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (visitorId.length === 0 || typeof slot !== "number" || !Number.isInteger(slot) || !nick.ok) {
      return json({ code: "BAD_REQUEST" }, 400);
    }
    const target = body.tree === true ? ledger.trees : ledger.plots;
    if (slot < 0 || slot >= target.length) return json({ code: "BAD_REQUEST" }, 400);

    const plant = target[slot] ?? null;
    const now = Date.now();
    if (plant === null) return json({ code: "PLOT_EMPTY" }, 400);
    if (now >= plant.readyAt) return json({ code: "NOT_READY" }, 400);

    const day = Math.floor(now / 86_400_000);
    const helpSlot = body.tree === true ? 100 + slot : slot;
    const helped = this.sql
      .exec<SqlRow<{ one: number }>>(
        "SELECT 1 AS one FROM help WHERE visitor_id = ? AND slot = ? AND day = ?",
        visitorId,
        helpSlot,
        day,
      )
      .toArray();
    if (helped.length > 0) return json({ code: "ALREADY_WATERED" }, 409);

    const remaining = plant.readyAt - now;
    const next = {
      ...plant,
      readyAt: Math.max(now + 1_000, plant.readyAt - Math.round(remaining * GUEST_WATER_CUT_RATIO)),
    };
    if (body.tree === true) ledger.trees[slot] = next as TreeState;
    else ledger.plots[slot] = next as PlotState;
    ledger.rev += 1;
    ledger.updatedAt = now;
    this.sql.exec("INSERT INTO help (visitor_id, slot, day) VALUES (?, ?, ?)", visitorId, helpSlot, day);
    this.recordVisitor(visitorId, nick.nick, sanitizeColor(body.color), now, 1, 0);
    this.write(ledger);
    await this.publish(ledger);
    return json({ garden: this.visitSnapshot(ledger, now), season: seasonAt(now), serverNow: now });
  }

  /** @brief Records one cheer without touching the plots. */
  private async cheerGuest(request: Request): Promise<Response> {
    const ledger = this.read();
    if (ledger === null) return json({ code: "NO_GARDEN" }, 404);

    const body = await readJson(request);
    const visitorId = typeof body.visitorId === "string" ? body.visitorId : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    if (visitorId.length === 0 || !nick.ok) return json({ code: "BAD_REQUEST" }, 400);

    const now = Date.now();
    this.recordVisitor(visitorId, nick.nick, sanitizeColor(body.color), now, 0, 1);
    return json({ garden: this.visitSnapshot(ledger, now), season: seasonAt(now), serverNow: now });
  }

  /** @brief Upserts one visitor row, accumulating helpers. */
  private recordVisitor(
    playerId: string,
    nick: string,
    color: string,
    now: number,
    waters: number,
    cheers: number,
  ): void {
    this.sql.exec(
      `INSERT INTO visitors (player_id, nick, color, visited_at, waters, cheers)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         nick = excluded.nick,
         color = excluded.color,
         visited_at = excluded.visited_at,
         waters = visitors.waters + excluded.waters,
         cheers = visitors.cheers + excluded.cheers`,
      playerId,
      nick,
      color,
      now,
      waters,
      cheers,
    );
  }

  /** @brief Backfills the hub prestige for saves that predate the column. */
  private async syncPrestige(ledger: GardenLedger): Promise<void> {
    if (ledger.prestige === ledger.publishedPrestige) return;
    ledger.publishedPrestige = ledger.prestige;
    try {
      this.writeMeta(ledger);
    } catch {
      // A failed meta write only means we retry on the next state read.
    }
    await this.publish(ledger);
  }

  /** @brief Publishes leaderboard fields to the Hub; failures never block play. */
  private async publish(ledger: GardenLedger): Promise<void> {
    try {
      const hub = this.env.GARDEN_HUB.get(this.env.GARDEN_HUB.idFromName(HUB_NAME));
      await hub.fetch("https://hub/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: ledger.playerId,
          nick: ledger.nick,
          color: ledger.color,
          earned: ledger.stats.earned,
          harvested: ledger.stats.harvested,
          coins: ledger.coins,
          spent: ledger.stats.spent,
          prestige: ledger.prestige,
          weekKey: ledger.weekKey,
          weekEarned: ledger.weekEarned,
          weekHarvested: ledger.weekHarvested,
          now: ledger.updatedAt,
        }),
      });
    } catch {
      // A stale leaderboard row is preferable to a failed harvest.
    }
  }
}

/** @brief Parses an effect cell: a JSON list, or one legacy effect string. */
function parseEffects(raw: string | null): EffectId[] {
  if (raw === null || raw.length === 0) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (Array.isArray(value)) {
      const parsed: EffectId[] = [];
      for (const entry of value) {
        if (typeof entry === "string" && effectById(entry) !== undefined) parsed.push(entry as EffectId);
      }
      return parsed;
    }
    if (typeof value === "string" && effectById(value) !== undefined) return [value as EffectId];
    return [];
  } catch {
    return effectById(raw) === undefined ? [] : [raw as EffectId];
  }
}

/** @brief Parses a stored fertilizer JSON cell. */
function parseFertilizer(raw: string | null): ActiveFertilizer | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; left?: unknown };
    if (typeof value.id !== "string" || typeof value.left !== "number") return null;
    return { id: value.id as ActiveFertilizer["id"], left: value.left };
  } catch {
    return null;
  }
}

/** @brief Parses a stored spray JSON cell. */
function parseSpray(raw: string | null): ActiveSpray | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; left?: unknown };
    if (typeof value.id !== "string" || typeof value.left !== "number") return null;
    return { id: value.id as ActiveSpray["id"], left: value.left };
  } catch {
    return null;
  }
}

/** One row of the public garden directory. */
type GardenRow = SqlRow<{
  player_id: string;
  code: string;
  nick: string;
  color: string;
  earned: number;
  harvested: number;
  coins: number;
  spent: number;
  prestige: number;
  updated_at: number;
  recovery_hash: string;
}>;

type CreateRow = SqlRow<{ window_start: number; count: number }>;

/** @brief Code directory and leaderboard for every garden. */
export class GardenHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gardens (
        player_id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        nick TEXT NOT NULL,
        color TEXT NOT NULL,
        earned INTEGER NOT NULL DEFAULT 0,
        harvested INTEGER NOT NULL DEFAULT 0,
        recovery_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS creates (
        ip TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS global_recipes (
        id TEXT PRIMARY KEY,
        inputs TEXT NOT NULL,
        output TEXT NOT NULL,
        price INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS global_hybrids (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parents TEXT NOT NULL,
        tier TEXT NOT NULL,
        lore TEXT NOT NULL,
        glyph TEXT NOT NULL,
        buy INTEGER NOT NULL,
        upkeep INTEGER NOT NULL,
        interval_cycles INTEGER NOT NULL,
        product TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        bank INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS guild_members (
        player_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        nick TEXT NOT NULL,
        code TEXT NOT NULL,
        joined_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS raids (
        window INTEGER PRIMARY KEY,
        hp INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        code TEXT NOT NULL,
        nick TEXT NOT NULL,
        prestige INTEGER NOT NULL DEFAULT 0,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL,
        star INTEGER,
        effects TEXT,
        gross INTEGER NOT NULL,
        net INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tournament (
        player_id TEXT PRIMARY KEY,
        week_key INTEGER NOT NULL,
        nick TEXT NOT NULL,
        code TEXT NOT NULL,
        earned INTEGER NOT NULL DEFAULT 0,
        harvested INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
    // Bots live in the same table but never reach the human leaderboard.
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(gardens)").toArray();
    if (!columns.some((column) => column.name === "bot")) {
      this.sql.exec("ALTER TABLE gardens ADD COLUMN bot INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "coins")) {
      this.sql.exec("ALTER TABLE gardens ADD COLUMN coins INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE gardens ADD COLUMN spent INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "prestige")) {
      this.sql.exec("ALTER TABLE gardens ADD COLUMN prestige INTEGER NOT NULL DEFAULT 0");
    }
    const guildColumns = this.sql.exec<{ name: string }>("PRAGMA table_info(guilds)").toArray();
    if (!guildColumns.some((column) => column.name === "bank")) {
      this.sql.exec("ALTER TABLE guilds ADD COLUMN bank INTEGER NOT NULL DEFAULT 0");
    }
    if (!guildColumns.some((column) => column.name === "project_item")) {
      this.sql.exec("ALTER TABLE guilds ADD COLUMN project_item TEXT NOT NULL DEFAULT 'cheese'");
      this.sql.exec("ALTER TABLE guilds ADD COLUMN project_target INTEGER NOT NULL DEFAULT 50");
      this.sql.exec("ALTER TABLE guilds ADD COLUMN project_progress INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("ALTER TABLE guilds ADD COLUMN project_completed INTEGER NOT NULL DEFAULT 0");
    }
  }
  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/register") return this.register(request);
    if (request.method === "POST" && url.pathname === "/upsert") return this.upsert(request);
    if (request.method === "GET" && url.pathname === "/by-code") return this.byCode(url);
    if (request.method === "GET" && url.pathname === "/by-recovery") return this.byRecovery(url);
    if (request.method === "GET" && url.pathname === "/leaderboard") return this.leaderboard(url);
    if (request.method === "GET" && url.pathname === "/raid") return this.raid();
    if (request.method === "GET" && url.pathname === "/recipes") return this.globalRecipes();
    if (request.method === "POST" && url.pathname === "/recipes") return this.saveGlobalRecipe(request);
    if (request.method === "GET" && url.pathname === "/fish/hybrids") return this.globalHybrids();
    if (request.method === "POST" && url.pathname === "/fish/hybrids") return this.saveGlobalHybrid(request);
    if (request.method === "POST" && url.pathname === "/guild/create") return this.guildCreate(request);
    if (request.method === "POST" && url.pathname === "/guild/join") return this.guildJoin(request);
    if (request.method === "POST" && url.pathname === "/guild/leave") return this.guildLeave(request);
    if (request.method === "POST" && url.pathname === "/guild/donate") return this.guildDonate(request);
    if (request.method === "POST" && url.pathname === "/guild/contribute") {
      return this.guildContribute(request);
    }
    if (request.method === "GET" && url.pathname === "/guild/mine") return this.guildMine(url);
    if (request.method === "GET" && url.pathname === "/guild/list") return this.guildList();
    if (request.method === "POST" && url.pathname === "/raid/hit") return this.raidHit(request);
    if (request.method === "POST" && url.pathname === "/sale") return this.recordSale(request);
    if (request.method === "GET" && url.pathname === "/sales") return this.sales(url);
    if (request.method === "GET" && url.pathname === "/bots") return this.botList();
    if (request.method === "GET" && url.pathname === "/tournament") return this.tournament(url);
    if (request.method === "GET" && url.pathname === "/stocks") return this.stocks(url);
    if (request.method === "POST" && url.pathname === "/remove") return this.remove(request);
    if (request.method === "GET" && url.pathname === "/info") return this.info();

    return json({ code: "NOT_FOUND" }, 404);
  }

  /** @brief Registers one garden row, enforcing the per-IP create budget. */
  private async register(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const code = typeof body.code === "string" ? body.code : "";
    const recoveryHash = typeof body.recoveryHash === "string" ? body.recoveryHash : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    const ip = typeof body.ip === "string" && body.ip.length > 0 ? body.ip : "unknown";
    const now = typeof body.now === "number" ? body.now : Date.now();
    if (playerId.length === 0 || code.length === 0 || recoveryHash.length !== 64 || !nick.ok) {
      return json({ code: "BAD_REQUEST" }, 400);
    }

    if (!this.allowCreate(ip, now)) return json({ code: "TRY_LATER" }, 429);
    if (this.codeTaken(code)) return json({ code: "CODE_EXISTS" }, 409);

    this.sql.exec(
      "INSERT INTO gardens (player_id, code, nick, color, earned, harvested, recovery_hash, created_at, updated_at, bot) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)",
      playerId,
      code,
      nick.nick,
      sanitizeColor(body.color),
      recoveryHash,
      now,
      now,
      body.bot === true ? 1 : 0,
    );
    return json({ ok: true }, 201);
  }

  /** @brief Updates the leaderboard-visible fields of one garden. */
  private async upsert(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    if (playerId.length === 0) return json({ code: "BAD_REQUEST" }, 400);
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    const earned = typeof body.earned === "number" ? Math.max(0, Math.floor(body.earned)) : 0;
    const harvested = typeof body.harvested === "number" ? Math.max(0, Math.floor(body.harvested)) : 0;
    const coins = typeof body.coins === "number" ? Math.max(0, Math.floor(body.coins)) : 0;
    const spent = typeof body.spent === "number" ? Math.max(0, Math.floor(body.spent)) : 0;
    const prestige = typeof body.prestige === "number" ? Math.max(0, Math.floor(body.prestige)) : 0;
    const now = typeof body.now === "number" ? body.now : Date.now();
    const weekKey = typeof body.weekKey === "number" ? Math.floor(body.weekKey) : 0;
    const weekEarned = typeof body.weekEarned === "number" ? Math.max(0, Math.floor(body.weekEarned)) : 0;
    const weekHarvested =
      typeof body.weekHarvested === "number" ? Math.max(0, Math.floor(body.weekHarvested)) : 0;
    this.sql.exec(
      "UPDATE gardens SET nick = ?, color = ?, earned = ?, harvested = ?, coins = ?, spent = ?, prestige = ?, updated_at = ? WHERE player_id = ?",
      nick.ok ? nick.nick : "",
      sanitizeColor(body.color),
      earned,
      harvested,
      coins,
      spent,
      prestige,
      now,
      playerId,
    );
    if (weekKey > 0) {
      this.sql.exec(
        `INSERT INTO tournament (player_id, week_key, nick, code, earned, harvested, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET week_key = excluded.week_key,
           nick = excluded.nick, code = excluded.code, earned = excluded.earned,
           harvested = excluded.harvested, updated_at = excluded.updated_at`,
        playerId,
        weekKey,
        nick.ok ? nick.nick : "",
        typeof body.code === "string" ? body.code : "",
        weekEarned,
        weekHarvested,
        now,
      );
    }
    return json({ ok: true });
  }

  /** @brief Weekly tournament standings. */
  private tournament(url: URL): Response {
    const raw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isInteger(raw) ? Math.min(100, Math.max(1, raw)) : 20;
    const rows = this.sql
      .exec<SqlRow<{ nick: string; code: string; earned: number; harvested: number; week_key: number }>>(
        "SELECT nick, code, earned, harvested, week_key FROM tournament ORDER BY week_key DESC, earned DESC LIMIT ?",
        limit,
      )
      .toArray();
    return json({
      entries: rows.map((row) => ({
        nick: row.nick,
        code: row.code,
        earned: row.earned,
        harvested: row.harvested,
        weekKey: row.week_key,
      })),
    });
  }

  /** @brief Looks a garden up by its public share code. */
  private byCode(url: URL): Response {
    const code = url.searchParams.get("code") ?? "";
    const row = this.sql.exec<GardenRow>("SELECT player_id FROM gardens WHERE code = ?", code).toArray()[0];
    if (row === undefined) return json({ code: "NO_GARDEN" }, 404);
    return json({ playerId: row.player_id });
  }

  /** @brief Looks a garden up by recovery digest, for restore. */
  private byRecovery(url: URL): Response {
    const hash = url.searchParams.get("hash") ?? "";
    const row = this.sql
      .exec<GardenRow>("SELECT player_id FROM gardens WHERE recovery_hash = ?", hash)
      .toArray()[0];
    if (row === undefined) return json({ code: "BAD_RECOVERY" }, 404);
    return json({ playerId: row.player_id });
  }

  /** @brief Every bot garden, for the separate bots tab. */
  private botList(): Response {
    const rows = this.sql
      .exec<GardenRow>(
        "SELECT code, nick, color, earned, harvested, updated_at FROM gardens WHERE bot = 1 ORDER BY code ASC",
      )
      .toArray();
    return json({
      bots: rows.map((row) => ({
        code: row.code,
        nick: row.nick,
        color: row.color,
        earned: row.earned,
        harvested: row.harvested,
        updatedAt: row.updated_at,
      })),
    });
  }

  /** @brief Public list of AI-discovered global recipes. */
  private globalRecipes(): Response {
    const rows = this.sql
      .exec<SqlRow<{ id: string; inputs: string; output: string; price: number; created_at: number }>>(
        "SELECT id, inputs, output, price, created_at FROM global_recipes ORDER BY created_at DESC LIMIT 60",
      )
      .toArray();
    return json({
      recipes: rows.map((row) => ({
        id: row.id,
        inputs: JSON.parse(row.inputs) as string[],
        output: row.output,
        price: row.price,
        createdAt: row.created_at,
      })),
    });
  }

  /** @brief Stores one AI-discovered global recipe (worker already validated). */
  private async saveGlobalRecipe(request: Request): Promise<Response> {
    const body = await readJson(request);
    const inputs = Array.isArray(body.inputs)
      ? body.inputs.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
      : [];
    const output = typeof body.output === "string" ? body.output.trim().slice(0, 40) : "";
    const price =
      typeof body.price === "number" ? Math.max(1, Math.min(5_000_000_000, Math.floor(body.price))) : 0;
    if (inputs.length < 2 || output.length === 0) return json({ code: "BAD_REQUEST" }, 400);
    const id = `${inputs.join("+")}>${output}`.toLowerCase();
    const createdBy = typeof body.createdBy === "string" ? body.createdBy : "";
    this.sql.exec(
      "INSERT OR IGNORE INTO global_recipes (id, inputs, output, price, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      JSON.stringify(inputs),
      output,
      price,
      createdBy,
      Date.now(),
    );
    return json({
      ok: true,
      recipe: { id, inputs, output, price, createdAt: Date.now() },
    });
  }

  /**
   * @brief Retrieves the public list of AI-discovered global hybrid fish.
   * @return JSON response containing the hybrid fish catalog.
   */
  private globalHybrids(): Response {
    const rows = this.sql
      .exec<
        SqlRow<{
          id: string;
          name: string;
          parents: string;
          tier: string;
          lore: string;
          glyph: string;
          buy: number;
          upkeep: number;
          interval_cycles: number;
          product: string;
          created_by: string;
          created_at: number;
        }>
      >(
        "SELECT id, name, parents, tier, lore, glyph, buy, upkeep, interval_cycles, product, created_by, created_at FROM global_hybrids ORDER BY created_at DESC LIMIT 60",
      )
      .toArray();
    return json({
      hybrids: rows.map((row) => ({
        id: row.id,
        name: row.name,
        parents: JSON.parse(row.parents) as [string, string],
        tier: row.tier as "inferior" | "superior",
        lore: row.lore,
        glyph: row.glyph,
        buy: row.buy,
        upkeep: row.upkeep,
        intervalCycles: row.interval_cycles,
        product: row.product,
        createdBy: row.created_by,
        createdAt: row.created_at,
      })),
    });
  }

  /**
   * @brief Stores one AI-discovered global hybrid fish into the registry.
   * @param request HTTP request containing hybrid fish definition.
   * @return JSON response confirming storage.
   */
  private async saveGlobalHybrid(request: Request): Promise<Response> {
    const body = (await readJson(request)) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
    const parents = Array.isArray(body.parents) ? body.parents.slice(0, 2) : [];
    const tier = body.tier === "inferior" ? "inferior" : "superior";
    const lore = typeof body.lore === "string" ? body.lore.trim().slice(0, 200) : "";
    const glyph = typeof body.glyph === "string" ? body.glyph.slice(0, 4) : "X";
    const buy = typeof body.buy === "number" ? Math.max(1, Math.floor(body.buy)) : 30_000;
    const upkeep = typeof body.upkeep === "number" ? Math.max(0, Math.floor(body.upkeep)) : 50;
    const intervalCycles =
      typeof body.intervalCycles === "number" ? Math.max(1, Math.floor(body.intervalCycles)) : 2;
    const product = typeof body.product === "string" ? body.product : "roe";
    const createdBy = typeof body.createdBy === "string" ? body.createdBy : "";
    const createdAt = typeof body.createdAt === "number" ? body.createdAt : Date.now();

    if (id.length === 0 || name.length === 0 || parents.length < 2) {
      return json({ code: "BAD_REQUEST" }, 400);
    }

    this.sql.exec(
      "INSERT OR REPLACE INTO global_hybrids (id, name, parents, tier, lore, glyph, buy, upkeep, interval_cycles, product, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      name,
      JSON.stringify(parents),
      tier,
      lore,
      glyph,
      buy,
      upkeep,
      intervalCycles,
      product,
      createdBy,
      createdAt,
    );

    return json({
      ok: true,
      hybrid: { id, name, parents, tier, lore, glyph, buy, upkeep, intervalCycles, product, createdAt },
    });
  }

  /** @brief Creates a guild and joins its owner. */
  private async guildCreate(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 24) : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    const code = typeof body.code === "string" ? body.code : "";
    if (playerId.length === 0 || name.length < 2 || !nick.ok || code.length === 0) {
      return json({ code: "BAD_REQUEST" }, 400);
    }
    if (this.guildOf(playerId) !== undefined) return json({ code: "ALREADY_CLAIMED" }, 409);
    const id = `g${hash32(`${playerId}:${name}`).toString(36)}`;
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO guilds (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)",
      id,
      name,
      playerId,
      now,
    );
    this.sql.exec(
      "INSERT INTO guild_members (player_id, guild_id, nick, code, joined_at) VALUES (?, ?, ?, ?, ?)",
      playerId,
      id,
      nick.nick,
      code,
      now,
    );
    return json({ ok: true, guild: this.guildById(id) });
  }

  /** @brief Joins an existing guild. */
  private async guildJoin(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const guildId = typeof body.guildId === "string" ? body.guildId : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    const code = typeof body.code === "string" ? body.code : "";
    if (playerId.length === 0 || guildId.length === 0 || !nick.ok || code.length === 0) {
      return json({ code: "BAD_REQUEST" }, 400);
    }
    if (this.guildOf(playerId) !== undefined) return json({ code: "ALREADY_CLAIMED" }, 409);
    const guild = this.guildById(guildId);
    if (guild === null) return json({ code: "BAD_REQUEST" }, 404);
    this.sql.exec(
      "INSERT INTO guild_members (player_id, guild_id, nick, code, joined_at) VALUES (?, ?, ?, ?, ?)",
      playerId,
      guildId,
      nick.nick,
      code,
      Date.now(),
    );
    return json({ ok: true, guild: this.guildById(guildId) });
  }

  /** @brief Leaves the current guild. */
  private async guildLeave(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const guild = this.guildOf(playerId);
    if (guild === undefined) return json({ code: "NOTHING_TO_DO" }, 400);
    this.sql.exec("DELETE FROM guild_members WHERE player_id = ?", playerId);
    const left = this.sql
      .exec<SqlRow<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM guild_members WHERE guild_id = ?",
        guild,
      )
      .toArray()[0];
    if ((left?.count ?? 0) === 0) this.sql.exec("DELETE FROM guilds WHERE id = ?", guild);
    return json({ ok: true });
  }

  /** @brief Adds coins to a guild's shared bank (worker already charged them). */
  private async guildDonate(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const amount =
      typeof body.amount === "number" ? Math.max(1, Math.min(10_000_000, Math.floor(body.amount))) : 0;
    const guildId = this.guildOf(playerId);
    if (guildId === undefined || amount < 1) return json({ code: "BAD_REQUEST" }, 400);
    this.sql.exec("UPDATE guilds SET bank = bank + ? WHERE id = ?", amount, guildId);
    return json({ ok: true, guild: this.guildById(guildId) });
  }

  /**
   * @brief Advances the shared guild co-op project progress and awards bank bonus on completion.
   * @param request HTTP request with `{ playerId, qty }`.
   * @return Updated GuildSnapshot.
   */
  private async guildContribute(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const qty = typeof body.qty === "number" ? Math.max(1, Math.min(100, Math.floor(body.qty))) : 0;
    const guildId = this.guildOf(playerId);
    if (guildId === undefined || qty < 1) return json({ code: "BAD_REQUEST" }, 400);

    const row = this.sql
      .exec<SqlRow<{ project_target: number; project_progress: number; project_completed: number }>>(
        "SELECT project_target, project_progress, project_completed FROM guilds WHERE id = ?",
        guildId,
      )
      .toArray()[0];
    if (row === undefined) return json({ code: "BAD_REQUEST" }, 404);

    const nextProgress = row.project_progress + qty;
    const newlyCompleted = row.project_completed === 0 && nextProgress >= row.project_target;
    if (newlyCompleted) {
      this.sql.exec(
        "UPDATE guilds SET project_progress = ?, project_completed = 1, bank = bank + 500000 WHERE id = ?",
        nextProgress,
        guildId,
      );
    } else {
      this.sql.exec("UPDATE guilds SET project_progress = ? WHERE id = ?", nextProgress, guildId);
    }
    return json({ ok: true, guild: this.guildById(guildId) });
  }

  /** @brief Guild of one player. */
  private guildMine(url: URL): Response {
    const playerId = url.searchParams.get("playerId") ?? "";
    const guild = this.guildOf(playerId);
    return json({ guild: guild === undefined ? null : this.guildById(guild) });
  }

  /** @brief Public guild list by member count. */
  private guildList(): Response {
    const rows = this.sql
      .exec<
        SqlRow<{
          id: string;
          name: string;
          owner_id: string;
          bank: number;
          created_at: number;
          members: number;
        }>
      >(
        "SELECT g.id, g.name, g.owner_id, g.bank, g.created_at, COUNT(m.player_id) AS members FROM guilds g LEFT JOIN guild_members m ON m.guild_id = g.id GROUP BY g.id ORDER BY members DESC, g.created_at ASC LIMIT 30",
      )
      .toArray();
    return json({
      guilds: rows.map((row) => ({
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        members: row.members,
        bank: row.bank,
        createdAt: row.created_at,
      })),
    });
  }

  /** @brief Guild id for a player, if any. */
  private guildOf(playerId: string): string | undefined {
    return this.sql
      .exec<SqlRow<{ guild_id: string }>>("SELECT guild_id FROM guild_members WHERE player_id = ?", playerId)
      .toArray()[0]?.guild_id;
  }

  private stockCache: { at: number; quotes: StockQuote[] } | null = null;

  /**
   * @brief Fetches a single live stock quote from Yahoo Finance with a deterministic fallback.
   * @param def Static stock definition.
   * @param now Current server timestamp.
   * @return Resolved StockQuote.
   */
  private async fetchLiveStockQuote(def: StockDefinition, now: number): Promise<StockQuote> {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?interval=1d&range=1d`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; DynoFreeChat/1.0)" },
          signal: AbortSignal.timeout(3500),
        },
      );
      if (response.ok) {
        const data = (await response.json()) as {
          chart?: {
            result?: Array<{
              meta?: { regularMarketPrice?: number; chartPreviousClose?: number };
            }>;
          };
        };
        const meta = data.chart?.result?.[0]?.meta;
        const rawPrice = meta?.regularMarketPrice;
        if (typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice > 0) {
          const prev = meta?.chartPreviousClose;
          const changePct =
            typeof prev === "number" && prev > 0 ? Math.round(((rawPrice - prev) / prev) * 10_000) / 100 : 0;
          return {
            symbol: def.symbol,
            name: def.name,
            market: def.market,
            currency: def.currency,
            rawPrice,
            changePct,
            coinPrice: stockCoinPrice(rawPrice, def.currency),
            updatedAt: now,
            source: "live",
          };
        }
      }
    } catch {
      // Upstream unavailable or offline: fall back gracefully below.
    }

    const prevCached = this.stockCache?.quotes.find((q) => q.symbol === def.symbol);
    if (prevCached !== undefined) {
      return { ...prevCached, source: "cached" };
    }
    return {
      symbol: def.symbol,
      name: def.name,
      market: def.market,
      currency: def.currency,
      rawPrice: def.fallbackPrice,
      changePct: 0,
      coinPrice: stockCoinPrice(def.fallbackPrice, def.currency),
      updatedAt: now,
      source: "fallback",
    };
  }

  /**
   * @brief Returns realtime VN and international stock quotes, cached for 60 seconds.
   * @param url Request URL (supports `?refresh=1`).
   * @return JSON response containing `quotes` and `updatedAt`.
   */
  private async stocks(url: URL): Promise<Response> {
    const now = Date.now();
    const force = url.searchParams.get("refresh") === "1";
    if (!force && this.stockCache !== null && now - this.stockCache.at < 60_000) {
      return json({ quotes: this.stockCache.quotes, updatedAt: this.stockCache.at });
    }
    const quotes = await Promise.all(STOCK_CATALOG.map((def) => this.fetchLiveStockQuote(def, now)));
    this.stockCache = { at: now, quotes };
    return json({ quotes, updatedAt: now });
  }

  /** @brief Full guild snapshot with members and co-op project. */
  private guildById(id: string): GuildSnapshot | null {
    const guild = this.sql
      .exec<
        SqlRow<{
          id: string;
          name: string;
          owner_id: string;
          bank: number;
          created_at: number;
          project_item: string;
          project_target: number;
          project_progress: number;
          project_completed: number;
        }>
      >(
        "SELECT id, name, owner_id, bank, created_at, project_item, project_target, project_progress, project_completed FROM guilds WHERE id = ?",
        id,
      )
      .toArray()[0];
    if (guild === undefined) return null;
    const members = this.sql
      .exec<SqlRow<{ player_id: string; nick: string; code: string; joined_at: number }>>(
        "SELECT player_id, nick, code, joined_at FROM guild_members WHERE guild_id = ? ORDER BY joined_at ASC",
        id,
      )
      .toArray();
    return {
      id: guild.id,
      name: guild.name,
      ownerId: guild.owner_id,
      bank: guild.bank,
      createdAt: guild.created_at,
      project: {
        item: (guild.project_item || "cheese") as "cheese",
        target: guild.project_target || 50,
        progress: guild.project_progress || 0,
        completed: guild.project_completed === 1,
        rewardCoins: 500_000,
      },
      members: members.map((member) => ({
        playerId: member.player_id,
        nick: member.nick,
        code: member.code,
        joinedAt: member.joined_at,
      })),
    };
  }

  /** @brief Current shared locust raid. */
  private raid(): Response {
    const now = Date.now();
    const window = raidWindowAt(now);
    const row = this.sql
      .exec<SqlRow<{ hp: number }>>("SELECT hp FROM raids WHERE window = ?", window)
      .toArray()[0];
    if (row === undefined) {
      this.sql.exec("INSERT INTO raids (window, hp, updated_at) VALUES (?, ?, ?)", window, RAID_MAX_HP, now);
    }
    const hp = row?.hp ?? RAID_MAX_HP;
    return json({
      window,
      hp,
      maxHp: RAID_MAX_HP,
      endsAt: raidEndsAt(now),
    });
  }

  /** @brief Applies damage to the shared locust raid. */
  private async raidHit(request: Request): Promise<Response> {
    const body = await readJson(request);
    const damage = typeof body.damage === "number" ? Math.max(1, Math.min(1000, Math.floor(body.damage))) : 0;
    if (damage <= 0) return json({ code: "BAD_REQUEST" }, 400);
    const now = Date.now();
    const window = raidWindowAt(now);
    this.raid();
    this.sql.exec(
      "UPDATE raids SET hp = MAX(0, hp - ?), updated_at = ? WHERE window = ?",
      damage,
      now,
      window,
    );
    const row = this.sql
      .exec<SqlRow<{ hp: number }>>("SELECT hp FROM raids WHERE window = ?", window)
      .toArray()[0];
    const hp = row?.hp ?? 0;
    return json({
      window,
      hp,
      maxHp: RAID_MAX_HP,
      endsAt: raidEndsAt(now),
      defeated: hp <= 0,
    });
  }

  /** @brief Appends one sale to the global public log. */
  private async recordSale(request: Request): Promise<Response> {
    const secret = this.env.BOT_SECRET;
    if (secret !== undefined && secret.length > 0 && request.headers.get("x-dyno-sale") !== secret) {
      return json({ code: "UNAUTHORIZED" }, 401);
    }
    const body = await readJson(request);
    const code = typeof body.code === "string" ? body.code : "";
    const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
    const item = typeof body.item === "string" ? body.item : "";
    if (code.length === 0 || !nick.ok || item.length === 0) return json({ code: "BAD_REQUEST" }, 400);
    this.sql.exec(
      "INSERT INTO sales (player_id, code, nick, prestige, ts, kind, item, qty, star, effects, gross, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      typeof body.playerId === "string" ? body.playerId : "",
      code,
      nick.nick,
      typeof body.prestige === "number" ? Math.max(0, Math.floor(body.prestige)) : 0,
      typeof body.ts === "number" ? body.ts : Date.now(),
      typeof body.kind === "string" ? body.kind : "crop",
      item,
      typeof body.qty === "number" ? Math.max(1, Math.floor(body.qty)) : 1,
      typeof body.star === "number" ? Math.floor(body.star) : null,
      Array.isArray(body.effects) ? JSON.stringify(body.effects) : null,
      typeof body.gross === "number" ? Math.max(0, Math.floor(body.gross)) : 0,
      typeof body.net === "number" ? Math.max(0, Math.floor(body.net)) : 0,
    );
    this.sql.exec("DELETE FROM sales WHERE id NOT IN (SELECT id FROM sales ORDER BY id DESC LIMIT 1000)");
    return json({ ok: true });
  }

  /**
   * @brief Latest public sales for the log tab.
   * @param url Incoming request URL containing query parameters such as limit.
   * @return Response containing array of global sale entries.
   */
  private sales(url: URL): Response {
    const raw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isInteger(raw) ? Math.min(1000, Math.max(1, raw)) : 100;
    const rows = this.sql
      .exec<
        SqlRow<{
          code: string;
          nick: string;
          prestige: number;
          ts: number;
          kind: string;
          item: string;
          qty: number;
          star: number | null;
          effects: string | null;
          gross: number;
          net: number;
        }>
      >(
        "SELECT code, nick, prestige, ts, kind, item, qty, star, effects, gross, net FROM sales ORDER BY id DESC LIMIT ?",
        limit,
      )
      .toArray();
    return json({
      entries: rows.map((row) => ({
        code: row.code,
        nick: row.nick,
        prestige: row.prestige,
        ts: row.ts,
        kind: row.kind,
        item: row.item,
        qty: row.qty,
        ...(row.star === null ? {} : { star: row.star }),
        ...(row.effects === null ? {} : { effects: JSON.parse(row.effects) }),
        gross: row.gross,
        net: row.net,
      })),
    });
  }

  /** @brief Top gardens by earned coins. */
  private leaderboard(url: URL): Response {
    const raw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isInteger(raw) ? Math.min(200, Math.max(1, raw)) : 20;
    const rows = this.sql
      .exec<GardenRow>(
        "SELECT code, nick, color, earned, harvested, coins, spent, prestige, updated_at FROM gardens WHERE bot = 0 ORDER BY earned DESC, harvested DESC, updated_at ASC LIMIT ?",
        limit,
      )
      .toArray();
    const entries: LeaderboardEntry[] = rows.map((row) => ({
      code: row.code,
      nick: row.nick,
      color: row.color,
      earned: row.earned,
      harvested: row.harvested,
      coins: row.coins,
      spent: row.spent,
      prestige: row.prestige,
      updatedAt: row.updated_at,
    }));
    return json({ entries });
  }

  /** @brief Removes one garden row, used to roll back a failed register. */
  private async remove(request: Request): Promise<Response> {
    const body = await readJson(request);
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    if (playerId.length > 0) this.sql.exec("DELETE FROM gardens WHERE player_id = ?", playerId);
    return json({ ok: true });
  }

  /** @brief Small diagnostics payload for tests and maintenance. */
  private info(): Response {
    const rows = this.sql.exec<SqlRow<{ n: number }>>("SELECT COUNT(*) AS n FROM gardens").toArray();
    return json({ gardens: rows[0]?.n ?? 0 });
  }

  /** @brief Whether a code is already taken. */
  private codeTaken(code: string): boolean {
    return this.sql.exec("SELECT 1 FROM gardens WHERE code = ?", code).toArray().length > 0;
  }

  /** @brief Per-IP registration budget, mirroring the room lobby. */
  private allowCreate(ip: string, now: number): boolean {
    const row = this.sql
      .exec<CreateRow>("SELECT window_start, count FROM creates WHERE ip = ?", ip)
      .toArray()[0];
    if (row === undefined || now - row.window_start > REGISTER_WINDOW_MS) {
      this.sql.exec(
        "INSERT INTO creates (ip, window_start, count) VALUES (?, ?, 1) ON CONFLICT(ip) DO UPDATE SET window_start = excluded.window_start, count = 1",
        ip,
        now,
      );
      return true;
    }
    if (row.count >= REGISTERS_PER_WINDOW) return false;
    this.sql.exec("UPDATE creates SET count = count + 1 WHERE ip = ?", ip);
    return true;
  }
}

/** Kept for the wire version check performed by the API layer. */
export const GARDEN_WIRE_VERSION = GARDEN_PROTOCOL_VERSION;

/** Re-exported color default so the API layer has one import point. */
export const GARDEN_DEFAULT_COLOR = DEFAULT_COLOR;
