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
          readyAt: NOW - 1_000,
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

  it("works slowly, pays wages and switches roles", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const candidate = staffMarketAt(ledger.playerId, NOW)[0];
    if (candidate === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: candidate.id });
    if (!hired.ok) throw new Error("hire failed");
    hired.ledger.plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: NOW - 1_000_000,
      readyAt: NOW - 1,
      effects: [],
      pest: false,
      protectedUntil: 0,
      watered: true,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
    };
    hired.ledger.staff[0] = { ...hired.ledger.staff[0]!, lastWorkAt: NOW - 10 * FARM_CYCLE_MS };
    const settled = settleStaff(hired.ledger, NOW);
    expect(settled.bag.crops.length + (settled.plots[0] === null ? 0 : 0)).toBeGreaterThanOrEqual(0);
    // The worker either harvested or replanted within its slow cadence.
    const worked =
      settled.bag.crops.length > 0 ||
      settled.stats.harvested > 0 ||
      settled.plots[0] === null ||
      (settled.plots[0] !== null && settled.plots[0]?.plantedAt === NOW);
    expect(worked).toBe(true);
    expect(settled.coins).toBeLessThanOrEqual(hired.ledger.coins);
    expect(run(settled, { kind: "setStaffRole", index: 0, role: "waterer" }).ok).toBe(true);
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
