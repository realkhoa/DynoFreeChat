/**
 * @file staff.spec.ts
 * @brief Hired staff: hiring, wages, slow work and quitting when unpaid.
 */

import { describe, expect, it } from "vitest";
import {
  EPOCH_MS,
  EVENT_WAVE_MS,
  FARM_CYCLE_MS,
  contractOffers,
  seasonAt,
  STAFF_SLOTS,
  staffHireCost,
  staffMarketAt,
  staffWorkInterval,
  type GardenAction,
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

describe("staff", () => {
  it("hires many hands and fills a hundred slots", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    const candidates = staffMarketAt(ledger.playerId, NOW);
    const first = candidates[0];
    if (first === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: first.id });
    expect(hired.ok).toBe(true);
    if (!hired.ok) return;
    expect(hired.ledger.staff).toHaveLength(1);
    expect(hired.ledger.staff[0]).toMatchObject({ level: 1, xp: 0, jobs: first.jobs });
    expect(hired.ledger.coins).toBe(10_000_000 - staffHireCost(first));

    // A hundred slots means the next candidate is still welcome.
    const second = candidates[1];
    if (second === undefined) throw new Error("no second candidate");
    const both = run(hired.ledger, { kind: "hireStaff", id: second.id });
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(both.ledger.staff).toHaveLength(2);

    // Only a full roster refuses.
    const full: GardenLedger = {
      ...both.ledger,
      staff: Array.from({ length: STAFF_SLOTS }, (_unused, index) => ({
        id: `w${index}`,
        name: `W${index}`,
        speed: 1,
        skill: 1,
        wage: 100,
        traits: [],
        jobs: 1,
        role: "gardener" as const,
        level: 1,
        xp: 0,
        lastWorkAt: NOW,
        lastPaidAt: NOW,
        unpaid: 0,
      })),
    };
    expect(run(full, { kind: "hireStaff", id: candidates[2]!.id })).toMatchObject({
      ok: false,
      code: "STAFF_FULL",
    });
  });

  it("harvests ripe crops up to its action count", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    const candidate = staffMarketAt(ledger.playerId, NOW)[1];
    if (candidate === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: candidate.id });
    if (!hired.ok) throw new Error("hire failed");
    const jobs = hired.ledger.staff[0]?.jobs ?? 1;

    for (let slot = 0; slot < 6; slot += 1) {
      hired.ledger.plots[slot] = {
        slot,
        seed: "carrot",
        plantedAt: NOW - 60_000,
        readyAt: NOW - 1_000,
        effects: [],
        watered: true,
        fertilized: false,
        harvests: 0,
        fertilizer: null,
        spray: null,
        pest: false,
        protectedUntil: 0,
      };
    }
    // A pinned ripe crop must never be auto-harvested.
    hired.ledger.plots[0] = { ...hired.ledger.plots[0]!, favorite: true };
    hired.ledger.staff[0] = { ...hired.ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };

    const settled = settleStaff(hired.ledger, NOW + FARM_CYCLE_MS);
    const harvested = settled.bag.crops.reduce((sum, stack) => sum + stack.qty, 0);
    expect(harvested).toBe(Math.min(jobs, 5));
    expect(settled.plots[0]?.favorite).toBe(true);
  });

  it("levels hands up as they finish jobs", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    const candidate = staffMarketAt(ledger.playerId, NOW)[0];
    if (candidate === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: candidate.id });
    if (!hired.ok) throw new Error("hire failed");
    const worker = hired.ledger.staff[0];
    if (worker === undefined) throw new Error("worker missing");

    let current = hired.ledger;
    const interval = staffWorkInterval(worker);
    for (let turn = 0; turn < 12; turn += 1) {
      for (let slot = 0; slot < 12; slot += 1) {
        current.plots[slot] = {
          slot,
          seed: "carrot",
          plantedAt: NOW,
          readyAt: NOW + 10 * 60 * 60_000,
          effects: [],
          watered: false,
          fertilized: false,
          harvests: 0,
          fertilizer: null,
          spray: null,
          pest: false,
          protectedUntil: 0,
        };
      }
      current = settleStaff(current, NOW + (turn + 1) * interval * FARM_CYCLE_MS + 1);
    }
    const grown = current.staff[0];
    expect(grown?.xp ?? 0).toBeGreaterThan(0);
    expect(grown?.level ?? 1).toBeGreaterThan(1);
    expect(staffWorkInterval(grown ?? worker)).toBeLessThan(interval);
  });

  it("does every chore once per cycle and pays wages", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const candidate = staffMarketAt(ledger.playerId, NOW)[0];
    if (candidate === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: candidate.id });
    if (!hired.ok) throw new Error("hire failed");

    // One growing crop to water, one empty plot and seeds to plant.
    hired.ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
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
    // An animal to pet and a machine with an egg ready to load.
    hired.ledger.buildings.coop = 1;
    hired.ledger.animals.coop = [{ kind: "chicken", bornAt: NOW - 60_000, pats: 0, lastProduceAt: NOW }];
    hired.ledger.warehouse = 1;
    hired.ledger.machines = { mayoMaker: { level: 1, lastCraftAt: 0 } };
    hired.ledger.bag.products = [{ product: "egg", star: 1, qty: 1 }];
    hired.ledger.staff[0] = { ...hired.ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };

    const settled = settleStaff(hired.ledger, NOW + FARM_CYCLE_MS);
    expect(settled.plots[0]?.watered).toBe(true);
    expect(settled.bag.seeds.carrot ?? 0).toBeLessThan(3);
    expect(settled.plots[1]?.seed).toBe("carrot");
    expect(settled.animals.coop[0]?.pats).toBeGreaterThan(0);
    expect(settled.bag.products?.some((stack) => stack.product === "mayo")).toBe(true);
    expect(settled.coins).toBeLessThan(hired.ledger.coins);
    expect(settled.staff[0]?.xp ?? 0).toBeGreaterThan(0);
    expect(run(settled, { kind: "fireStaff", index: 0 }).ok).toBe(true);
  });

  it("quits after three unpaid settles", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const candidate = staffMarketAt(ledger.playerId, NOW)[0];
    if (candidate === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: candidate.id });
    if (!hired.ok) throw new Error("hire failed");
    hired.ledger.coins = 0;
    let current = hired.ledger;
    for (let day = 0; day < 3; day += 1) {
      current = settleStaff(current, NOW + (day + 1) * FARM_CYCLE_MS);
    }
    expect(current.staff).toHaveLength(0);
  });
});
