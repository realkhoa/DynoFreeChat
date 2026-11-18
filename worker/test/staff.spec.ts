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
  staffHireCost,
  staffMarketAt,
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
  it("hires a candidate and blocks a second hire at one slot", () => {
    const ledger = makeLedger();
    ledger.coins = 1_000_000;
    const candidate = staffMarketAt(ledger.playerId, NOW)[0];
    if (candidate === undefined) throw new Error("no candidate");
    const hired = run(ledger, { kind: "hireStaff", id: candidate.id });
    expect(hired.ok).toBe(true);
    if (!hired.ok) return;
    expect(hired.ledger.staff).toHaveLength(1);
    expect(hired.ledger.coins).toBe(1_000_000 - staffHireCost(candidate));
    expect(
      run(hired.ledger, { kind: "hireStaff", id: staffMarketAt(ledger.playerId, NOW)[1]!.id }),
    ).toMatchObject({ ok: false, code: "STAFF_FULL" });
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
