/**
 * @file mine.spec.ts
 * @brief Unit tests for ASCII Garden mine actions, pickaxe progression, stamina, and staff miner automation.
 * @details Covers mineHit rock destruction, ladder exposure, mineDescend, elevator fast-travel,
 * pickaxe upgrades consuming smelted bars, food stamina recovery, and staffMine automation.
 */

import { describe, expect, it } from "vitest";
import {
  EPOCH_MS,
  EVENT_WAVE_MS,
  PICKAXE_TIERS,
  seasonAt,
  type GardenAction,
  type ProductId,
} from "@dyno/shared/garden";
import {
  applyGardenAction,
  createLedger,
  ledgerSnapshot,
  settleStaff,
  type GardenLedger,
} from "../src/garden-rules";

const NOW = EPOCH_MS + 2 * EVENT_WAVE_MS + 1_000;

/**
 * @brief Creates a test ledger initialized at NOW.
 * @return GardenLedger instance.
 */
function makeLedger(): GardenLedger {
  return createLedger({
    playerId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    nick: "miner",
    color: "hsl(200 60% 60%)",
    code: "MINE01",
    tokenHash: "0".repeat(64),
    recoveryHash: "1".repeat(64),
    now: NOW,
  });
}

/**
 * @brief Executes a garden action on a ledger.
 * @param ledger Base garden ledger.
 * @param action GardenAction payload.
 * @param at Timestamp.
 * @return RuleResult from applyGardenAction.
 */
function run(ledger: GardenLedger, action: GardenAction, at = NOW): ReturnType<typeof applyGardenAction> {
  return applyGardenAction(ledger, action, seasonAt(at), at, () => 0.5);
}

describe("ASCII Garden Mine action handlers", () => {
  it("initializes mine in ledgerSnapshot correctly", () => {
    const ledger = makeLedger();
    const snap = ledgerSnapshot(ledger);
    expect(snap.mine).toBeDefined();
    expect(snap.mine?.currentFloor).toBe(1);
    expect(snap.mine?.maxFloor).toBe(1);
    expect(snap.mine?.stamina).toBe(100);
    expect(snap.mine?.grid.length).toBe(25);
  });

  it("handles mineHit: deals pickaxe damage and consumes 2 stamina", () => {
    const ledger = makeLedger();
    // Find first rock with HP > 1
    const rockSlot = ledger.mine?.grid.findIndex((c) => c.kind !== "empty" && c.kind !== "ladder") ?? 0;
    const initialHp = ledger.mine?.grid[rockSlot]?.hp ?? 1;

    const res = run(ledger, { kind: "mineHit", slot: rockSlot });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.ledger.mine?.stamina).toBe(98);
    if (initialHp > 1) {
      expect(res.ledger.mine?.grid[rockSlot]?.hp).toBe(initialHp - 1);
    }
  });

  it("rejects mineHit if stamina is insufficient", () => {
    const ledger = makeLedger();
    if (ledger.mine) ledger.mine.stamina = 1;

    const res = run(ledger, { kind: "mineHit", slot: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("NO_STAMINA");
    }
  });

  it("breaks rock and grants drop when HP reaches 0", () => {
    const ledger = makeLedger();
    if (!ledger.mine) return;

    // Set slot 0 to a stone rock with 1 HP dropping copperOre
    ledger.mine.grid[0] = {
      kind: "copper",
      hp: 1,
      maxHp: 1,
      oreDrop: "copperOre",
      dropQty: 2,
      hasLadder: false,
    };

    const res = run(ledger, { kind: "mineHit", slot: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.ledger.mine?.grid[0]?.kind).toBe("empty");
    const copper = res.ledger.bag.products.find((p) => p.product === "copperOre");
    expect(copper?.qty).toBe(2);
    expect(res.ledger.collection).toContain("product:copperOre");
  });

  it("reveals ladder when a rock with hasLadder is cleared", () => {
    const ledger = makeLedger();
    if (!ledger.mine) return;

    ledger.mine.grid[3] = {
      kind: "stone",
      hp: 1,
      maxHp: 1,
      oreDrop: "stone",
      dropQty: 1,
      hasLadder: true,
    };

    const res = run(ledger, { kind: "mineHit", slot: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.ledger.mine?.grid[3]?.kind).toBe("ladder");
  });

  it("rejects mineDescend when no ladder is revealed", () => {
    const ledger = makeLedger();
    // Clear any ladders
    if (ledger.mine) {
      ledger.mine.grid = ledger.mine.grid.map((c) =>
        c.kind === "ladder" ? { kind: "empty", hp: 0, maxHp: 0 } : c,
      );
    }

    const res = run(ledger, { kind: "mineDescend" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("LADDER_LOCKED");
    }
  });

  it("descends to the next floor when ladder is exposed", () => {
    const ledger = makeLedger();
    if (!ledger.mine) return;

    ledger.mine.grid[5] = { kind: "ladder", hp: 0, maxHp: 0 };
    const res = run(ledger, { kind: "mineDescend" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.ledger.mine?.currentFloor).toBe(2);
    expect(res.ledger.mine?.maxFloor).toBe(2);
    expect(res.ledger.mine?.grid.length).toBe(25);
  });

  it("handles mineElevator fast-travel to unlocked checkpoints", () => {
    const ledger = makeLedger();
    if (!ledger.mine) return;

    ledger.mine.maxFloor = 12; // Unlocks floors 1, 5, 10

    // Try jumping to locked floor 15 -> should fail
    const lockedRes = run(ledger, { kind: "mineElevator", targetFloor: 15 });
    expect(lockedRes.ok).toBe(false);
    if (!lockedRes.ok) {
      expect(lockedRes.code).toBe("FLOOR_LOCKED");
    }

    // Jump to unlocked floor 10 -> should succeed
    const jumpRes = run(ledger, { kind: "mineElevator", targetFloor: 10 });
    expect(jumpRes.ok).toBe(true);
    if (!jumpRes.ok) return;

    expect(jumpRes.ledger.mine?.currentFloor).toBe(10);
  });

  it("upgrades pickaxe tier requiring metal bars and coins", () => {
    const ledger = makeLedger();
    ledger.coins = 100_000;
    const tier1 = PICKAXE_TIERS[1];
    expect(tier1?.barType).toBe("copperBar");
    expect(tier1?.barCount).toBe(5);

    // Fail if missing bars
    const failRes = run(ledger, { kind: "upgradePickaxe" });
    expect(failRes.ok).toBe(false);
    if (!failRes.ok) {
      expect(failRes.code).toBe("NO_BARS");
    }

    // Add required copper bars
    ledger.bag.products.push({ product: "copperBar", star: 1, qty: 5 });
    const successRes = run(ledger, { kind: "upgradePickaxe" });
    expect(successRes.ok).toBe(true);
    if (!successRes.ok) return;

    expect(successRes.ledger.mine?.pickaxeLevel).toBe(1);
    expect(successRes.ledger.coins).toBe(100_000 - (tier1?.cost ?? 0));
    const copperBarsLeft = successRes.ledger.bag.products.find((p) => p.product === "copperBar");
    expect(copperBarsLeft).toBeUndefined(); // Consumed all 5
  });

  it("consumes food to restore player stamina with mineEat", () => {
    const ledger = makeLedger();
    if (!ledger.mine) return;
    ledger.mine.stamina = 20;

    // Add some produce
    ledger.bag.products.push({ product: "egg" as ProductId, star: 1, qty: 3 });

    const res = run(ledger, { kind: "mineEat", item: "egg" as ProductId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.ledger.mine?.stamina).toBeGreaterThan(20);
    const eggs = res.ledger.bag.products.find((p) => p.product === "egg");
    expect(eggs?.qty).toBe(2);
  });

  it("assigns staff member to mine and executes automated staff mining", () => {
    const ledger = makeLedger();
    ledger.coins = 10_000_000;
    ledger.staff.push({
      id: "miner-bob",
      name: "Bob",
      role: "water",
      wage: 50,
      level: 1,
      xp: 0,
      speed: 10,
      skill: 10,
      traits: [],
      lastPaidAt: NOW,
      lastWorkAt: NOW - 600_000,
      unpaid: 0,
    });

    // 1. Assign Bob to mine slot 0
    const assignRes = run(ledger, { kind: "assignMiner", staffSlot: 0 });
    expect(assignRes.ok).toBe(true);
    if (!assignRes.ok) return;

    expect(assignRes.ledger.staff[0]?.role).toBe("mine");
    expect(assignRes.ledger.mine?.assignedStaffSlot).toBe(0);

    // 2. Put custom ores + chest + hidden ladder on floor 1 and verify 1 turn mines the entire floor & descends
    const bobLedger = assignRes.ledger;
    if (bobLedger.mine) {
      bobLedger.mine.grid = bobLedger.mine.grid.map((cell, idx) => {
        if (idx === 0) return { kind: "copper", hp: 5, maxHp: 5, oreDrop: "copperOre", dropQty: 2 };
        if (idx === 1) return { kind: "gold", hp: 20, maxHp: 20, oreDrop: "goldOre", dropQty: 3 };
        if (idx === 2) return { kind: "chest", hp: 10, maxHp: 10, hasLadder: true };
        return { kind: "empty", hp: 0, maxHp: 0 };
      });
    }

    const coinsBefore = bobLedger.coins;
    const settled = settleStaff(bobLedger, NOW + 600_000);
    expect(settled.mine?.currentFloor).toBe(2);
    expect(settled.mine?.maxFloor).toBe(2);
    expect(settled.bag.products.find((p) => p.product === "copperOre")?.qty).toBe(2);
    expect(settled.bag.products.find((p) => p.product === "goldOre")?.qty).toBe(3);
    expect(settled.bag.products.find((p) => p.product === "coal")?.qty).toBe(3);
    expect(settled.coins).toBeGreaterThan(coinsBefore);
  });
});
