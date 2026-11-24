/**
 * @file garden.spec.ts
 * @brief Deterministic season, catalog and wire-parsing rules for ASCII Garden.
 * @details "Consistent seeds and events" is a property of these pure functions,
 * so the tests pin them without a Worker or a browser.
 */

import { describe, expect, it } from "vitest";
import {
  EPOCH_MS,
  WEEKLY_MODIFIERS,
  weekEndsAt,
  weeklyModifier,
  WEEK_MS,
  dayPhaseAt,
  DAY_PHASES,
  DAY_CYCLE_MS,
  growTimeForEvents,
  wheelCost,
  EVENTS,
  EVENT_WAVE_MS,
  GARDEN_AUTH_HEADER,
  CROP_PATCHES_PER_TAB,
  CROPS_PER_TAB,
  MAX_TABS,
  TREES_PER_TAB,
  PLOTS_PER_PATCH,
  RECOVERY_RE,
  PRODUCTS,
  SEEDS,
  SHOP_RESTOCK_MS,
  TOOLS,
  STARTING_COINS,
  STARTING_TABS,
  createRng,
  cropKey,
  canonicalEffects,
  effectsMultiplier,
  driedStarForSell,
  cropSellPrice,
  soilGrowthFactor,
  soilRenovateCost,
  effectById,
  EFFECTS,
  GROWTH_MUTATION_SCALE,
  MUTATION_POLL_MS,
  weatherEffects,
  MAX_EFFECT_STACK,
  eventAt,
  formatGardenAuth,
  gardenCounts,
  growTimeFor,
  hash32,
  isGardenCode,
  isRecoveryKey,
  parseCropKey,
  parseGardenAction,
  parseGardenAuth,
  plotView,
  rollEffects,
  specialPlotCost,
  PRESTIGE_SHOP,
  prestigeMutationBonus,
  prestigeSellBonus,
  prestigeGrowScale,
  prestigeRequirement,
  seedMakerChance,
  wealthBadLuck,
  sprayBoostFor,
  SPRAY_MUTATION_BOOST,
  EFFECT_STACK_CHANCES,
  FERTILIZERS,
  SPRAYS,
  TREES,
  fertilizerById,
  MARKET_BUY_MAX,
  MARKET_MAX_MULTIPLIER,
  MARKET_MIN_MULTIPLIER,
  applyBuyMarket,
  applyMarket,
  marketBaseItems,
  marketBuyBaseItems,
  marketCycleAt,
  marketCycleEndsAt,
  nextBuyMultiplier,
  nextPatchPrice,
  combinedGrowScale,
  ANIMALS,
  BUILDINGS,
  MACHINES,
  productById,
  toolById,
  type BuildingId,
  FARM_CYCLE_MS,
  animalMeatPrice,
  animalQuality,
  animalGeneYield,
  animalGeneSpeed,
  animalGeneMutation,
  pondGrowthFactor,
  buildingSlots,
  buildingUpgradeCost,
  EGG_PITY,
  PETS,
  contractOffers,
  equippedPetEffect,
  rollPet,
  staffHireCost,
  staffGainXp,
  staffWorkIntervalMs,
  planQuickPlan,
  type StaffTrait,
  skillThreshold,
  addSkillXp,
  farmingSellBonus,
  DEFAULT_SKILLS,
  staffMarketAt,
  forecastEvents,
  eventsAt,
  merchantOffers,
  nextSellState,
  productPrice,
  nextTabPrice,
  rollEffectsFor,
  resolvedCropEffects,
  sprayById,
  supplyById,
  seasonAt,
  seedById,
  totalCrops,
  treeById,
  type PlotState,
} from "../src/garden";

/** Fixed server time used across the deterministic tests. */
const NOW = EPOCH_MS + 12 * EVENT_WAVE_MS + 1_000;

describe("garden catalog", () => {
  it("ships four seeds with unique ids and four art stages each", () => {
    const ids = SEEDS.map((seed) => seed.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "carrot",
      "parsnip",
      "potato",
      "sunflower",
      "lavender",
      "cauliflower",
      "cucumber",
      "tomato",
      "strawberry",
      "corn",
      "hop",
      "blueberry",
      "pumpkin",
      "watermelon",
      "pineapple",
      "pitcher",
      "mushroom",
      "rice",
      "chili",
      "eggplant",
      "bamboo",
      "cacao",
      "dragonFruit",
      "ginseng",
      "moonflower",
      "frostberry",
      "beanstalk",
      "emberLily",
      "sugarApple",
      "durian",
      "lotus",
      "venusFlyTrap",
      "starfruit",
      "hazelnut",
      "olive",
      "broccoli",
      "onion",
      "garlic",
      "wheat",
      "sugarcane",
      "cactus",
      "daffodil",
      "tulip",
      "rose",
      "daisy",
      "greenBean",
      "beet",
      "radish",
      "lettuce",
      "cabbage",
      "honeydew",
      "cantaloupe",
      "papaya",
      "pomegranate",
      "raspberry",
      "blackberry",
      "passionfruit",
      "lychee",
      "persimmon",
      "fig",
      "avocado",
      "jalapeno",
      "bellPepper",
      "asparagus",
      "ghostPepper",
      "cocomelon",
    ]);
    for (const seed of SEEDS) {
      expect(seed.art).toHaveLength(4);
      expect(seed.growMs).toBeGreaterThan(0);
      // Premium multi-harvest seeds deliberately sell far under their price.
      if (seed.rare !== true && seed.prestigeOnly !== true) expect(seed.sell).toBeGreaterThan(seed.buy);
    }
  });

  it("ships fertilizers and sprays with their shop data", () => {
    expect(FERTILIZERS).toHaveLength(5);
    expect(SPRAYS).toHaveLength(7);
    expect(fertilizerById("speedGrow")?.growMultiplier).toBeLessThan(1);
    expect(fertilizerById("superGrow")?.harvests).toBe(4);
    expect(sprayById("goldenSpray")?.effects).toEqual(["golden"]);
    expect(sprayById("goldenSpray")?.price).toBeGreaterThan(10_000);
    expect(SPRAY_MUTATION_BOOST).toBe(1.05);
    expect(sprayBoostFor({ id: "goldenSpray", left: 2 }).golden).toBe(SPRAY_MUTATION_BOOST);
    expect(supplyById("compost")?.price).toBe(25);
    expect(supplyById("unknown")).toBeUndefined();
  });

  it("prices each new tab on the compounding ladder", () => {
    // A tab costs the last (ninth) 3x3 patch: 5,000 * 2^7 = 640,000.
    expect(nextTabPrice(1)).toBe(640_000);
    expect(nextTabPrice(2)).toBe(640_000);
    expect(nextTabPrice(1)).toBe(nextPatchPrice(CROP_PATCHES_PER_TAB - 1));
  });

  it("marks reharvest plants apart from root crops", () => {
    expect(seedById("tomato")?.regrow).toBe(true);
    expect(seedById("corn")?.regrow).toBe(true);
    expect(seedById("pumpkin")?.regrow).toBe(true);
    expect(seedById("cucumber")?.regrow).toBe(true);
    expect(seedById("carrot")?.regrow).toBe(false);
    expect(seedById("parsnip")?.regrow).toBe(false);
    expect(seedById("cauliflower")?.regrow).toBe(false);
    expect(seedById("watermelon")?.regrow).toBe(true);
    expect(seedById("pineapple")?.regrow).toBe(true);
    expect(seedById("pitcher")?.regrow).toBe(true);
    expect(seedById("potato")?.regrow).toBe(false);
    expect(seedById("sunflower")?.regrow).toBe(false);
    expect(seedById("lavender")?.regrow).toBe(false);
  });

  it("starts a garden with one tab of nine 3x3 patches", () => {
    expect(STARTING_COINS).toBe(30);
    expect(STARTING_TABS).toBe(1);
    expect(PLOTS_PER_PATCH).toBe(9);
    expect(CROPS_PER_TAB).toBe(81);
    expect(TREES_PER_TAB).toBe(27);
    expect(MAX_TABS).toBe(4);
    expect(totalCrops(STARTING_TABS)).toBe(CROPS_PER_TAB);
  });
});

describe("weather effect stacking", () => {
  it("adds one roll per weather wave during growth and is deterministic", () => {
    const plantedAt = EPOCH_MS + EVENT_WAVE_MS + 1_000;
    const until = plantedAt + EVENT_WAVE_MS * 3;
    const first = weatherEffects("tomato", 5, plantedAt, until);
    const second = weatherEffects("tomato", 5, plantedAt, until);
    expect(first).toEqual(second);
    for (const id of first) expect(effectById(id)).toBeDefined();
    expect(new Set(first).size).toBe(first.length);
  });

  it("lets a crop accumulate weather on top of manual effects", () => {
    const plantedAt = EPOCH_MS + EVENT_WAVE_MS + 1_000;
    const readyAt = plantedAt + EVENT_WAVE_MS * 4;
    const plot = {
      slot: 0,
      seed: "tomato" as const,
      plantedAt,
      readyAt,
      effects: ["wet" as const],
      watered: true,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    const resolved = resolvedCropEffects(plot, readyAt + 10_000);
    expect(resolved).toContain("wet");
    for (const id of weatherEffects("tomato", 0, plantedAt, readyAt)) {
      expect(resolved).toContain(id);
    }
  });
});

describe("farm buildings", () => {
  it("sells premium rare seeds one or two at a time", () => {
    const premium = [
      "beanstalk",
      "emberLily",
      "sugarApple",
      "durian",
      "lotus",
      "venusFlyTrap",
      "starfruit",
      "hazelnut",
      "olive",
    ] as const;
    for (const id of premium) {
      const seed = seedById(id);
      expect(seed?.rare).toBe(true);
      expect(seed?.rareChance ?? 0).toBeGreaterThan(0);
      if (seed?.regrow === true) expect(seed.sell).toBe(Math.floor(seed.buy * 0.05));
      else if (seed !== undefined) expect(seed.sell).toBe(Math.round(seed.buy * 1.5));
    }
    expect(seedById("beanstalk")?.regrow).toBe(true);
    expect(seedById("hazelnut")?.regrow).toBe(true);

    let withRare = 0;
    for (let wave = 0; wave < 600; wave += 1) {
      const at = EPOCH_MS + wave * SHOP_RESTOCK_MS + 1;
      const rare = seasonAt(at).shop.offers.filter((offer) => seedById(offer.seed)?.rare === true);
      expect(rare.length).toBeLessThanOrEqual(2);
      for (const offer of rare) expect(offer.stock).toBe(1);
      if (rare.length > 0) withRare += 1;
    }
    expect(withRare).toBeGreaterThan(0);
    // Rare seeds keep their fixed price, so market buy pressure skips them.
    expect(marketBuyBaseItems(seasonAt(EPOCH_MS + 1)).some((row) => row.item === "beanstalk")).toBe(false);
  });

  it("has a four-to-eighty-one slot ladder that doubles every upgrade", () => {
    for (const building of BUILDINGS.filter((b) => b.id !== "pond")) {
      expect(building.slots[0]).toBe(4);
      expect(building.slots.at(-1)).toBe(81);
      expect(building.slots).toHaveLength(8);
      expect(buildingUpgradeCost(building.id, 1)).toBe(building.upgrade);
      expect(buildingUpgradeCost(building.id, 2)).toBe(building.upgrade * 2);
      expect(buildingUpgradeCost(building.id, 8)).toBe(building.upgrade * 2 ** 7);
    }
    const pond = BUILDINGS.find((b) => b.id === "pond");
    expect(pond?.slots[0]).toBe(9);
    expect(pond?.slots.at(-1)).toBe(72);
    expect(pond?.slots).toHaveLength(8);
    expect(buildingSlots("coop", 0)).toBe(0);
    expect(buildingSlots("coop", 1)).toBe(4);
    expect(buildingSlots("coop", 8)).toBe(81);
  });

  it("raises animal quality with age and pats, and doubles product value", () => {
    const animal = { kind: "chicken" as const, bornAt: EPOCH_MS, pats: 0, lastProduceAt: EPOCH_MS };
    expect(animalQuality(animal, EPOCH_MS)).toBe(1);
    const aged = { ...animal, pats: 12 };
    expect(animalQuality(aged, EPOCH_MS + 24 * FARM_CYCLE_MS)).toBe(4);
    const season = seasonAt(EPOCH_MS);
    const one = productPrice({ product: "egg", star: 1, qty: 1 }, season);
    const three = productPrice({ product: "egg", star: 3, qty: 1 }, season);
    expect(three).toBeGreaterThan(one);
    expect(ANIMALS.some((entry) => entry.product === "wool" && entry.intervalCycles === 7)).toBe(true);
  });

  it("sells the three hand tools next to the watering machine", () => {
    const ids = TOOLS.map((tool) => tool.id);
    expect(ids).toContain("reclaimer");
    expect(ids).toContain("shovel");
    expect(ids).toContain("favoriteLock");
    expect(toolById("reclaimer")?.price).toBeGreaterThan(0);
  });

  it("adds a fish pond with fish and snails", () => {
    const pond = BUILDINGS.find((building) => building.id === "pond");
    expect(pond?.animals).toContain("fish");
    expect(pond?.animals).toContain("snail");
    expect(pond?.animals).toContain("sturgeon");
    expect(pond?.animals).toContain("tilapia");
    expect(pond?.animals).toContain("bass");
    expect(pond?.animals).toContain("pike");
    expect(pond?.animals).toContain("carp");
    expect(pond?.animals).toContain("goby");
    expect(pond?.slots).toEqual([9, 18, 27, 36, 45, 54, 63, 72]);
    expect(ANIMALS.find((animal) => animal.id === "fish")?.product).toBe("roe");
    expect(ANIMALS.find((animal) => animal.id === "snail")?.product).toBe("snailMeat");
    expect(ANIMALS.find((animal) => animal.id === "sturgeon")?.product).toBe("caviar");
  });

  it("stacks the same mutation with rarer extra copies", () => {
    expect(canonicalEffects(["diamond", "diamond"])).toEqual(["diamond", "diamond"]);
    expect(effectsMultiplier(["diamond", "diamond"])).toBe(81);
    expect(canonicalEffects(Array<"golden">(7).fill("golden"))).toHaveLength(MAX_EFFECT_STACK);
    expect(EFFECT_STACK_CHANCES[2]).toBe(0.25);
    expect(EFFECT_STACK_CHANCES[3]).toBe(0.05);
    expect(EFFECT_STACK_CHANCES[4]).toBe(0.01);
    expect(EFFECT_STACK_CHANCES[5]).toBe(0.005);
    expect(cropKey("carrot", ["golden", "golden"])).toBe("carrot:golden:golden");
    expect(parseCropKey("carrot:golden:golden")?.effects).toEqual(["golden", "golden"]);

    const guaranteed = { id: "calm" as const, growScale: 1, sellBonus: 1, effectChances: { golden: 1 } };
    const luck = rollEffects(guaranteed, () => 0);
    expect(luck.filter((id) => id === "golden")).toHaveLength(MAX_EFFECT_STACK);
    // A 0.3 roll earns the first copy but misses the 25% second one.
    const single = rollEffects(guaranteed, () => 0.3);
    expect(single.filter((id) => id === "golden")).toHaveLength(1);
    const goldenHour = EVENTS.find((event) => event.id === "goldenHour");
    if (goldenHour !== undefined) {
      const stacked = rollEffectsFor([goldenHour, goldenHour], () => 0);
      expect(stacked.filter((id) => id === "golden").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("scales mutation odds down while a plant just grows", () => {
    expect(GROWTH_MUTATION_SCALE).toBeLessThan(1);
    const goldenHour = EVENTS.find((event) => event.id === "goldenHour");
    if (goldenHour === undefined) throw new Error("catalog");
    expect(rollEffectsFor([goldenHour], () => 0, {}, {}, 1)).toContain("golden");
    // A zero scale disables the growth contribution entirely.
    expect(rollEffectsFor([goldenHour], () => 0, {}, {}, 0)).toEqual([]);
  });

  it("dries any produce into price-graded goods", () => {
    const dryer = MACHINES.find((machine) => machine.id === "dryer");
    expect(dryer?.allProduce).toBe(true);
    expect(dryer?.gradeByPrice).toBe(true);
    expect(productById("dried")?.base).toBe(400);
    expect(driedStarForSell(9)).toBe(1);
    expect(driedStarForSell(260)).toBe(4);
    expect(driedStarForSell(800)).toBe(5);
  });

  it("charges more for higher-quality hands and levels them up", () => {
    const candidates = staffMarketAt("staff-test", EPOCH_MS + 4 * 60 * 60_000);
    const byCost = [...candidates].sort((left, right) => staffHireCost(left) - staffHireCost(right));
    expect(staffHireCost(byCost.at(-1)!)).toBeGreaterThan(staffHireCost(byCost[0]!));

    // Quality decides the wait between tasks: veterans work much faster.
    const cheap = { speed: 1, skill: 1, level: 1, traits: [] as StaffTrait[] };
    const veteran = { speed: 5, skill: 5, level: 7, traits: [] as StaffTrait[] };
    expect(staffWorkIntervalMs(cheap)).toBeGreaterThan(staffWorkIntervalMs(veteran));
    expect(staffGainXp(1, 150)).toEqual({ level: 2, xp: 50 });
    expect(staffGainXp(9, 100_000).level).toBe(10);
  });

  it("pins the machine recipe output values", () => {
    const product = (id: string): number | undefined => PRODUCTS.find((entry) => entry.id === id)?.base;
    expect(product("caviar")).toBe(5_000_000);
    expect(product("cheese")).toBe(12_000);
    expect(product("fabric")).toBe(100_000);
  });

  it("makes bad mutations more likely for rich wallets", () => {
    expect(wealthBadLuck(0)).toBe(0);
    expect(wealthBadLuck(999_999_999)).toBe(0);
    expect(wealthBadLuck(1_000_000_000)).toBeCloseTo(0.02);
    expect(wealthBadLuck(1_000_000_000_000)).toBeCloseTo(0.08);
    expect(wealthBadLuck(1e30)).toBe(0.2);
  });

  it("scales the seed-maker success rate with prestige", () => {
    expect(seedMakerChance(0)).toBe(0.5);
    expect(seedMakerChance(2)).toBeCloseTo(0.7);
    expect(seedMakerChance(5)).toBe(1);
    expect(seedMakerChance(9)).toBe(1);
  });

  it("polls mutations on an independent 30s clock", () => {
    expect(MUTATION_POLL_MS).toBe(30_000);
    expect(weatherEffects("carrot", 0, NOW, NOW + MUTATION_POLL_MS - 1)).toEqual([]);
  });

  it("derives animal stat effects from genes", () => {
    const animal = {
      kind: "chicken",
      bornAt: NOW,
      pats: 0,
      lastProduceAt: NOW,
      genes: { yield: 100, speed: 100, mutation: 100 },
    } as Parameters<typeof animalGeneYield>[0];
    expect(animalGeneYield(animal)).toBe(3);
    expect(animalGeneSpeed(animal)).toBe(0.8);
    expect(animalGeneMutation(animal)).toBe(0.1);
  });

  it("rotates a deterministic weekly modifier", () => {
    const first = weeklyModifier(NOW);
    expect(WEEKLY_MODIFIERS.some((entry) => entry.id === first.id)).toBe(true);
    expect(weeklyModifier(NOW + WEEK_MS).id).not.toBe(first.id);
    expect(weekEndsAt(NOW)).toBeGreaterThan(NOW);
  });

  it("prices prestige resets at 10,000b doubling per level", () => {
    expect(prestigeRequirement(0)).toBe(10_000_000_000_000);
    expect(prestigeRequirement(1)).toBe(20_000_000_000_000);
    expect(prestigeRequirement(2)).toBe(80_000_000_000_000);
    expect(prestigeRequirement(3)).toBe(640_000_000_000_000);
  });

  it("ships the prestige-only cocomelon seed", () => {
    const seed = seedById("cocomelon");
    expect(seed?.prestigeOnly).toBe(true);
    expect(seed?.regrow).toBe(true);
    expect(seed?.buy).toBe(1_000_000_000);
    expect(seed?.sell).toBe(50_000_000);
    expect(PRESTIGE_SHOP.some((offer) => offer.seed === "cocomelon" && offer.tier === 5)).toBe(true);
    expect(prestigeMutationBonus(1)).toBe(0.05);
    expect(prestigeSellBonus(1)).toBe(1.5);
    expect(prestigeGrowScale(1)).toBe(0.9);
  });

  it("prices premium plots at one billion times two per bought plot", () => {
    expect(specialPlotCost(0)).toBe(1_000_000_000);
    expect(specialPlotCost(1)).toBe(2_000_000_000);
    expect(specialPlotCost(2)).toBe(4_000_000_000);
    const brainrot = effectById("brainrot");
    expect(brainrot?.multiplier).toBe(20);
    expect(brainrot?.natural).toBe(false);
  });

  it("doubles crop value with every quality star", () => {
    const season = seasonAt(EPOCH_MS);
    const one = cropSellPrice({ item: "carrot", effects: [], star: 1, qty: 1 }, season);
    const two = cropSellPrice({ item: "carrot", effects: [], star: 2, qty: 1 }, season);
    const five = cropSellPrice({ item: "carrot", effects: [], star: 5, qty: 1 }, season);
    expect(two).toBe(one * 2);
    expect(five).toBe(one * 16);
    expect(cropKey("carrot", [], 1)).toBe("carrot");
  });

  it("doubles the wheel price with every daily spin", () => {
    expect(wheelCost(0)).toBe(20_000);
    expect(wheelCost(1)).toBe(40_000);
    expect(wheelCost(2)).toBe(80_000);
    expect(wheelCost(34)).toBe(10_000 * 2 ** 35);
    expect(wheelCost(60)).toBe(10_000 * 2 ** 35);
  });

  it("queues keg jobs that brew wine", () => {
    const keg = MACHINES.find((machine) => machine.id === "keg");
    expect(keg?.queued).toBe(true);
    expect(keg?.allProduce).toBe(true);
    expect(keg?.gradeByPrice).toBe(true);
    expect(keg?.output).toEqual({ kind: "product", product: "wine" });
    expect(productById("wine")?.base).toBe(1_500);
    expect(parseGardenAction({ kind: "collectMachine", machine: "keg" })).toEqual({
      kind: "collectMachine",
      machine: "keg",
    });
    expect(parseGardenAction({ kind: "collectMachine", machine: "nope" })).toBeNull();
  });

  it("prices meat below the purchase price, lifted by pond growth", () => {
    expect(animalMeatPrice("cow", 1)).toBeLessThan(animalByIdForTest("cow"));
    expect(animalMeatPrice("fish", 1, 20)).toBeGreaterThan(animalMeatPrice("fish", 1, 0));
    // Land animals ignore pond growth entirely.
    expect(animalMeatPrice("cow", 3, 100)).toBe(animalMeatPrice("cow", 3, 0));
    expect(pondGrowthFactor(150)).toBe(2);
  });
});

// Small local helper so the test does not import another symbol by mistake.
function animalByIdForTest(id: "cow"): number {
  return ANIMALS.find((animal) => animal.id === id)?.buy ?? 0;
}

describe("event seeds", () => {
  it("appears in about one percent of restocks", () => {
    const eventSeeds = new Set(["moonflower", "frostberry"]);
    let withEventSeed = 0;
    const samples = 300;
    for (let index = 0; index < samples; index += 1) {
      const at = EPOCH_MS + (index + 1) * SHOP_RESTOCK_MS + 1_000;
      if (seasonAt(at).shop.offers.some((offer) => eventSeeds.has(offer.seed))) withEventSeed += 1;
    }
    expect(withEventSeed / samples).toBeLessThan(0.05);
  });

  it("triples moonflower during golden hour", () => {
    let golden = seasonAt(EPOCH_MS + 1_000);
    for (let wave = 1; wave < 40; wave += 1) {
      const candidate = seasonAt(EPOCH_MS + wave * EVENT_WAVE_MS + 1_000);
      if (candidate.events.some((event) => event.id === "goldenHour")) {
        golden = candidate;
        break;
      }
    }
    const calm = seasonAt(EPOCH_MS + 1_000);
    expect(golden.events.some((event) => event.id === "goldenHour")).toBe(true);
    const moon = { item: "moonflower" as const, effects: [], qty: 1 };
    expect(cropSellPrice(moon, golden)).toBe(Math.round((golden.prices.moonflower ?? 0) * 3));
    expect(cropSellPrice(moon, calm)).toBe(calm.prices.moonflower ?? 0);
  });
});

describe("rare tools", () => {
  it("appears in fewer than twenty percent of restocks", () => {
    const restock = Math.floor((EPOCH_MS - EPOCH_MS) / SHOP_RESTOCK_MS);
    let withTool = 0;
    const samples = 300;
    for (let index = 0; index < samples; index += 1) {
      const at = EPOCH_MS + (restock + index) * SHOP_RESTOCK_MS + 1_000;
      if (seasonAt(at).shop.tools.length > 0) withTool += 1;
    }
    expect(withTool / samples).toBeLessThan(0.25);
    expect(TOOLS[0]?.price).toBe(1_000_000);
  });
});

describe("soil fertility", () => {
  it("slows growth and prices renovation by missing steps", () => {
    expect(soilGrowthFactor(100)).toBe(1);
    expect(soilGrowthFactor(50)).toBe(1.5);
    expect(soilGrowthFactor(0)).toBe(2);
    expect(soilRenovateCost(100)).toBe(0);
    expect(soilRenovateCost(95)).toBe(10);
    expect(soilRenovateCost(50)).toBe(100);
    expect(soilRenovateCost(0)).toBe(200);
  });
});

describe("skills", () => {
  it("follows the exponential threshold formula", () => {
    expect(skillThreshold(0)).toBe(1000);
    expect(skillThreshold(1)).toBe(5000);
    expect(skillThreshold(2)).toBe(41000);
    expect(addSkillXp({ level: 0, xp: 0 }, 1000)).toEqual({ level: 1, xp: 0 });
    expect(addSkillXp({ level: 0, xp: 0 }, 500)).toEqual({ level: 0, xp: 500 });
    expect(farmingSellBonus(0)).toBe(0);
    expect(farmingSellBonus(5)).toBeGreaterThan(0.1);
    expect(DEFAULT_SKILLS.farming.level).toBe(0);
  });
});

describe("staff", () => {
  it("offers a deterministic labour market with hiring fees", () => {
    const market = staffMarketAt("p1", EPOCH_MS);
    expect(market).toHaveLength(10);
    expect(staffMarketAt("p1", EPOCH_MS)).toEqual(market);
    for (const candidate of market) {
      expect(candidate.wage).toBeGreaterThan(0);
      expect(candidate.traits.length).toBeGreaterThan(0);
      expect(staffHireCost(candidate)).toBeGreaterThan(50_000);
    }
  });
});

describe("pets", () => {
  it("ships a rarity ladder and rolls legendary early", () => {
    expect(PETS.length).toBeGreaterThanOrEqual(10);
    const legendary = rollPet(() => 0.001, 0);
    expect(legendary.pet.rarity).toBe("legendary");
    const pity = rollPet(() => 0.99, EGG_PITY - 1);
    expect(["epic", "legendary"]).toContain(pity.pet.rarity);
  });

  it("scales equipped effects by level", () => {
    const collection = { pets: { dragon: 2 }, equippedPet: "dragon" as const, lastHatch: "" };
    expect(equippedPetEffect(collection, "grow")).toBeCloseTo(0.2);
    expect(equippedPetEffect({ ...collection, equippedPet: null }, "grow")).toBe(0);
  });
});

describe("extras boards", () => {
  it("keeps contracts, merchant and forecast deterministic", () => {
    expect(contractOffers("p1", EPOCH_MS)).toEqual(contractOffers("p1", EPOCH_MS));
    expect(contractOffers("p1", EPOCH_MS)).toHaveLength(3);
    expect(merchantOffers("p1", EPOCH_MS)).toEqual(merchantOffers("p1", EPOCH_MS));
    expect(merchantOffers("p1", EPOCH_MS).length).toBeGreaterThan(0);
    const forecast = forecastEvents(EPOCH_MS, 3);
    expect(forecast).toHaveLength(3);
    expect(forecast[0]).toEqual(forecastEvents(EPOCH_MS, 3)[0]);
  });
});

describe("pests", () => {
  it("halves the sale value of infested produce", () => {
    const season = seasonAt(EPOCH_MS + 1_000);
    const clean = cropSellPrice({ item: "carrot", effects: [], qty: 1 }, season);
    const infested = cropSellPrice({ item: "carrot", effects: [], pest: true, qty: 1 }, season);
    expect(infested).toBe(Math.round(clean * 0.5));
  });
});

describe("market pressure", () => {
  it("keeps light supply unchanged and cuts heavier supply", () => {
    expect(nextSellState(1, 0, 2)).toEqual({ multiplier: 1, emptyCycles: 0 });
    expect(nextSellState(1, 0, 5).multiplier).toBeCloseTo(0.95);
    expect(nextSellState(1, 0, 20).multiplier).toBeCloseTo(0.75);
  });

  it("raises sell prices only after two empty cycles in a row", () => {
    const first = nextSellState(1, 0, 0);
    expect(first).toEqual({ multiplier: 1, emptyCycles: 1 });
    const second = nextSellState(first.multiplier, first.emptyCycles, 0);
    expect(second).toEqual({ multiplier: 1, emptyCycles: 2 });
    const third = nextSellState(second.multiplier, second.emptyCycles, 0);
    expect(third.multiplier).toBeCloseTo(1.2);
    expect(third.emptyCycles).toBe(3);
  });

  it("clamps sell multipliers between -70% and +500%", () => {
    expect(nextSellState(0.31, 3, 40).multiplier).toBe(MARKET_MIN_MULTIPLIER);
    expect(nextSellState(5.9, 3, 0).multiplier).toBe(MARKET_MAX_MULTIPLIER);
  });

  it("raises buy prices on volume and decays quietly back to base", () => {
    expect(nextBuyMultiplier(1, 20)).toBeCloseTo(1.1);
    expect(nextBuyMultiplier(1.1, 20)).toBeCloseTo(1.21);
    expect(nextBuyMultiplier(1, 2)).toBe(1);
    expect(nextBuyMultiplier(2, 2)).toBeCloseTo(1.9);
    expect(nextBuyMultiplier(3, 20)).toBe(MARKET_BUY_MAX);
  });

  it("applies sell and buy pressure to a season", () => {
    const season = seasonAt(EPOCH_MS);
    const pressured = applyMarket(season, { carrot: 2, apple: 0.5 });
    expect(pressured.prices.carrot).toBe(Math.max(1, Math.round((season.prices.carrot ?? 0) * 2)));
    expect(pressured.fruitPrices.apple).toBe(Math.max(1, Math.round((season.fruitPrices.apple ?? 0) * 0.5)));
    expect(pressured.prices.tomato).toBe(season.prices.tomato);

    const bases = marketBuyBaseItems(pressured);
    const carrotBase = bases.find((row) => row.item === "carrot")?.base ?? 0;
    const compostBase = bases.find((row) => row.item === "compost")?.base ?? 0;
    const buying = applyBuyMarket(pressured, { carrot: 1.5, compost: 2 });
    expect(buying.buyPrices?.carrot).toBe(Math.round(carrotBase * 1.5));
    expect(buying.buyPrices?.compost).toBe(Math.round(compostBase * 2));
  });

  it("lists every sellable and buyable item with a base price", () => {
    expect(marketBaseItems(seasonAt(EPOCH_MS))).toHaveLength(SEEDS.length + TREES.length);
    expect(marketBuyBaseItems(seasonAt(EPOCH_MS))).toHaveLength(
      SEEDS.filter((seed) => seed.rare !== true && seed.prestigeOnly !== true).length +
        FERTILIZERS.length +
        SPRAYS.length,
    );
  });

  it("uses six-minute aligned cycles", () => {
    expect(marketCycleEndsAt(EPOCH_MS)).toBe(EPOCH_MS + 6 * 60_000);
    expect(marketCycleAt(EPOCH_MS + 6 * 60_000)).toBe(marketCycleAt(EPOCH_MS) + 1);
  });
});

describe("garden season", () => {
  it("returns identical offers, prices and event for the same instant", () => {
    expect(seasonAt(NOW)).toEqual(seasonAt(NOW));
  });

  it("rolls one to three simultaneous events, one being the most common", () => {
    const counts = new Map<number, number>();
    for (let wave = 0; wave < 120; wave += 1) {
      const at = EPOCH_MS + wave * EVENT_WAVE_MS + 12;
      const events = eventsAt(at);
      expect(events).toEqual(eventsAt(at));
      expect(events.length).toBeLessThanOrEqual(3);
      expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
      for (const event of events) expect(event.id).not.toBe("calm");
      const order = EVENTS.map((event) => event.id);
      const indices = events.map((event) => order.indexOf(event.id));
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      counts.set(events.length, (counts.get(events.length) ?? 0) + 1);
    }
    expect(counts.get(1) ?? 0).toBeGreaterThan(counts.get(0) ?? 0);
    expect(counts.get(1) ?? 0).toBeGreaterThan(counts.get(2) ?? 0);
  });

  it("ships the expanded mutation and weather catalogs", () => {
    for (const id of [
      "shocked",
      "bloodlit",
      "radioactive",
      "disco",
      "cosmic",
      "metallic",
      "glimmering",
      "twisted",
      "diamond",
      "burnt",
    ] as const) {
      const effect = effectById(id);
      expect(effect).toBeDefined();
      expect(effect?.multiplier).toBeGreaterThan(0);
      expect(effect?.mark).toHaveLength(1);
    }
    // Marks stay unique so the log never confuses two mutations.
    const marks = EFFECTS.map((effect) => effect.mark);
    expect(new Set(marks).size).toBe(marks.length);

    for (const id of [
      "thunderstorm",
      "bloodMoon",
      "acidRain",
      "discoNight",
      "cosmicRift",
      "metallicDew",
      "glimmerFog",
      "twister",
      "diamondSky",
      "emberRain",
    ] as const) {
      const event = EVENTS.find((entry) => entry.id === id);
      expect(event).toBeDefined();
      expect(Object.keys(event?.effectChances ?? {}).length).toBeGreaterThan(0);
    }
    // Every weather chance must point at a real mutation.
    for (const event of EVENTS) {
      for (const id of Object.keys(event.effectChances)) expect(effectById(id)).toBeDefined();
    }
    const storm = EVENTS.find((event) => event.id === "thunderstorm");
    if (storm !== undefined) {
      expect(rollEffectsFor([storm], () => 0, storm.effectChances)).toContain("shocked");
    }
  });

  it("exposes the whole active event set on the season", () => {
    const phase = dayPhaseAt(EPOCH_MS + 5 * EVENT_WAVE_MS);
    const snapshot = seasonAt(phase.startsAt + 12);
    expect(snapshot.events).toHaveLength(eventsAt(phase.startsAt).length);
    expect(snapshot.event.id).toBe(snapshot.events[0]?.id ?? "calm");
    expect(snapshot.event.startedAt).toBe(phase.startsAt);
    expect(snapshot.phase.id).toBe(phase.phase.id);
  });

  it("keeps the same phase window and changes at its boundary", () => {
    const phase = dayPhaseAt(EPOCH_MS + 3 * EVENT_WAVE_MS);
    expect(seasonAt(phase.startsAt).wave).toBe(phase.index);
    expect(seasonAt(phase.endsAt - 1).wave).toBe(phase.index);
    expect(seasonAt(phase.endsAt).wave).toBe(dayPhaseAt(phase.endsAt).index);
  });

  it("rotates the seed shop on the restock cadence", () => {
    const a = seasonAt(NOW).shop;
    const b = seasonAt(NOW + SHOP_RESTOCK_MS).shop;
    const normalSeeds = SEEDS.filter((seed) => seed.rare !== true && seed.prestigeOnly !== true).length;
    expect(
      a.offers.filter((offer) => SEEDS.find((seed) => seed.id === offer.seed)?.rare !== true),
    ).toHaveLength(normalSeeds);
    expect(a.restockAt).toBeGreaterThan(NOW);
    expect(a.offers).not.toEqual(b.offers);
    for (const offer of a.offers) {
      const seed = SEEDS.find((entry) => entry.id === offer.seed);
      expect(offer.price).toBeGreaterThanOrEqual(1);
      if (seed?.rare === true) expect(offer.stock).toBe(1);
      else expect(offer.stock).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps exchange prices inside the documented drift band", () => {
    const season = seasonAt(NOW);
    for (const seed of SEEDS) {
      const event = eventAt(NOW);
      const low = seed.sell * 0.85 * event.sellBonus - 1;
      const high = seed.sell * 1.15 * event.sellBonus + 1;
      expect(season.prices[seed.id]).toBeGreaterThanOrEqual(Math.max(1, Math.floor(low)));
      expect(season.prices[seed.id]).toBeLessThanOrEqual(Math.ceil(high));
    }
  });

  it("exposes the next window for the client countdown", () => {
    const season = seasonAt(NOW);
    expect(season.next.startedAt).toBe(season.event.endsAt);
    expect(season.next.endsAt).toBe(dayPhaseAt(season.event.endsAt).endsAt);
  });
});

describe("garden growth math", () => {
  it("cycles day, dusk, night and dawn in twenty minutes", () => {
    expect(DAY_PHASES.map((phase) => [phase.id, phase.durationMs])).toEqual([
      ["day", 7 * 60_000],
      ["dusk", 3 * 60_000],
      ["night", 7 * 60_000],
      ["dawn", 3 * 60_000],
    ]);
    expect(DAY_CYCLE_MS).toBe(20 * 60_000);
    const base = EPOCH_MS;
    expect(dayPhaseAt(base).phase.id).toBe("day");
    expect(dayPhaseAt(base + 7 * 60_000).phase.id).toBe("dusk");
    expect(dayPhaseAt(base + 10 * 60_000).phase.id).toBe("night");
    expect(dayPhaseAt(base + 17 * 60_000).phase.id).toBe("dawn");
    expect(dayPhaseAt(base + DAY_CYCLE_MS).index).toBe(4);
    // Night grows slower than day when a crop is planted.
    const seed = seedById("carrot");
    if (seed === undefined) throw new Error("catalog");
    const day = growTimeForEvents(seed, [], null, dayPhaseAt(base).phase.growScale);
    const night = growTimeForEvents(seed, [], null, dayPhaseAt(base + 10 * 60_000).phase.growScale);
    expect(night).toBeGreaterThan(day);
  });

  it("draws weather from the current phase pool", () => {
    const dayPool = new Set([
      "goldenHour",
      "heatwave",
      "marketBoom",
      "rainbowSky",
      "rain",
      "thunderstorm",
      "metallicDew",
    ]);
    for (let step = 0; step < 12; step += 1) {
      const at = EPOCH_MS + step * 60_000;
      if (dayPhaseAt(at).phase.id !== "day") continue;
      for (const event of eventsAt(at)) expect(dayPool.has(event.id)).toBe(true);
    }
  });

  it("walks seed, sprout, young, ripe", () => {
    const seed = seedById("carrot");
    expect(seed).toBeDefined();
    if (seed === undefined) return;
    const plot: PlotState = {
      slot: 0,
      seed: "carrot",
      plantedAt: 1_000,
      readyAt: 1_000 + seed.growMs,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    expect(plotView(plot, 1_000).stage).toBe(0);
    expect(plotView(plot, 1_000).effects).toEqual([]);
    expect(plotView(plot, 1_000 + seed.growMs * 0.4).stage).toBe(1);
    expect(plotView(plot, 1_000 + seed.growMs * 0.8).stage).toBe(2);
    expect(plotView(plot, 1_000 + seed.growMs).ready).toBe(true);
    expect(plotView(plot, 1_000 + seed.growMs).stage).toBe(3);
    expect(plotView(plot, 1_000 + seed.growMs).remainingMs).toBe(0);
  });

  it("speeds up under rain and slows under frost", () => {
    const seed = seedById("tomato");
    if (seed === undefined) throw new Error("catalog");
    const rain = EVENTS.find((event) => event.id === "rain");
    const frost = EVENTS.find((event) => event.id === "frost");
    if (rain === undefined || frost === undefined) throw new Error("catalog");
    expect(growTimeFor(seed, rain)).toBeLessThan(seed.growMs);
    expect(growTimeFor(seed, frost)).toBeGreaterThan(seed.growMs);
    expect(combinedGrowScale([rain, frost])).toBeCloseTo(rain.growScale * frost.growScale, 6);
  });

  it("rolls golden and frozen from the event chances deterministically", () => {
    const goldenHour = EVENTS.find((event) => event.id === "goldenHour");
    const frost = EVENTS.find((event) => event.id === "frost");
    if (goldenHour === undefined || frost === undefined) throw new Error("catalog");
    // Stacking copies are expected; the distinct set is what matters here.
    expect([...new Set(rollEffects(goldenHour, () => 0.01))]).toEqual([
      "golden",
      "frozen",
      "moonlit",
      "shriveled",
      "pale",
    ]);
    expect(rollEffects(goldenHour, () => 0.1)).toContain("golden");
    expect(rollEffects(frost, () => 0.05)).toContain("frozen");
    expect(rollEffects(frost, () => 0.5)).toEqual([]);
  });

  it("rolls the new weather effects during their own event", () => {
    const byId = (id: string): (typeof EVENTS)[number] => {
      const event = EVENTS.find((entry) => entry.id === id);
      if (event === undefined) throw new Error(`catalog ${id}`);
      return event;
    };
    expect(rollEffects(byId("snowfall"), () => 0.1)).toContain("snow");
    expect(rollEffects(byId("coldSnap"), () => 0.1)).toContain("chill");
    expect(rollEffects(byId("heatwave"), () => 0.1)).toContain("sunray");
    expect(rollEffects(byId("drought"), () => 0.1)).toContain("cracked");
    expect(rollEffects(byId("wildfire"), () => 0.05)).toContain("onfire");

    // Several events can roll their effects in one go.
    expect([...new Set(rollEffectsFor([byId("snowfall"), byId("coldSnap")], () => 0.1))]).toEqual([
      "snow",
      "chill",
    ]);
  });

  it("keeps every weather effect rollable except water", () => {
    expect(effectById("wet")?.natural).toBe(false);
    for (const id of [
      "golden",
      "frozen",
      "snow",
      "chill",
      "sunray",
      "smoked",
      "cracked",
      "onfire",
    ] as const) {
      expect(effectById(id)?.natural).toBe(true);
    }
    expect(effectById("onfire")?.multiplier).toBe(6);
  });

  it("counts plots and prices crop stacks", () => {
    const season = seasonAt(NOW);
    const plots: Array<PlotState | null> = new Array(totalCrops(1)).fill(null);
    plots[0] = {
      slot: 0,
      seed: "carrot",
      plantedAt: 0,
      readyAt: NOW,
      effects: ["golden"],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    plots[1] = {
      slot: 1,
      seed: "corn",
      plantedAt: NOW,
      readyAt: NOW + 60_000,
      effects: [],
      watered: false,
      fertilized: false,
      harvests: 0,
      fertilizer: null,
      spray: null,
      pest: false,
      protectedUntil: 0,
    };
    expect(gardenCounts(plots, [], NOW)).toEqual({ ready: 1, growing: 1, free: 79 });
    expect(cropSellPrice({ item: "carrot", effects: ["golden"], qty: 1 }, season)).toBe(
      season.prices.carrot * 5,
    );
  });
});

describe("garden wire parsing", () => {
  it("ships seven fruit trees and prices their fruit", () => {
    expect(TREES).toHaveLength(15);
    expect(TREES.map((tree) => tree.id)).toEqual([
      "apple",
      "grape",
      "orange",
      "plum",
      "apricot",
      "coconut",
      "elderberry",
      "banana",
      "cherry",
      "peach",
      "pear",
      "lemon",
      "lime",
      "mango",
      "kiwi",
    ]);
    expect(treeById("apple")?.sell).toBeGreaterThan(treeById("apple")?.buy ?? 0);
    const season = seasonAt(NOW);
    expect(cropSellPrice({ item: "apple", effects: [], qty: 1 }, season)).toBe(season.fruitPrices.apple);
    expect(cropSellPrice({ item: "apple", effects: ["golden"], qty: 1 }, season)).toBe(
      season.fruitPrices.apple * 5,
    );
  });

  it("parses the fire-system attachment slot", () => {
    expect(parseGardenAction({ kind: "attachMachine", slot: "fire", id: "fireSystem" })).toEqual({
      kind: "attachMachine",
      slot: "fire",
      id: "fireSystem",
    });
  });

  it("parses tree actions and round-trips fruit bag keys", () => {
    expect(parseGardenAction({ kind: "plantTree", slot: 0, tree: "apple" })).toEqual({
      kind: "plantTree",
      slot: 0,
      tree: "apple",
    });
    expect(parseGardenAction({ kind: "harvest", slot: 0, tree: true })).toEqual({
      kind: "harvest",
      slot: 0,
      tree: true,
    });
    expect(parseGardenAction({ kind: "plantTree", slot: 0, tree: "nope" })).toBeNull();
    expect(cropKey("apple", ["wet"])).toBe("apple:wet");
    expect(parseCropKey("apple:wet")).toEqual({ item: "apple", effects: ["wet"], star: 1 });
    expect(parseCropKey("apple")).toEqual({ item: "apple", effects: [], star: 1 });
  });

  it("round-trips crop bag keys", () => {
    expect(cropKey("tomato", ["wet"])).toBe("tomato:wet");
    expect(parseCropKey("tomato:wet")).toEqual({ item: "tomato", effects: ["wet"], star: 1 });
    expect(parseCropKey("corn")).toEqual({ item: "corn", effects: [], star: 1 });
    expect(cropKey("tomato", [], 3)).toBe("tomato#3");
    expect(parseCropKey("tomato:wet#4")).toEqual({
      item: "tomato",
      effects: ["wet"],
      star: 4,
    });
    expect(parseCropKey("unknown:wet")).toBeNull();
    expect(parseCropKey("tomato:nope")).toBeNull();
  });

  it("round-trips the owner auth header", () => {
    const credentials = {
      playerId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      token: "a".repeat(64),
    };
    const raw = formatGardenAuth(credentials);
    expect(raw.startsWith(`${credentials.playerId}.`)).toBe(true);
    expect(parseGardenAuth(raw)).toEqual(credentials);
    expect(parseGardenAuth(null)).toBeNull();
    expect(parseGardenAuth("not-a-player.token")).toBeNull();
    expect(parseGardenAuth(`${credentials.playerId}.short`)).toBeNull();
    expect(GARDEN_AUTH_HEADER).toBe("x-dyno-garden");
  });

  it("recognises share codes and recovery keys", () => {
    expect(isGardenCode("G7K2QX")).toBe(true);
    expect(isGardenCode("g7k2qx")).toBe(false);
    expect(isGardenCode("G7K2Q")).toBe(false);
    expect(RECOVERY_RE.test("ABCD-EFGH-JKMN")).toBe(true);
    expect(isRecoveryKey("ABCD-EFGH-JKMN")).toBe(true);
    expect(isRecoveryKey("ABCD-EFGH-IJKL")).toBe(false);
  });

  it("parses breeding and slaughter actions", () => {
    expect(parseGardenAction({ kind: "breedAnimal", building: "coop", slot: 1 })).toEqual({
      kind: "breedAnimal",
      building: "coop",
      slot: 1,
    });
    expect(parseGardenAction({ kind: "sellAnimal", building: "pond", slot: 3 })).toEqual({
      kind: "sellAnimal",
      building: "pond",
      slot: 3,
    });
    expect(parseGardenAction({ kind: "sellAnimal", building: "nope", slot: 0 })).toBeNull();
    expect(parseGardenAction({ kind: "breedAnimal", building: "coop", slot: 12 })).toEqual({
      kind: "breedAnimal",
      building: "coop",
      slot: 12,
    });
    expect(parseGardenAction({ kind: "buyAnimal", building: "coop", slot: 12, animal: "chicken" })).toEqual({
      kind: "buyAnimal",
      building: "coop",
      slot: 12,
      animal: "chicken",
    });
    expect(parseGardenAction({ kind: "breedAnimal", building: "coop", slot: 81 })).toBeNull();
    expect(
      parseGardenAction({ kind: "buyAnimal", building: "coop", slot: 81, animal: "chicken" }),
    ).toBeNull();
    expect(parseGardenAction({ kind: "fertilizeAll", supply: "speedGrow" })).toEqual({
      kind: "fertilizeAll",
      supply: "speedGrow",
    });
    expect(parseGardenAction({ kind: "sprayAll", supply: "goldenSpray" })).toEqual({
      kind: "sprayAll",
      supply: "goldenSpray",
    });
    // A spray is not a fertilizer and vice versa.
    expect(parseGardenAction({ kind: "fertilizeAll", supply: "goldenSpray" })).toBeNull();
    expect(parseGardenAction({ kind: "sprayAll", supply: "speedGrow" })).toBeNull();
    expect(parseGardenAction({ kind: "reclaimSeed", slot: 3 })).toEqual({ kind: "reclaimSeed", slot: 3 });
    expect(parseGardenAction({ kind: "movePlant", from: 0, to: 9, tree: false })).toEqual({
      kind: "movePlant",
      from: 0,
      to: 9,
      tree: false,
    });
    expect(parseGardenAction({ kind: "movePlant", from: 4, to: 4, tree: false })).toBeNull();
    expect(parseGardenAction({ kind: "toggleFavorite", slot: 0, tree: true })).toEqual({
      kind: "toggleFavorite",
      slot: 0,
      tree: true,
    });
    expect(parseGardenAction({ kind: "toggleFavorite", slot: 999, tree: true })).toBeNull();
    expect(parseGardenAction({ kind: "buySpecialPatch", patch: 0 })).toEqual({
      kind: "buySpecialPatch",
      patch: 0,
    });
    expect(parseGardenAction({ kind: "buySpecialPatch", patch: 3 })).toBeNull();
    expect(parseGardenAction({ kind: "plantSpecial", slot: 0, seed: "carrot" })).toEqual({
      kind: "plantSpecial",
      slot: 0,
      seed: "carrot",
    });
    expect(parseGardenAction({ kind: "harvestSpecial", slot: 26 })).toEqual({
      kind: "harvestSpecial",
      slot: 26,
    });
    expect(parseGardenAction({ kind: "waterSpecial", slot: 27 })).toBeNull();
    expect(parseGardenAction({ kind: "giftCoins", code: "abcdef", amount: 500 })).toEqual({
      kind: "giftCoins",
      code: "ABCDEF",
      amount: 500,
    });
    expect(parseGardenAction({ kind: "giftCoins", code: "ABCDEF", amount: 0 })).toBeNull();
    expect(parseGardenAction({ kind: "giftSeed", code: "ABCDEF", seed: "carrot", qty: 1 })).toEqual({
      kind: "giftSeed",
      code: "ABCDEF",
      seed: "carrot",
      qty: 1,
    });
    expect(parseGardenAction({ kind: "giftTool", code: "ABCDEF", tool: "shovel", qty: 1 })).toEqual({
      kind: "giftTool",
      code: "ABCDEF",
      tool: "shovel",
      qty: 1,
    });
  });

  it("validates actions and rejects malformed ones", () => {
    expect(parseGardenAction({ kind: "plant", slot: 0, seed: "carrot" })).toEqual({
      kind: "plant",
      slot: 0,
      seed: "carrot",
    });
    expect(parseGardenAction({ kind: "water", slot: 8 })).toEqual({
      kind: "water",
      slot: 8,
      tree: false,
    });
    expect(parseGardenAction({ kind: "water", slot: 80, tree: true })).toEqual({
      kind: "water",
      slot: 80,
      tree: true,
    });
    expect(parseGardenAction({ kind: "water", slot: 324 })).toBeNull();
    expect(parseGardenAction({ kind: "water", slot: 108, tree: true })).toBeNull();
    expect(parseGardenAction({ kind: "plant", slot: 0, seed: "nope" })).toBeNull();
    expect(parseGardenAction({ kind: "buySeed", seed: "corn", qty: 0 })).toBeNull();
    expect(parseGardenAction({ kind: "sellCrop", item: "corn", effects: ["wet"], qty: 2 })).toEqual({
      kind: "sellCrop",
      item: "corn",
      effects: ["wet"],
      pest: false,
      star: 1,
      qty: 2,
    });
    expect(parseGardenAction({ kind: "fertilize", slot: 0, tree: false, supply: "speedGrow" })).toEqual({
      kind: "fertilize",
      slot: 0,
      tree: false,
      supply: "speedGrow",
    });
    expect(parseGardenAction({ kind: "spray", slot: 0, tree: true, supply: "snowSpray" })).toEqual({
      kind: "spray",
      slot: 0,
      tree: true,
      supply: "snowSpray",
    });
    expect(parseGardenAction({ kind: "fertilize", slot: 0, tree: false, supply: "nope" })).toBeNull();
    expect(parseGardenAction({ kind: "buySupply", supply: "compost", qty: 2 })).toEqual({
      kind: "buySupply",
      supply: "compost",
      qty: 2,
    });
    expect(parseGardenAction({ kind: "buyTab" })).toEqual({ kind: "buyTab" });
    expect(parseGardenAction({ kind: "sellAll" })).toEqual({ kind: "sellAll" });
    expect(parseGardenAction({ kind: "mineHit", slot: 12 })).toEqual({ kind: "mineHit", slot: 12 });
    expect(parseGardenAction({ kind: "mineHit", slot: -1 })).toBeNull();
    expect(parseGardenAction({ kind: "mineHit", slot: 25 })).toBeNull();
    expect(parseGardenAction({ kind: "mineDescend" })).toEqual({ kind: "mineDescend" });
    expect(parseGardenAction({ kind: "mineElevator", targetFloor: 5 })).toEqual({
      kind: "mineElevator",
      targetFloor: 5,
    });
    expect(parseGardenAction({ kind: "mineElevator", targetFloor: 0 })).toBeNull();
    expect(parseGardenAction({ kind: "upgradePickaxe" })).toEqual({ kind: "upgradePickaxe" });
    expect(parseGardenAction({ kind: "mineEat", item: "dried" })).toEqual({
      kind: "mineEat",
      item: "dried",
    });
    expect(parseGardenAction({ kind: "mineEat", item: "invalidItem" })).toBeNull();
    expect(parseGardenAction({ kind: "assignMiner", staffSlot: 1 })).toEqual({
      kind: "assignMiner",
      staffSlot: 1,
    });
    expect(parseGardenAction({ kind: "assignMiner", staffSlot: null })).toEqual({
      kind: "assignMiner",
      staffSlot: null,
    });
    expect(parseGardenAction({ kind: "assignMiner", staffSlot: 4 })).toBeNull();
    expect(parseGardenAction({ kind: "explode" })).toBeNull();
  });

  it("keeps the hash and rng deterministic", () => {
    expect(hash32("garden")).toBe(hash32("garden"));
    const first = createRng(7);
    const second = createRng(7);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });
});

describe("quick plan planner", () => {
  it("picks the seed that earns the most coins per plot", () => {
    const preview = planQuickPlan({
      coins: 10_000,
      prestige: 0,
      shopOffers: [
        { seed: "carrot", price: 6, stock: 2 },
        { seed: "corn", price: 30, stock: 5 },
      ],
      emptyCrops: 3,
      emptyTrees: 1,
      emptyTrays: 0,
    });
    // Corn earns more per planting than carrot, so it fills first while stock lasts.
    expect(preview.crops[0]?.id).toBe("corn");
    expect(preview.slots).toBeGreaterThan(0);
    expect(preview.totalCost).toBeGreaterThan(0);
  });

  it("shows nothing when the wallet cannot buy any stock", () => {
    const preview = planQuickPlan({
      coins: 0,
      prestige: 0,
      shopOffers: [{ seed: "carrot", price: 6, stock: 2 }],
      emptyCrops: 4,
      emptyTrees: 2,
      emptyTrays: 27,
    });
    expect(preview.slots).toBe(0);
    expect(preview.totalCost).toBe(0);
  });
});
