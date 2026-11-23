/**
 * @file staff.spec.ts
 * @brief Hired staff: four slots, per-task chores, quality-based timing and wages.
 * @details Staff no longer finish a number of jobs per cycle: their quality
 * (speed + skill + level) decides how long one task takes instead.
 */

import { describe, expect, it } from "vitest";
import {
  EPOCH_MS,
  EVENT_WAVE_MS,
  FARM_CYCLE_MS,
  seasonAt,
  STAFF_SLOTS,
  staffHireCost,
  staffMarketAt,
  staffWorkIntervalMs,
  type GardenAction,
  type StaffRole,
} from "@dyno/shared/garden";
import { applyGardenAction, createLedger, settleStaff, type GardenLedger } from "../src/garden-rules";

const NOW = EPOCH_MS + 7 * EVENT_WAVE_MS + 1_000;

function makeLedger(): GardenLedger {
  return createLedger({
    playerId: "staff-test",
    nick: "Staff",
    color: "#4ec9b0",
    code: "ABCDEF",
    tokenHash: "a".repeat(64),
    recoveryHash: "b".repeat(64),
    now: NOW,
  });
}

function run(ledger: GardenLedger, action: GardenAction, at = NOW) {
  return applyGardenAction(ledger, action, seasonAt(at), at, () => 0.5);
}

/** Hires the first market candidate and assigns one task. */
function hireWorker(ledger: GardenLedger, task: StaffRole, candidateIndex = 0): GardenLedger {
  ledger.coins = 10_000_000;
  const candidate = staffMarketAt(ledger.playerId, NOW)[candidateIndex];
  if (candidate === undefined) throw new Error("no candidate");
  const hired = run(ledger, { kind: "hireStaff", id: candidate.id });
  if (!hired.ok) throw new Error("hire failed");
  const assigned = run(hired.ledger, { kind: "setStaffRole", index: 0, role: task });
  if (!assigned.ok) throw new Error("task assign failed");
  return assigned.ledger;
}

/** One growing, unwatered crop. */
function growingPlot(slot: number) {
  return {
    slot,
    seed: "carrot" as const,
    plantedAt: NOW - 60_000,
    readyAt: NOW + 10 * 60 * 60_000,
    effects: [],
    pest: false,
    protectedUntil: 0,
    watered: false,
    fertilized: false,
    harvests: 0,
    fertilizer: null,
    spray: null,
  };
}

describe("staff", () => {
  it("keeps at most four hands and hires with a default harvest task", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    const candidates = staffMarketAt(ledger.playerId, NOW);
    const first = candidates[0];
    if (first === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: first.id });
    expect(hired.ok).toBe(true);
    if (!hired.ok) return;
    expect(hired.ledger.staff).toHaveLength(1);
    expect(hired.ledger.staff[0]).toMatchObject({ level: 1, xp: 0, role: "harvest" });
    expect(hired.ledger.coins).toBe(10_000_000 - staffHireCost(first));

    const full: GardenLedger = {
      ...hired.ledger,
      staff: Array.from({ length: STAFF_SLOTS }, (_unused, index) => ({
        id: `w${index}`,
        name: `W${index}`,
        speed: 1,
        skill: 1,
        wage: 100,
        traits: [],
        role: "water" as const,
        level: 1,
        xp: 0,
        lastWorkAt: NOW,
        lastPaidAt: NOW,
        unpaid: 0,
      })),
    };
    expect(run(full, { kind: "hireStaff", id: candidates[1]!.id })).toMatchObject({
      ok: false,
      code: "STAFF_FULL",
    });
  });

  it("harvests the whole field in one run", () => {
    const ledger = hireWorker(makeLedger(), "harvest");
    for (let slot = 0; slot < 6; slot += 1) {
      ledger.plots[slot] = { ...growingPlot(slot), readyAt: NOW - 1_000, watered: true };
    }
    ledger.plots[0] = { ...ledger.plots[0]!, favorite: true };
    ledger.staff[0] = { ...ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };

    const settled = settleStaff(ledger, NOW + FARM_CYCLE_MS);
    const harvested = settled.bag.crops.reduce((sum, stack) => sum + stack.qty, 0);
    expect(harvested).toBe(5);
  });

  it("runs every ten minutes at the best tier, slower for rookies", () => {
    const cheap = staffWorkIntervalMs({ speed: 1, skill: 1, level: 1, traits: [] });
    const strong = staffWorkIntervalMs({ speed: 5, skill: 5, level: 10, traits: [] });
    expect(strong).toBe(10 * 60_000);
    expect(cheap).toBeGreaterThan(30 * 60_000);
    const normal = staffWorkIntervalMs({ speed: 3, skill: 3, level: 1, traits: [] });
    expect(staffWorkIntervalMs({ speed: 3, skill: 3, level: 1, traits: ["slow"] })).toBe(normal + 8 * 60_000);
    expect(staffWorkIntervalMs({ speed: 3, skill: 3, level: 1, traits: ["diligent"] })).toBe(
      normal - 8 * 60_000,
    );
  });

  it("only does the assigned task", () => {
    const ledger = hireWorker(makeLedger(), "water");
    ledger.plots[0] = growingPlot(0);
    ledger.staff[0] = { ...ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };

    const settled = settleStaff(ledger, NOW + FARM_CYCLE_MS);
    expect(settled.plots[0]?.watered).toBe(true);
    // The waterer never plants, even with seeds in the bag and empty soil.
    expect(settled.bag.seeds.carrot ?? 0).toBe(3);
    expect(settled.plots[1] ?? null).toBeNull();
  });

  it("keeps pinned plants safe and harvests crops without a task", () => {
    const ledger = hireWorker(makeLedger(), "harvest");
    for (let slot = 0; slot < 5; slot += 1) {
      ledger.plots[slot] = { ...growingPlot(slot), readyAt: NOW - 1_000, watered: true };
    }
    ledger.plots[0] = { ...ledger.plots[0]!, favorite: true };
    ledger.staff[0] = { ...ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };

    const settled = settleStaff(ledger, NOW + FARM_CYCLE_MS);
    expect(settled.plots[0]?.favorite).toBe(true);
  });

  it("picks ripe mushroom trays into the product bag", () => {
    const ledger = hireWorker(makeLedger(), "harvestMushroom");
    ledger.mushroomTrays = new Array(27).fill(null);
    ledger.mushroomTrays[0] = {
      slot: 0,
      mushroom: "straw",
      plantedAt: NOW - 20 * 60_000,
      readyAt: NOW - 1_000,
    };
    ledger.mushroomTrays[1] = { ...ledger.mushroomTrays[0]!, slot: 1 };
    ledger.mushroomTrays[2] = {
      slot: 2,
      mushroom: "oyster",
      plantedAt: NOW - 60_000,
      readyAt: NOW + 20 * 60_000,
    };
    ledger.staff[0] = { ...ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };

    const settled = settleStaff(ledger, NOW + FARM_CYCLE_MS);
    expect(settled.mushroomTrays?.[0] ?? null).toBeNull();
    expect(settled.mushroomTrays?.[1] ?? null).toBeNull();
    expect(settled.mushroomTrays?.[2] ?? null).not.toBeNull();
    const stack = (settled.bag.products ?? []).find((entry) => entry.product === "mushStraw");
    expect(stack?.qty).toBe(60);
  });

  it("hunts sales for crops priced well above base", () => {
    const ledger = hireWorker(makeLedger(), "saleHunt");
    ledger.bag.crops = [
      { item: "carrot", effects: ["golden"], qty: 5, star: 1 },
      { item: "potato", effects: ["golden"], qty: 4, star: 1 },
      { item: "parsnip", effects: [], qty: 5, star: 1 },
    ];
    const before = ledger.coins;
    ledger.staff[0] = { ...ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };

    const settled = settleStaff(ledger, NOW + FARM_CYCLE_MS);
    expect(settled.bag.crops.some((stack) => stack.item === "carrot")).toBe(false);
    expect(settled.bag.crops.some((stack) => stack.item === "potato")).toBe(false);
    expect(settled.bag.crops.some((stack) => stack.item === "parsnip")).toBe(true);
    expect(settled.coins).toBeGreaterThan(before - 1_000_000);
  });

  it("levels hands up as they finish tasks", () => {
    const ledger = hireWorker(makeLedger(), "water");
    const worker = ledger.staff[0];
    if (worker === undefined) throw new Error("worker missing");
    let current = ledger;
    const interval = staffWorkIntervalMs(worker);
    for (let turn = 0; turn < 20; turn += 1) {
      current.plots[0] = growingPlot(0);
      current = settleStaff(current, NOW + (turn + 1) * interval + 1);
    }
    const grown = current.staff[0];
    expect(grown?.level ?? 1).toBeGreaterThan(1);
    expect(staffWorkIntervalMs(grown ?? worker)).toBeLessThanOrEqual(interval);
  });

  it("pays wages every cycle and quits after three unpaid settles", () => {
    const ledger = hireWorker(makeLedger(), "water");
    ledger.coins = 1_000_000;
    const paid = settleStaff(ledger, NOW + FARM_CYCLE_MS);
    expect(paid.coins).toBeLessThan(1_000_000);

    paid.coins = 0;
    let current = paid;
    for (let day = 0; day < 3; day += 1) {
      current = settleStaff(current, NOW + FARM_CYCLE_MS * (day + 2));
    }
    expect(current.staff).toHaveLength(0);
  });
});
