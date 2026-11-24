/**
 * @file fish-pond.spec.ts
 * @brief Unit tests for ASCII Garden multi-basin fish pond architecture and hybrid fish logic.
 * @details Covers 9-slot basin index mapping, single vs mixed-species basin inspection,
 * deterministic hybrid fish generation (inferior vs superior tiers), and codex discovery rewards.
 */

import { describe, expect, it } from "vitest";
import {
  BASE_FISH_SPECIES,
  POND_MAX_SLOTS,
  POND_SLOT_LADDER,
  animalById,
  animalMeatPrice,
  codexReward,
  generateDeterministicHybridFish,
  inspectPondBasin,
  isFishKind,
  pondBasinIndex,
  pondBasinSlot,
  pondBasinSlotRange,
  type AnimalState,
} from "../src/garden";

/**
 * @brief Helper to generate a mock AnimalState representing a pond fish.
 * @param kind Animal ID kind.
 * @param slot Absolute slot index.
 * @param hybridProps Optional hybrid definition parameters.
 * @return Fully formed AnimalState.
 */
function makeTestFish(
  kind: (typeof BASE_FISH_SPECIES)[number] | "hybridFish",
  slot: number,
  hybridProps: Partial<AnimalState> = {},
): AnimalState {
  return {
    kind,
    bornAt: 1_000_000,
    pats: 0,
    lastProduceAt: 1_000_000,
    ...hybridProps,
  };
}

describe("fish pond basin geometry and mapping", () => {
  it("defines POND_MAX_SLOTS as 9 and an 8-level slot ladder", () => {
    expect(POND_MAX_SLOTS).toBe(9);
    expect(POND_SLOT_LADDER).toEqual([9, 18, 27, 36, 45, 54, 63, 72]);
    expect(POND_SLOT_LADDER.every((slots) => slots % POND_MAX_SLOTS === 0)).toBe(true);
  });

  it("maps global slots to basin indices and local slots correctly", () => {
    // Basin 0: slots 0..8
    expect(pondBasinIndex(0)).toBe(0);
    expect(pondBasinSlot(0)).toBe(0);
    expect(pondBasinIndex(8)).toBe(0);
    expect(pondBasinSlot(8)).toBe(8);

    // Basin 1: slots 9..17
    expect(pondBasinIndex(9)).toBe(1);
    expect(pondBasinSlot(9)).toBe(0);
    expect(pondBasinIndex(17)).toBe(1);
    expect(pondBasinSlot(17)).toBe(8);

    // Basin 3: slots 27..35
    expect(pondBasinIndex(30)).toBe(3);
    expect(pondBasinSlot(30)).toBe(3);
  });

  it("computes the slot range [start, endExclusive] for any given basin", () => {
    expect(pondBasinSlotRange(0)).toEqual([0, 9]);
    expect(pondBasinSlotRange(1)).toEqual([9, 18]);
    expect(pondBasinSlotRange(2)).toEqual([18, 27]);
    expect(pondBasinSlotRange(7)).toEqual([63, 72]);
  });
});

describe("pond basin inspection: single species vs mixed", () => {
  it("evaluates empty basin correctly", () => {
    const animals: (AnimalState | null)[] = new Array(18).fill(null);
    const info = inspectPondBasin(animals, 0);

    expect(info.basinIndex).toBe(0);
    expect(info.fish.length).toBe(0);
    expect(info.freeSlots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(info.isSingleSpecies).toBe(false);
    expect(info.isMixedSpecies).toBe(false);
  });

  it("requires at least 2 fish for single-species reproduction", () => {
    const animals: (AnimalState | null)[] = new Array(18).fill(null);
    animals[0] = makeTestFish("carp", 0);
    const info = inspectPondBasin(animals, 0);

    expect(info.fish.length).toBe(1);
    expect(info.isSingleSpecies).toBe(false); // only 1 fish, cannot breed alone
    expect(info.isMixedSpecies).toBe(false);
  });

  it("identifies single-species basin when all fish share the same species", () => {
    const animals: (AnimalState | null)[] = new Array(18).fill(null);
    animals[0] = makeTestFish("sturgeon", 0);
    animals[3] = makeTestFish("sturgeon", 3);
    animals[7] = makeTestFish("sturgeon", 7);
    const info = inspectPondBasin(animals, 0);

    expect(info.fish.length).toBe(3);
    expect(info.species).toEqual(["sturgeon"]);
    expect(info.isSingleSpecies).toBe(true);
    expect(info.isMixedSpecies).toBe(false);
    expect(info.freeSlots).toEqual([1, 2, 4, 5, 6, 8]);
  });

  it("identifies mixed basin when multiple fish species coexist", () => {
    const animals: (AnimalState | null)[] = new Array(18).fill(null);
    animals[0] = makeTestFish("carp", 0);
    animals[1] = makeTestFish("tilapia", 1);
    const info = inspectPondBasin(animals, 0);

    expect(info.fish.length).toBe(2);
    expect(info.isSingleSpecies).toBe(false);
    expect(info.isMixedSpecies).toBe(true);
    expect([...info.species].sort()).toEqual(["carp", "tilapia"]);
  });

  it("isolates basins so fish in basin 1 do not affect basin 0", () => {
    const animals: (AnimalState | null)[] = new Array(18).fill(null);
    // Basin 0 has 2 carps (single-species)
    animals[0] = makeTestFish("carp", 0);
    animals[1] = makeTestFish("carp", 1);
    // Basin 1 has pike and goby (mixed)
    animals[9] = makeTestFish("pike", 9);
    animals[10] = makeTestFish("goby", 10);

    const b0 = inspectPondBasin(animals, 0);
    expect(b0.isSingleSpecies).toBe(true);
    expect(b0.isMixedSpecies).toBe(false);
    expect(b0.species).toEqual(["carp"]);

    const b1 = inspectPondBasin(animals, 1);
    expect(b1.isSingleSpecies).toBe(false);
    expect(b1.isMixedSpecies).toBe(true);
    expect([...b1.species].sort()).toEqual(["goby", "pike"]);
  });
});

describe("base fish catalog & helper identification", () => {
  it("contains all 6 required base species", () => {
    expect(BASE_FISH_SPECIES).toEqual(["sturgeon", "tilapia", "bass", "pike", "carp", "goby"]);
  });

  it("recognizes fish kinds and rejects land animals", () => {
    for (const species of BASE_FISH_SPECIES) {
      expect(isFishKind(species)).toBe(true);
    }
    expect(isFishKind("hybridFish")).toBe(true);
    expect(isFishKind("cow")).toBe(false);
    expect(isFishKind("chicken")).toBe(false);
    expect(isFishKind("duck")).toBe(false);
    expect(isFishKind("snail")).toBe(false);
  });

  it("ensures all 6 base species have valid animal definitions and products", () => {
    for (const id of BASE_FISH_SPECIES) {
      const def = animalById(id);
      expect(def).toBeDefined();
      expect(def?.building).toBe("pond");
      expect(def?.buy).toBeGreaterThan(0);
      expect(def?.product).toBeDefined();
    }
  });
});

describe("deterministic hybrid fish generation", () => {
  it("produces deterministic results given the same parents and seed", () => {
    const first = generateDeterministicHybridFish("sturgeon", "carp", 42);
    const second = generateDeterministicHybridFish("sturgeon", "carp", 42);

    expect(first.id).toBe(second.id);
    expect(first.name).toBe(second.name);
    expect(first.tier).toBe(second.tier);
    expect(first.buy).toBe(second.buy);
    expect(first.glyph).toBe(second.glyph);
  });

  it("generates both inferior and superior tiers with appropriate attributes", () => {
    const hybrids = Array.from({ length: 40 }, (_, index) =>
      generateDeterministicHybridFish("tilapia", "bass", index * 1000 + 7),
    );

    const inferiors = hybrids.filter((h) => h.tier === "inferior");
    const superiors = hybrids.filter((h) => h.tier === "superior");

    expect(inferiors.length).toBeGreaterThan(0);
    expect(superiors.length).toBeGreaterThan(0);

    const INFERIOR_GLYPHS = ["x", "d", "b", "z", "o", "v", "c", "¿"];
    const SUPERIOR_GLYPHS = ["Ж", "♦", "§", "★", "Ω", "Ψ", "♠", "✦", "✪", "♛"];

    for (const inf of inferiors) {
      expect(inf.tier).toBe("inferior");
      expect(inf.buy).toBeLessThanOrEqual(50_000);
      expect(INFERIOR_GLYPHS).toContain(inf.glyph);
    }

    for (const sup of superiors) {
      expect(sup.tier).toBe("superior");
      expect(sup.buy).toBeGreaterThanOrEqual(50_000);
      expect(SUPERIOR_GLYPHS).toContain(sup.glyph);
    }
  });

  it("assigns caviar product to superior sturgeon hybrids", () => {
    const hybrid = generateDeterministicHybridFish("sturgeon", "carp", 12345);
    if (hybrid.tier === "superior") {
      expect(hybrid.product).toBe("caviar");
    } else {
      expect(hybrid.product).toBe("roe");
    }
  });

  it("crossbreeds two hybrid fish into a distinct F2 hybrid without generic names", () => {
    const parentA = generateDeterministicHybridFish("sturgeon", "carp", 11111);
    const parentB = generateDeterministicHybridFish("tilapia", "bass", 22222);

    const child = generateDeterministicHybridFish(
      "hybridFish",
      "hybridFish",
      33333,
      parentA.state,
      parentB.state,
    );

    expect(child.name).not.toBe("Cá Lai");
    expect(child.name).not.toBe("Cá Lai Lai");
    expect(child.name).not.toContain("Lai Lai");
    expect(child.name.length).toBeGreaterThan(5);
    expect(child.id).toMatch(/^hybrid:/);
    expect(child.tier).toMatch(/^(inferior|superior)$/);
    expect(child.state.hybridParents).toEqual(["hybridFish", "hybridFish"]);
    expect(child.state.hybridPrice).toBeGreaterThan(0);
    expect(child.lore.length).toBeGreaterThan(10);
  });

  it("treats basin with 2 hybrid fish as crossbreeding rather than purebred", () => {
    const animals: (AnimalState | null)[] = new Array(18).fill(null);
    const h1 = generateDeterministicHybridFish("sturgeon", "carp", 101);
    const h2 = generateDeterministicHybridFish("bass", "pike", 202);
    animals[0] = h1.state;
    animals[1] = h2.state;

    const info = inspectPondBasin(animals, 0);
    expect(info.isPurebred).toBe(false);
    expect(info.isCrossbreeding).toBe(true);
    expect(info.isSingleSpecies).toBe(false);
    expect(info.isMixedSpecies).toBe(true);
  });
});

describe("meat pricing with hybrid price override", () => {
  it("uses basePriceOverride for hybrid fish", () => {
    const regular = animalMeatPrice("hybridFish", 1, 100, 100_000);
    expect(regular).toBe(100_000);

    const inferior = animalMeatPrice("hybridFish", 1, 100, 15_000);
    expect(inferior).toBe(15_000);
    expect(inferior).toBeLessThan(regular);
  });
});

describe("codex discovery reward keys", () => {
  it("awards 200,000 coins for base fish and 500,000 coins for hybrid fish", () => {
    expect(codexReward("fish:carp")).toBe(200_000);
    expect(codexReward("fish:sturgeon")).toBe(200_000);
    expect(codexReward("fish:goby")).toBe(200_000);

    expect(codexReward("hybrid:carp:sturgeon:abc1234")).toBe(500_000);
    expect(codexReward("hybrid:tilapia:bass:9876543")).toBe(500_000);
  });
});
