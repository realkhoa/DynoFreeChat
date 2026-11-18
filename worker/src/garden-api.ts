/**
 * @file garden-api.ts
 * @brief HTTP surface for ASCII Garden: registration, play, visits, ranking.
 * @details The Worker is a thin trust boundary. It gates the routes with the same
 * access lock as the market, parses credentials, resolves a share code to its
 * player, and forwards to the Durable Object that owns the garden. Validation
 * and every writable rule stay in the object, so two tabs or two devices cannot
 * fork one garden.
 */

import {
  GARDEN_AUTH_HEADER,
  GARDEN_CODE_LENGTH,
  applyBuyMarket,
  applyMarket,
  isGardenCode,
  isRecoveryKey,
  parseGardenAuth,
  seasonAt,
  type GardenCredentials,
  type MarketSnapshot,
} from "@dyno/shared/garden";
import { LOCK_HEADER } from "@dyno/shared/market";
import { sanitizeColor, sanitizeNick } from "@dyno/shared/protocol";
import { lockSecrets, verifySession } from "./auth";
import type { Env } from "./env";
import { GARDEN_TOKEN_HEADER, HUB_NAME, MARKET_HEADER } from "./garden";
import { MARKET_BOARD_NAME } from "./market-board";
import { json, readJson } from "./http";
import { randomCode, randomRecoveryKey, sha256Hex } from "./secrets";

/**
 * @brief Routes one garden request.
 * @param request Incoming request.
 * @param env Bindings.
 * @param url Parsed URL.
 * @return The response, or `null` when the path is not a garden route.
 */
export async function handleGardenRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/garden/")) return null;

  const secrets = lockSecrets(env);
  if (secrets !== null) {
    const unlocked = await verifySession(secrets, request.headers.get(LOCK_HEADER), Date.now());
    if (!unlocked) return json({ code: "LOCKED" }, 401);
  }

  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const name = parts[2];
  const now = Date.now();

  if (name === "register" && request.method === "POST") return registerGarden(request, env, now);
  if (name === "restore" && request.method === "POST") return restoreGarden(request, env);
  if (name === "season" && request.method === "GET") return seasonRoute(env, now);
  if (name === "market" && request.method === "GET") return marketRoute(env);
  if (name === "leaderboard" && request.method === "GET") return leaderboard(env, url);
  if (name === "visit") {
    const code = parts[3];
    const action = parts[4];
    if (code === undefined || !isGardenCode(code)) return json({ code: "BAD_CODE" }, 400);
    if (action === "water" && request.method === "POST") return waterVisit(request, env, code);
    if (action === "cheer" && request.method === "POST") return cheerVisit(request, env, code);
    if (request.method === "GET" && action === undefined) return visitGarden(env, code);
    return json({ code: "NOT_FOUND" }, 404);
  }

  const auth = parseGardenAuth(request.headers.get(GARDEN_AUTH_HEADER));
  if (auth === null) return json({ code: "UNAUTHORIZED" }, 401);

  if (name === "state" && request.method === "GET") return ownerResponse(env, auth, "/state", "GET", now);
  if (name === "act" && request.method === "POST")
    return ownerResponse(env, auth, "/act", "POST", now, request);
  if (name === "profile" && request.method === "POST")
    return forwardOwner(env, auth, "/profile", "POST", request);
  if (name === "recovery" && request.method === "POST")
    return forwardOwner(env, auth, "/recovery", "POST", request);

  return json({ code: "NOT_FOUND" }, 404);
}

/** @brief Durable Object stub for one player's garden. */
function gardenStub(env: Env, playerId: string): DurableObjectStub {
  return env.GARDEN.get(env.GARDEN.idFromName(playerId));
}

/** @brief Durable Object stub for the singleton directory. */
function hubStub(env: Env): DurableObjectStub {
  return env.GARDEN_HUB.get(env.GARDEN_HUB.idFromName(HUB_NAME));
}

/** @brief Headers for one owner request. */
function ownerHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", [GARDEN_TOKEN_HEADER]: token };
}

/** @brief Forwards an owner request to its garden object. */
async function forwardOwner(
  env: Env,
  auth: GardenCredentials,
  path: string,
  method: "GET" | "POST",
  request?: Request,
): Promise<Response> {
  const body = request === undefined ? undefined : await request.text();
  return gardenStub(env, auth.playerId).fetch(`https://garden${path}`, {
    method,
    headers: ownerHeaders(auth.token),
    body: body === undefined || body.length === 0 ? undefined : body,
  });
}

/** Market context for one request: snapshot plus the header Garden consumes. */
interface MarketContext {
  readonly snapshot: MarketSnapshot;
  readonly header: string;
  readonly stub: DurableObjectStub;
}

/** @brief Loads the global market board and encodes its multipliers. */
async function marketContext(env: Env): Promise<MarketContext | null> {
  try {
    const stub = env.MARKET.get(env.MARKET.idFromName(MARKET_BOARD_NAME));
    const response = await stub.fetch("https://market/snapshot");
    if (!response.ok) return null;
    const snapshot = (await response.json()) as MarketSnapshot;
    const sell: Record<string, number> = {};
    for (const item of snapshot.items) sell[item.item] = item.multiplier;
    const buy: Record<string, number> = {};
    for (const offer of snapshot.offers) buy[offer.item] = offer.multiplier;
    return { snapshot, header: encodeURIComponent(JSON.stringify({ sell, buy })), stub };
  } catch {
    return null;
  }
}

/** @brief Forwards one owner request with market pricing attached. */
async function ownerResponse(
  env: Env,
  auth: GardenCredentials,
  path: string,
  method: "GET" | "POST",
  now: number,
  request?: Request,
): Promise<Response> {
  const context = await marketContext(env);
  const body = request === undefined ? undefined : await request.text();
  const headers = ownerHeaders(auth.token);
  if (context !== null) headers[MARKET_HEADER] = context.header;
  const response = await gardenStub(env, auth.playerId).fetch(`https://garden${path}`, {
    method,
    headers,
    body: body === undefined || body.length === 0 ? undefined : body,
  });
  if (!response.ok) return response;

  const payload = (await response.json()) as Record<string, unknown>;
  const sold = payload.sold;
  const bought = payload.bought;
  if (context !== null && path === "/act" && typeof bought === "object" && bought !== null) {
    for (const [item, qty] of Object.entries(bought as Record<string, unknown>)) {
      if (typeof qty !== "number" || qty < 1) continue;
      await context.stub.fetch("https://market/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item, qty }),
      });
    }
  }
  if (context !== null && path === "/act" && typeof sold === "object" && sold !== null) {
    for (const [item, qty] of Object.entries(sold as Record<string, unknown>)) {
      if (typeof qty !== "number" || qty < 1) continue;
      await context.stub.fetch("https://market/record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item, qty }),
      });
    }
  }
  if (context !== null) payload.market = context.snapshot;
  return json(payload);
}

/** @brief Season snapshot with the global market pressure applied. */
async function seasonRoute(env: Env, now: number): Promise<Response> {
  const context = await marketContext(env);
  let season = seasonAt(now);
  if (context !== null) {
    const sell: Record<string, number> = {};
    for (const item of context.snapshot.items) sell[item.item] = item.multiplier;
    const buy: Record<string, number> = {};
    for (const offer of context.snapshot.offers) buy[offer.item] = offer.multiplier;
    season = applyBuyMarket(applyMarket(season, sell), buy);
  }
  return json({ season, market: context?.snapshot ?? null, serverNow: now });
}

/** @brief Live market board for the chart tab. */
async function marketRoute(env: Env): Promise<Response> {
  const context = await marketContext(env);
  if (context === null) return json({ code: "MARKET_UNAVAILABLE" }, 503);
  return json({ market: context.snapshot, serverNow: Date.now() });
}

/** @brief Resolves one public share code to its owner. */
async function ownerByCode(env: Env, code: string): Promise<string | null> {
  const response = await hubStub(env).fetch(`https://hub/by-code?code=${encodeURIComponent(code)}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { playerId?: unknown };
  return typeof body.playerId === "string" ? body.playerId : null;
}

/** @brief Verifies a visitor token and returns the identity behind it. */
async function visitorIdentity(
  env: Env,
  auth: GardenCredentials,
): Promise<{ playerId: string; nick: string; color: string } | null> {
  const response = await gardenStub(env, auth.playerId).fetch("https://garden/identity", {
    method: "POST",
    headers: ownerHeaders(auth.token),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { playerId?: unknown; nick?: unknown; color?: unknown };
  if (typeof body.playerId !== "string" || typeof body.nick !== "string" || typeof body.color !== "string") {
    return null;
  }
  return { playerId: body.playerId, nick: body.nick, color: body.color };
}

/**
 * @brief Creates a garden with credentials no one can guess.
 * @details The code is the only public key and is unique in the Hub; the recovery
 * key is shown once, so a new device can claim the same player id later.
 */
async function registerGarden(request: Request, env: Env, now: number): Promise<Response> {
  const body = await readJson(request);
  const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
  if (!nick.ok) return json({ code: "BAD_REQUEST" }, 400);

  const color = sanitizeColor(body.color);
  const playerId = crypto.randomUUID();
  const recovery = randomRecoveryKey();
  const recoveryHash = await sha256Hex(recovery);
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const hub = hubStub(env);

  let code: string | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomCode(GARDEN_CODE_LENGTH);
    const response = await hub.fetch("https://hub/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, code: candidate, nick: nick.nick, color, recoveryHash, ip, now }),
    });
    if (response.status === 201) {
      code = candidate;
      break;
    }
    const error = (await response.json()) as { code?: unknown };
    if (error.code === "CODE_EXISTS") continue;
    return json(error, response.status);
  }
  if (code === null) return json({ code: "TRY_LATER" }, 429);

  const registered = await gardenStub(env, playerId).fetch("https://garden/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId, code, nick: nick.nick, color, recoveryHash, now }),
  });
  if (!registered.ok) {
    await hub.fetch("https://hub/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    return registered;
  }

  const payload = (await registered.json()) as {
    token: string;
    state: unknown;
    season: unknown;
    serverNow: number;
  };
  return json(
    {
      playerId,
      token: payload.token,
      recovery,
      state: payload.state,
      season: payload.season,
      serverNow: payload.serverNow,
    },
    201,
  );
}

/**
 * @brief Restores a garden on a new device from its recovery key.
 * @details Rotating the write token makes the old device lose write access while
 * the garden, nickname, plots and leaderboard row stay exactly where they were.
 */
async function restoreGarden(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const recovery = body.recovery;
  if (typeof recovery !== "string" || !isRecoveryKey(recovery)) {
    return json({ code: "BAD_RECOVERY" }, 400);
  }
  const recoveryHash = await sha256Hex(recovery);
  const lookup = await hubStub(env).fetch(`https://hub/by-recovery?hash=${recoveryHash}`);
  if (!lookup.ok) return json({ code: "BAD_RECOVERY" }, 404);
  const found = (await lookup.json()) as { playerId?: unknown };
  if (typeof found.playerId !== "string") return json({ code: "BAD_RECOVERY" }, 404);

  const nick = sanitizeNick(typeof body.nick === "string" ? body.nick : "");
  const issued = await gardenStub(env, found.playerId).fetch("https://garden/issue-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recoveryHash,
      nick: nick.ok ? nick.nick : undefined,
      color: sanitizeColor(body.color),
    }),
  });
  if (!issued.ok) return issued;
  const payload = (await issued.json()) as {
    token: string;
    state: unknown;
    season: unknown;
    serverNow: number;
  };
  return json({
    playerId: found.playerId,
    token: payload.token,
    state: payload.state,
    season: payload.season,
    serverNow: payload.serverNow,
  });
}

/** @brief Public read-only visit snapshot. */
async function visitGarden(env: Env, code: string): Promise<Response> {
  const playerId = await ownerByCode(env, code);
  if (playerId === null) return json({ code: "NO_GARDEN" }, 404);
  return gardenStub(env, playerId).fetch("https://garden/snapshot");
}

/** @brief Friend watering; the visitor must carry valid credentials. */
async function waterVisit(request: Request, env: Env, code: string): Promise<Response> {
  const auth = parseGardenAuth(request.headers.get(GARDEN_AUTH_HEADER));
  if (auth === null) return json({ code: "UNAUTHORIZED" }, 401);
  const visitor = await visitorIdentity(env, auth);
  if (visitor === null) return json({ code: "UNAUTHORIZED" }, 401);

  const ownerId = await ownerByCode(env, code);
  if (ownerId === null) return json({ code: "NO_GARDEN" }, 404);
  if (ownerId === auth.playerId) return json({ code: "CANNOT_VISIT_SELF" }, 400);

  const body = await readJson(request);
  return gardenStub(env, ownerId).fetch("https://garden/water-guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      visitorId: visitor.playerId,
      nick: visitor.nick,
      color: visitor.color,
      slot: body.slot,
      tree: body.tree === true,
    }),
  });
}

/** @brief Leaves one cheer on a friend's garden. */
async function cheerVisit(request: Request, env: Env, code: string): Promise<Response> {
  const auth = parseGardenAuth(request.headers.get(GARDEN_AUTH_HEADER));
  if (auth === null) return json({ code: "UNAUTHORIZED" }, 401);
  const visitor = await visitorIdentity(env, auth);
  if (visitor === null) return json({ code: "UNAUTHORIZED" }, 401);

  const ownerId = await ownerByCode(env, code);
  if (ownerId === null) return json({ code: "NO_GARDEN" }, 404);
  if (ownerId === auth.playerId) return json({ code: "CANNOT_VISIT_SELF" }, 400);

  return gardenStub(env, ownerId).fetch("https://garden/cheer-guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitorId: visitor.playerId, nick: visitor.nick, color: visitor.color }),
  });
}

/** @brief Top gardens by earned coins. */
async function leaderboard(env: Env, url: URL): Promise<Response> {
  const limit = url.searchParams.get("limit") ?? "20";
  return hubStub(env).fetch(`https://hub/leaderboard?limit=${encodeURIComponent(limit)}`);
}
