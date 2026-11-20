/**
 * @file garden.spec.ts
 * @brief End-to-end API for ASCII Garden: identity, play, rename, visit, restore.
 * @details The durable objects keep the garden; these tests drive the public HTTP
 * surface the browser uses and pin the two properties the product promises:
 * renaming never forks a garden, and a recovery key returns the same one on a
 * new device.
 */

import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type {
  GardenActResponse,
  GardenSnapshot,
  GardenStateResponse,
  SeasonSnapshot,
  VisitSnapshot,
} from "@dyno/shared/garden";
import { SEEDS } from "@dyno/shared/garden";
import { deriveTabs } from "../src/garden";
import { BASE, ORIGIN, uniqueIp } from "./helpers";

/** One freshly registered garden. */
interface Registered {
  playerId: string;
  token: string;
  recovery: string;
  state: GardenSnapshot;
  season: SeasonSnapshot;
  serverNow: number;
}

/** JSON response helper. */
async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Registers one garden over the public API. */
async function register(nick = "gardener", ip = uniqueIp()): Promise<Registered> {
  const response = await SELF.fetch(`${BASE}/api/garden/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip },
    body: JSON.stringify({ nick, color: "hsl(200 60% 60%)" }),
  });
  expect(response.status).toBe(201);
  return body<Registered>(response);
}

/** Owner auth header for one garden. */
function auth(registered: Registered, token = registered.token): Record<string, string> {
  return { origin: ORIGIN, "x-dyno-garden": `${registered.playerId}.${token}` };
}

/** Reads the owner state. */
async function readState(registered: Registered, token = registered.token): Promise<GardenStateResponse> {
  const response = await SELF.fetch(`${BASE}/api/garden/state`, { headers: auth(registered, token) });
  expect(response.status).toBe(200);
  return body<GardenStateResponse>(response);
}

/** Applies one action. */
async function act(
  registered: Registered,
  rev: number,
  action: unknown,
): Promise<{ status: number; payload: GardenActResponse | { code: string } }> {
  const response = await SELF.fetch(`${BASE}/api/garden/act`, {
    method: "POST",
    headers: { ...auth(registered), "content-type": "application/json" },
    body: JSON.stringify({ rev, action }),
  });
  return { status: response.status, payload: await body<GardenActResponse | { code: string }>(response) };
}

/** Reads a public visit snapshot. */
async function visit(code: string): Promise<VisitSnapshot> {
  const response = await SELF.fetch(`${BASE}/api/garden/visit/${code}`, { headers: { origin: ORIGIN } });
  expect(response.status).toBe(200);
  const payload = await body<{ garden: VisitSnapshot }>(response);
  return payload.garden;
}

describe("global market", () => {
  it("serves the market board with every sellable item", async () => {
    const response = await SELF.fetch(`${BASE}/api/garden/market`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      market: { cycle: number; nextCycleAt: number; soldTarget: number; items: unknown[] };
    };
    expect(body.market.items.length).toBeGreaterThan(20);
    expect(body.market.soldTarget).toBe(8);
    expect(body.market.nextCycleAt).toBeGreaterThan(Date.now());
    const first = body.market.items[0] as { item: string; multiplier: number; price: number };
    expect(first.multiplier).toBe(1);
    expect(first.price).toBeGreaterThan(0);
  });

  it("counts bulk purchases globally for the next cycle", async () => {
    const bindings = env as unknown as import("../src/env").Env;
    const market = bindings.MARKET.get(bindings.MARKET.idFromName("board"));
    const snapshot = () =>
      market
        .fetch("https://market/snapshot")
        .then((response) => response.json() as Promise<{ offers: Array<{ item: string; bought: number }> }>);
    const before = await snapshot();
    const start = before.offers.find((offer) => offer.item === "compost")?.bought ?? 0;

    const purchased = await market.fetch("https://market/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: "compost", qty: 25 }),
    });
    expect(purchased.status).toBe(200);

    const after = await snapshot();
    const now = after.offers.find((offer) => offer.item === "compost")?.bought ?? 0;
    expect(now).toBeGreaterThanOrEqual(start + 25);
  });
});

describe("market self-heal", () => {
  it("unsticks a future cycle index", async () => {
    const bindings = env as unknown as import("../src/env").Env;
    const market = bindings.MARKET.get(bindings.MARKET.idFromName("board"));
    await runInDurableObject(market, (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        "INSERT INTO meta (key, value) VALUES ('board', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        JSON.stringify({ cycle: 99_999_999, sell: {}, buy: {} }),
      );
    });
    const response = await market.fetch("https://market/snapshot");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { cycle: number; items: Array<{ multiplier: number }> };
    expect(body.cycle).toBeLessThan(99_999_999);
    expect(body.items.every((item) => item.multiplier === 1)).toBe(true);
  });
});

describe("bots", () => {
  it("creates fifty bots plus the carrot specialist and keeps them out of the human leaderboard", async () => {
    for (let round = 0; round < 6; round += 1) {
      const tick = await SELF.fetch(`${BASE}/api/garden/bots/tick`, { method: "POST" });
      expect(tick.status).toBe(200);
    }

    const list = await SELF.fetch(`${BASE}/api/garden/bots`);
    const listed = (await list.json()) as {
      bots: Array<{ code: string; nick: string; focus?: string }>;
    };
    expect(listed.bots).toHaveLength(51);
    expect(listed.bots.some((bot) => bot.nick === "Bot Cà Rốt" && bot.focus === "carrot")).toBe(true);
    for (const bot of listed.bots) {
      if (bot.focus === "carrot") expect(bot.nick).toBe("Bot Cà Rốt");
      else expect(bot.nick).toMatch(/^Bot \d\d$/);
    }

    const board = await SELF.fetch(`${BASE}/api/garden/leaderboard`);
    const ranked = (await board.json()) as { entries: Array<{ nick: string }> };
    expect(ranked.entries.some((entry) => entry.nick.startsWith("Bot "))).toBe(false);

    const visit = await SELF.fetch(`${BASE}/api/garden/visit/${listed.bots[0]?.code ?? ""}`);
    expect(visit.status).toBe(200);
  });
});

describe("tournament", () => {
  it("serves weekly standings", async () => {
    const response = await SELF.fetch(`${BASE}/api/garden/tournament`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe("legacy saves", () => {
  it("keeps old patch data as usable tabs", () => {
    expect(deriveTabs({ unlocked: 4 })).toBe(1);
    expect(deriveTabs({ unlocked: 9 })).toBe(1);
    expect(deriveTabs({ unlocked: 10 })).toBe(1);
    expect(deriveTabs({})).toBe(1);
    expect(deriveTabs({ patches: 3 })).toBe(1);
    expect(deriveTabs({ patches: 6 })).toBe(2);
    expect(deriveTabs({ tabs: 3, patches: 6 })).toBe(3);
    expect(deriveTabs({ tabs: 99 })).toBe(4);
  });
});

describe("garden registration", () => {
  it("creates a playable garden with credentials and a share code", async () => {
    const registered = await register();
    expect(registered.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(registered.token).toMatch(/^[0-9a-f]{64}$/);
    expect(registered.recovery).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
    );
    expect(registered.state.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(registered.state.coins).toBe(30);
    expect(registered.state.tabs).toBe(1);
    expect(registered.state.plots).toHaveLength(81);
    expect(registered.state.trees).toHaveLength(27);
    expect(registered.state.bag.seeds.carrot).toBe(3);
    expect(registered.state.rev).toBe(1);
  });

  it("rejects an empty nickname", async () => {
    const response = await SELF.fetch(`${BASE}/api/garden/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": uniqueIp() },
      body: JSON.stringify({ nick: "   " }),
    });
    expect(response.status).toBe(400);
  });

  it("rate limits registrations per IP", async () => {
    const ip = uniqueIp();
    for (let index = 0; index < 5; index += 1) await register("gardener", ip);
    const response = await SELF.fetch(`${BASE}/api/garden/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip },
      body: JSON.stringify({ nick: "gardener" }),
    });
    expect(response.status).toBe(429);
  });
});

describe("garden play", () => {
  it("requires the owner credentials for play", async () => {
    const response = await SELF.fetch(`${BASE}/api/garden/state`, { headers: { origin: ORIGIN } });
    expect(response.status).toBe(401);
  });

  it("plants a bagged seed and rejects a stale revision", async () => {
    const registered = await register();
    const planted = await act(registered, registered.state.rev, { kind: "plant", slot: 0, seed: "carrot" });
    expect(planted.status).toBe(200);
    const state = (planted.payload as GardenActResponse).state;
    expect(state.plots[0]?.seed).toBe("carrot");
    expect(state.bag.seeds.carrot).toBe(2);
    expect(state.rev).toBe(registered.state.rev + 1);

    const stale = await act(registered, registered.state.rev, { kind: "plant", slot: 1, seed: "carrot" });
    expect(stale.status).toBe(409);
    expect(stale.payload).toMatchObject({ code: "STALE_REV" });
  });

  it("keeps pesticide cover and favorite pins across a reload", async () => {
    const registered = await register("keeper");
    const planted = await act(registered, registered.state.rev, { kind: "plant", slot: 0, seed: "carrot" });
    if (planted.status !== 200) throw new Error("plant failed");
    const afterPlant = (planted.payload as GardenActResponse).state;

    // Fund the wallet and drop a favorite lock into the bag without an action.
    const bindings = env as unknown as import("../src/env").Env;
    const garden = bindings.GARDEN.get(bindings.GARDEN.idFromName(registered.playerId));
    await runInDurableObject(garden, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'ledger'")
        .toArray()[0];
      if (row === undefined) throw new Error("ledger missing");
      const meta = JSON.parse(row.value) as { coins: number };
      meta.coins = 10_000;
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'ledger'", JSON.stringify(meta));
      state.storage.sql.exec("INSERT INTO bag (kind, item, qty) VALUES ('tool', 'favoriteLock', 1)");
    });

    const sprayed = await act(registered, afterPlant.rev, { kind: "sprayPest", slot: 0, tree: false });
    expect(sprayed.status).toBe(200);
    const sprayedState = (sprayed.payload as GardenActResponse).state;
    expect(sprayedState.plots[0]?.protectedUntil).toBeGreaterThan(sprayedState.updatedAt);

    // The next read comes straight out of SQLite, so this is the persistence check.
    const reloaded = await readState(registered);
    expect(reloaded.state.plots[0]?.protectedUntil).toBe(sprayedState.plots[0]?.protectedUntil);

    const pinned = await act(registered, reloaded.state.rev, {
      kind: "toggleFavorite",
      slot: 0,
      tree: false,
    });
    expect(pinned.status).toBe(200);
    const pinnedState = (pinned.payload as GardenActResponse).state;
    expect(pinnedState.plots[0]?.favorite).toBe(true);

    const final = await readState(registered);
    expect(final.state.plots[0]?.favorite).toBe(true);
  });

  it("keeps the infested flag on harvested crops", async () => {
    const registered = await register("infested");
    const planted = await act(registered, registered.state.rev, { kind: "plant", slot: 0, seed: "carrot" });
    if (planted.status !== 200) throw new Error("plant failed");
    const afterPlant = (planted.payload as GardenActResponse).state;

    // Make the crop ripe and pest-damaged straight in storage.
    const bindings = env as unknown as import("../src/env").Env;
    const garden = bindings.GARDEN.get(bindings.GARDEN.idFromName(registered.playerId));
    await runInDurableObject(garden, (_instance, state) => {
      state.storage.sql.exec("UPDATE plots SET ready_at = ?, pest = 1 WHERE slot = 0", Date.now() - 1_000);
    });

    const harvested = await act(registered, afterPlant.rev, { kind: "harvest", slot: 0, tree: false });
    expect(harvested.status).toBe(200);
    const harvestedState = (harvested.payload as GardenActResponse).state;
    expect(harvestedState.bag.crops[0]?.pest).toBe(true);

    // Reloaded from SQLite the half-price flag must still be there.
    const reloaded = await readState(registered);
    expect(reloaded.state.bag.crops[0]?.pest).toBe(true);
  });

  it("collects a finished keg job through the action API", async () => {
    const registered = await register("brewer");
    const bindings = env as unknown as import("../src/env").Env;
    const garden = bindings.GARDEN.get(bindings.GARDEN.idFromName(registered.playerId));
    await runInDurableObject(garden, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'ledger'")
        .toArray()[0];
      if (row === undefined) throw new Error("ledger missing");
      const meta = JSON.parse(row.value) as { coins: number };
      meta.coins = 30_000_000;
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'ledger'", JSON.stringify(meta));
      state.storage.sql.exec("INSERT INTO bag (kind, item, qty) VALUES ('crop', 'apple', 1)");
    });

    const warehouse = await act(registered, registered.state.rev, { kind: "buildWarehouse" });
    if (warehouse.status !== 200) throw new Error("warehouse failed");
    const builtWarehouse = (warehouse.payload as GardenActResponse).state;
    const keg = await act(registered, builtWarehouse.rev, { kind: "buildMachine", machine: "keg" });
    if (keg.status !== 200) throw new Error("keg failed");
    const builtKeg = (keg.payload as GardenActResponse).state;

    const scheduled = await act(registered, builtKeg.rev, {
      kind: "craftMachine",
      machine: "keg",
      item: "apple",
    });
    if (scheduled.status !== 200) throw new Error("schedule failed");
    const scheduledState = (scheduled.payload as GardenActResponse).state;
    expect(scheduledState.bag.crops).toHaveLength(0);
    expect(scheduledState.warehouse.machines.keg?.job?.item).toBe("apple");

    // Fast-forward the job in storage, then collect it through the API.
    await runInDurableObject(garden, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'ledger'")
        .toArray()[0];
      if (row === undefined) throw new Error("ledger missing");
      const meta = JSON.parse(row.value) as {
        machines?: Record<string, { job?: { readyAt: number } }>;
      };
      const job = meta.machines?.keg?.job;
      if (job === undefined) throw new Error("job missing");
      job.readyAt = Date.now() - 1_000;
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'ledger'", JSON.stringify(meta));
    });

    const collected = await act(registered, scheduledState.rev, {
      kind: "collectMachine",
      machine: "keg",
    });
    expect(collected.status).toBe(200);
    const collectedState = (collected.payload as GardenActResponse).state;
    expect(collectedState.warehouse.machines.keg?.job).toBeUndefined();
    expect(collectedState.bag.products?.some((stack) => stack.product === "wine")).toBe(true);
  });

  it("keeps buying after planting the seed and survives a reload", async () => {
    const registered = await register("repeat-buyer");
    const offer = registered.season.shop.offers[0];
    if (offer === undefined) throw new Error("no offer");
    const bought = await act(registered, registered.state.rev, {
      kind: "buySeed",
      seed: offer.seed,
      qty: 1,
    });
    if (bought.status !== 200) throw new Error("buy failed");
    const boughtState = (bought.payload as GardenActResponse).state;
    expect(boughtState.shopStock[offer.seed]).toBe(offer.stock - 1);

    // Plant the seed just bought; the shop stock must not change.
    const planted = await act(registered, boughtState.rev, {
      kind: "plant",
      slot: 0,
      seed: offer.seed,
    });
    if (planted.status !== 200) throw new Error("plant failed");
    const plantedState = (planted.payload as GardenActResponse).state;
    expect(plantedState.shopStock[offer.seed]).toBe(offer.stock - 1);
    expect(plantedState.bag.seeds[offer.seed] ?? 0).toBe(registered.state.bag.seeds[offer.seed] ?? 0);

    const reloaded = await readState(registered);
    expect(reloaded.state.shopStock[offer.seed]).toBe(offer.stock - 1);

    const again = await act(registered, reloaded.state.rev, {
      kind: "buySeed",
      seed: offer.seed,
      qty: 1,
    });
    expect(again.status).toBe(200);
    const againState = (again.payload as GardenActResponse).state;
    expect(againState.shopStock[offer.seed]).toBe(offer.stock - 2);
  });

  it("reports the remaining shop stock in the snapshot", async () => {
    const registered = await register("shopper");
    const offer = registered.season.shop.offers[0];
    if (offer === undefined) throw new Error("no offer");
    const bought = await act(registered, registered.state.rev, {
      kind: "buySeed",
      seed: offer.seed,
      qty: 1,
    });
    expect(bought.status).toBe(200);
    const boughtState = (bought.payload as GardenActResponse).state;
    expect(boughtState.shopStock[offer.seed]).toBe(offer.stock - 1);

    const reloaded = await readState(registered);
    expect(reloaded.state.shopStock[offer.seed]).toBe(offer.stock - 1);
  });

  it("gifts coins and seeds to another garden", async () => {
    const giver = await register("giver");
    const receiver = await register("receiver", uniqueIp());

    const coins = await act(giver, giver.state.rev, {
      kind: "giftCoins",
      code: receiver.state.code,
      amount: 10,
    });
    expect(coins.status).toBe(200);
    const coinsState = (coins.payload as GardenActResponse).state;
    expect(coinsState.coins).toBe(giver.state.coins - 10);

    const receiverAfterCoins = await readState(receiver);
    expect(receiverAfterCoins.state.coins).toBe(receiver.state.coins + 10);

    const seeds = await act(giver, coinsState.rev, {
      kind: "giftSeed",
      code: receiver.state.code,
      seed: "carrot",
      qty: 1,
    });
    expect(seeds.status).toBe(200);
    const seedsState = (seeds.payload as GardenActResponse).state;
    expect(seedsState.bag.seeds.carrot).toBe((giver.state.bag.seeds.carrot ?? 0) - 1);

    const receiverAfterSeed = await readState(receiver);
    expect(receiverAfterSeed.state.bag.seeds.carrot).toBe((receiver.state.bag.seeds.carrot ?? 0) + 1);

    const self = await act(giver, seedsState.rev, {
      kind: "giftCoins",
      code: giver.state.code,
      amount: 1,
    });
    expect(self.status).toBe(400);
    expect(self.payload).toMatchObject({ code: "GIFT_SELF" });
  });

  it("refuses a tab it cannot afford and an unripe harvest", async () => {
    const registered = await register();
    const patch = await act(registered, registered.state.rev, { kind: "buyTab" });
    expect(patch.status).toBe(400);
    expect(patch.payload).toMatchObject({ code: "NOT_ENOUGH_COINS" });

    const planted = await act(registered, registered.state.rev, { kind: "plant", slot: 0, seed: "carrot" });
    if (planted.status !== 200) throw new Error("plant failed");
    const rev = (planted.payload as GardenActResponse).state.rev;
    const early = await act(registered, rev, { kind: "harvest", slot: 0 });
    expect(early.status).toBe(400);
    expect(early.payload).toMatchObject({ code: "NOT_READY" });
  });

  it("buys seeds at the shared shop price", async () => {
    const registered = await register();
    const offer = registered.season.shop.offers.find((entry) => entry.seed === "carrot");
    if (offer === undefined) throw new Error("carrot offer missing");
    const bought = await act(registered, registered.state.rev, { kind: "buySeed", seed: "carrot", qty: 1 });
    expect(bought.status).toBe(200);
    const state = (bought.payload as GardenActResponse).state;
    expect(state.coins).toBe(registered.state.coins - offer.price);
    expect(state.bag.seeds.carrot).toBe(4);
  });
});

describe("garden identity", () => {
  it("keeps the same garden when the nickname changes", async () => {
    const registered = await register("old-name");
    const planted = await act(registered, registered.state.rev, { kind: "plant", slot: 0, seed: "carrot" });
    const plantedState = (planted.payload as GardenActResponse).state;

    const renamed = await SELF.fetch(`${BASE}/api/garden/profile`, {
      method: "POST",
      headers: { ...auth(registered), "content-type": "application/json" },
      body: JSON.stringify({ nick: "new-name", color: "hsl(10 60% 60%)" }),
    });
    expect(renamed.status).toBe(200);
    const renamedState = (await body<GardenStateResponse>(renamed)).state;
    expect(renamedState.playerId).toBe(registered.playerId);
    expect(renamedState.code).toBe(registered.state.code);
    expect(renamedState.nick).toBe("new-name");
    expect(renamedState.coins).toBe(plantedState.coins);
    expect(renamedState.plots[0]?.seed).toBe("carrot");

    const publicView = await visit(renamedState.code);
    expect(publicView.nick).toBe("new-name");
    expect(publicView.plots[0]?.seed).toBe("carrot");
  });

  it("restores the same garden on a new device with the recovery key", async () => {
    const registered = await register("device-one");
    await act(registered, registered.state.rev, { kind: "plant", slot: 0, seed: "carrot" });

    const restoredResponse = await SELF.fetch(`${BASE}/api/garden/restore`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        recovery: registered.recovery,
        nick: "device-two",
        color: "hsl(120 60% 60%)",
      }),
    });
    expect(restoredResponse.status).toBe(200);
    const restored = await body<Registered>(restoredResponse);
    expect(restored.playerId).toBe(registered.playerId);
    expect(restored.token).not.toBe(registered.token);
    expect(restored.state.code).toBe(registered.state.code);
    expect(restored.state.nick).toBe("device-two");
    expect(restored.state.plots[0]?.seed).toBe("carrot");

    // The old device loses write access, the new token keeps playing.
    const oldDevice = await SELF.fetch(`${BASE}/api/garden/state`, { headers: auth(registered) });
    expect(oldDevice.status).toBe(401);
    const newDevice = await readState(restored);
    expect(newDevice.state.playerId).toBe(registered.playerId);
  });

  it("rejects a wrong recovery key", async () => {
    const response = await SELF.fetch(`${BASE}/api/garden/restore`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ recovery: "ABCD-EFGH-JKMN" }),
    });
    expect(response.status).toBe(404);
    expect(await body<{ code: string }>(response)).toMatchObject({ code: "BAD_RECOVERY" });
  });
});

describe("garden visits", () => {
  it("shows a public read-only snapshot and 404s an unknown code", async () => {
    const registered = await register("host");
    const snapshot = await visit(registered.state.code);
    expect(snapshot.nick).toBe("host");
    expect(snapshot.plots).toHaveLength(81);
    expect(snapshot.trees).toHaveLength(27);
    expect(snapshot.online).toBe(true);
    expect(snapshot.visitors).toEqual([]);

    const missing = await SELF.fetch(`${BASE}/api/garden/visit/ZZZZZZ`, { headers: { origin: ORIGIN } });
    expect(missing.status).toBe(404);
  });

  it("lets a friend water a crop once and records the helper", async () => {
    const host = await register("host");
    const guest = await register("guest");
    const planted = await act(host, host.state.rev, { kind: "plant", slot: 0, seed: "carrot" });
    const before = (planted.payload as GardenActResponse).state.plots[0];
    if (before === undefined || before === null) throw new Error("plant missing");

    const watered = await SELF.fetch(`${BASE}/api/garden/visit/${host.state.code}/water`, {
      method: "POST",
      headers: { ...auth(guest), "content-type": "application/json" },
      body: JSON.stringify({ slot: 0 }),
    });
    expect(watered.status).toBe(200);
    const wateredGarden = (await body<{ garden: VisitSnapshot }>(watered)).garden;
    const after = wateredGarden.plots[0];
    expect(after).not.toBeNull();
    expect(after?.readyAt).toBeLessThan(before.readyAt);
    expect(wateredGarden.visitors[0]?.nick).toBe("guest");

    const again = await SELF.fetch(`${BASE}/api/garden/visit/${host.state.code}/water`, {
      method: "POST",
      headers: { ...auth(guest), "content-type": "application/json" },
      body: JSON.stringify({ slot: 0 }),
    });
    expect(again.status).toBe(409);
    expect(await body<{ code: string }>(again)).toMatchObject({ code: "ALREADY_WATERED" });
  });

  it("refuses to water your own garden", async () => {
    const registered = await register();
    const response = await SELF.fetch(`${BASE}/api/garden/visit/${registered.state.code}/water`, {
      method: "POST",
      headers: { ...auth(registered), "content-type": "application/json" },
      body: JSON.stringify({ slot: 0 }),
    });
    expect(response.status).toBe(400);
    expect(await body<{ code: string }>(response)).toMatchObject({ code: "CANNOT_VISIT_SELF" });
  });
});

describe("garden season", () => {
  it("serves one consistent snapshot to every caller", async () => {
    const first = await SELF.fetch(`${BASE}/api/garden/season`, { headers: { origin: ORIGIN } });
    const second = await SELF.fetch(`${BASE}/api/garden/season`, { headers: { origin: ORIGIN } });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = await body<{ season: SeasonSnapshot; serverNow: number }>(first);
    const b = await body<{ season: SeasonSnapshot; serverNow: number }>(second);
    const normalSeeds = SEEDS.filter((seed) => seed.rare !== true && seed.prestigeOnly !== true).length;
    expect(a.season.shop.offers.length).toBeGreaterThanOrEqual(normalSeeds);
    expect(a.season.shop.offers.length).toBeLessThanOrEqual(normalSeeds + 2);
    expect(a.season.event.id).toBe(b.season.event.id);
    expect(a.season.event.startedAt).toBe(b.season.event.startedAt);
    expect(b.serverNow).toBeGreaterThanOrEqual(a.serverNow);
  });

  it("serves a leaderboard", async () => {
    const registered = await register("ranked");
    const response = await SELF.fetch(`${BASE}/api/garden/leaderboard`, { headers: { origin: ORIGIN } });
    expect(response.status).toBe(200);
    const payload = await body<{ entries: Array<{ code: string; nick: string }> }>(response);
    expect(Array.isArray(payload.entries)).toBe(true);
    const row = payload.entries.find((entry) => entry.code === registered.state.code);
    if (row !== undefined) expect(row.nick).toBe("ranked");
  });
});
