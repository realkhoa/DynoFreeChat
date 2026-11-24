/**
 * @file mine.spec.ts
 * @brief Unit tests for ASCII Garden Mine procedural generation, pickaxe tiers, and elevator checkpoints.
 * @details Verifies deterministic 5x5 floor generation across multiple depths, rock health,
 * ore drops, hidden ladders, elevator checkpoint calculation, and pickaxe progression.
 */

import { describe, expect, it } from "vitest";
import {
  MINE_FLOOR_CELLS,
  PICKAXE_TIERS,
  generateMineFloor,
  initialMineState,
  mineElevatorCheckpoints,
  MACHINES,
  PRODUCTS,
} from "../src/garden";

describe("ASCII Garden Mine core specifications", () => {
  it("defines MINE_FLOOR_CELLS as 25 (5x5 grid)", () => {
    expect(MINE_FLOOR_CELLS).toBe(25);
  });

  it("defines 5 pickaxe tiers with escalating damage and material requirements", () => {
    expect(PICKAXE_TIERS.length).toBe(5);
    expect(PICKAXE_TIERS[0]?.level).toBe(0);
    expect(PICKAXE_TIERS[0]?.damage).toBe(1);
    expect(PICKAXE_TIERS[0]?.cost).toBe(0);

    expect(PICKAXE_TIERS[1]?.level).toBe(1);
    expect(PICKAXE_TIERS[1]?.damage).toBe(2);
    expect(PICKAXE_TIERS[1]?.barType).toBe("copperBar");
    expect(PICKAXE_TIERS[1]?.barCount).toBe(5);

    expect(PICKAXE_TIERS[2]?.level).toBe(2);
    expect(PICKAXE_TIERS[2]?.damage).toBe(3);
    expect(PICKAXE_TIERS[2]?.barType).toBe("ironBar");

    expect(PICKAXE_TIERS[3]?.level).toBe(3);
    expect(PICKAXE_TIERS[3]?.damage).toBe(4);
    expect(PICKAXE_TIERS[3]?.barType).toBe("goldBar");

    expect(PICKAXE_TIERS[4]?.level).toBe(4);
    expect(PICKAXE_TIERS[4]?.damage).toBe(6);
    expect(PICKAXE_TIERS[4]?.barType).toBe("iridiumBar");
  });

  it("calculates elevator checkpoints in increments of 5", () => {
    expect(mineElevatorCheckpoints(1)).toEqual([1]);
    expect(mineElevatorCheckpoints(4)).toEqual([1]);
    expect(mineElevatorCheckpoints(5)).toEqual([1, 5]);
    expect(mineElevatorCheckpoints(9)).toEqual([1, 5]);
    expect(mineElevatorCheckpoints(10)).toEqual([1, 5, 10]);
    expect(mineElevatorCheckpoints(27)).toEqual([1, 5, 10, 15, 20, 25]);
  });

  it("initializes a valid MineState at Floor 1", () => {
    const mine = initialMineState(42);
    expect(mine.currentFloor).toBe(1);
    expect(mine.maxFloor).toBe(1);
    expect(mine.pickaxeLevel).toBe(0);
    expect(mine.stamina).toBe(100);
    expect(mine.maxStamina).toBe(100);
    expect(mine.assignedStaffSlot).toBeNull();
    expect(mine.grid.length).toBe(MINE_FLOOR_CELLS);
  });

  it("generates deterministic 5x5 mine floors with exactly one hidden ladder", () => {
    const floorA = generateMineFloor(5, 12345);
    const floorB = generateMineFloor(5, 12345);
    expect(floorA.length).toBe(25);
    expect(floorA).toEqual(floorB);

    const ladderCount = floorA.filter((cell) => cell.hasLadder === true).length;
    expect(ladderCount).toBe(1);
  });

  it("scales minerals and ores according to floor depth", () => {
    // Floor 5: Early mine - should have copper ore and coal
    const floor5 = generateMineFloor(5, 999);
    const hasCopper = floor5.some((c) => c.kind === "copper" || c.oreDrop === "copperOre");
    expect(hasCopper).toBe(true);

    // Floor 25: Iron depth
    const floor25 = generateMineFloor(25, 888);
    const hasIron = floor25.some((c) => c.kind === "iron" || c.oreDrop === "ironOre");
    expect(hasIron).toBe(true);

    // Floor 50: Gold depth
    const floor50 = generateMineFloor(50, 777);
    const hasGold = floor50.some((c) => c.kind === "gold" || c.oreDrop === "goldOre");
    expect(hasGold).toBe(true);

    // Floor 80: Iridium depth
    const floor80 = generateMineFloor(80, 666);
    const hasIridium = floor80.some((c) => c.kind === "iridium" || c.oreDrop === "iridiumOre");
    expect(hasIridium).toBe(true);
  });

  it("includes smelter machine in MACHINES with recipes for metal bars", () => {
    const smelter = MACHINES.find((m) => m.id === "smelter");
    expect(smelter).toBeDefined();
    expect(smelter?.queued).toBe(true);
    expect(smelter?.input).toEqual({ kind: "product", product: "copperOre" });
    expect(smelter?.output).toEqual({ kind: "product", product: "copperBar" });

    const ironRecipe = smelter?.recipes?.find((r) => r.input === "ironOre");
    expect(ironRecipe?.output).toBe("ironBar");

    const goldRecipe = smelter?.recipes?.find((r) => r.input === "goldOre");
    expect(goldRecipe?.output).toBe("goldBar");

    const iridiumRecipe = smelter?.recipes?.find((r) => r.input === "iridiumOre");
    expect(iridiumRecipe?.output).toBe("iridiumBar");
  });

  it("registers all new ores, bars, and gems in PRODUCTS catalog", () => {
    const expected = [
      "stone",
      "coal",
      "copperOre",
      "ironOre",
      "goldOre",
      "iridiumOre",
      "copperBar",
      "ironBar",
      "goldBar",
      "iridiumBar",
      "amethyst",
      "ruby",
      "emerald",
      "diamond",
      "prismaticShard",
    ];
    for (const id of expected) {
      const def = PRODUCTS.find((p) => p.id === id);
      expect(def).toBeDefined();
      expect(def!.base).toBeGreaterThan(0);
    }
  });
});
