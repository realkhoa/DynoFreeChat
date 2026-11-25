/**
 * @file bot-ai.ts
 * @brief LLM brain for the five AI bot gardens.
 * @details The model only proposes decisions; the worker validates every action
 * through the normal rule set, so a bad or hallucinated plan is rejected piece by
 * piece and the deterministic heuristic takes over when the model fails.
 */

import {
  CROPS_PER_TAB,
  PLOTS_PER_PATCH,
  SEEDS,
  parseGardenAction,
  type GardenAction,
  type SeasonSnapshot,
  type SeedId,
} from "@dyno/shared/garden";
import type { Env } from "./env";
import type { GardenLedger } from "./garden-rules";

/** How many AI-run bot gardens exist. */
export const AI_BOT_COUNT = 5;

/** Nicks used by the AI bots, in creation order. */
export const AI_BOT_NICKS: readonly string[] = [
  "Bot AI 01",
  "Bot AI 02",
  "Bot AI 03",
  "Bot AI 04",
  "Bot AI 05",
];

/** Default OpenAI-compatible endpoint: OpenRouter's free tier. */
export const DEFAULT_AI_BASE = "https://opencode.ai/inference/go/v1";

/** Default model; any free OpenAI-compatible chat model works. */
export const DEFAULT_AI_MODEL = "beam-free";

/** Faster non-reasoning model used when the free reasoning model rambles. */
export const DEFAULT_AI_FALLBACK_MODEL = "glm-5.3-flash";

/** Actions the model may choose. Gifts, prestige and insurance are excluded. */
export const AI_ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  "water",
  "waterAll",
  "harvest",
  "harvestAll",
  "harvestMushroom",
  "plant",
  "plantAll",
  "buySeed",
  "plantTree",
  "buyTree",
  "plantFruitSeed",
  "uproot",
  "uprootBulk",
  "sellAll",
  "sellAllProducts",
  "sellCrop",
  "sellProduct",
  "plantMushroom",
  "buyMushroomSpawn",
  "quickPlan",
  "fertilize",
  "fertilizeAll",
  "spray",
  "sprayAll",
  "sprayPest",
  "sprayPestAll",
  "buySupply",
  "buyPatch",
  "buyTab",
  "buyTool",
  "hireStaff",
  "fireStaff",
  "setStaffRole",
  "collectMachine",
  "craftMachine",
  "queueMachine",
  "clearMachineQueue",
  "setMachineLimit",
  "patAnimal",
  "feedAnimal",
  "breedAnimal",
  "buyAnimal",
  "sellAnimal",
  "buyMerchant",
  "claimQuest",
  "claimCodex",
  "spinWheel",
  "cookRecipe",
  "compostCrops",
]);

/** Result of one AI planning round. */
export interface AiPlan {
  /** Validated actions to run, in order. */
  readonly actions: GardenAction[];
  /** Short model-written plan summary, shown in the garden UI. */
  readonly reasoning: string | null;
  /** Trimmed raw chain of thought, when the provider exposes one. */
  readonly rawReasoning: string | null;
  /** Model id used, for the bot tick response. */
  readonly model: string;
  /** Why an empty plan happened, if it did. */
  readonly error: string | null;
}

/**
 * Compact, model-friendly context for one prompt.
 * @details Pre-computes the candidate slot lists so the model never has to count
 * garden cells: it only picks actions from the lists we hand it.
 */
export interface AiGardenContext {
  readonly coins: number;
  readonly prestige: number;
  /** Slots whose crop is ripe and can be harvested now. */
  readonly readySlots: readonly number[];
  /** Growing crop slots that still need water. */
  readonly drySlots: readonly number[];
  /** Dead crop slots waiting to be uprooted. */
  readonly deadSlots: readonly number[];
  /** Growing crop slots that would sell for less than their seed cost. */
  readonly lossSlots: readonly number[];
  /** Free, unlocked and undamaged crop slots. */
  readonly emptySlots: readonly number[];
  /** Tree slots with ripe fruit. */
  readonly treeReadySlots: readonly number[];
  /** Dead tree slots. */
  readonly treeDeadSlots: readonly number[];
  readonly bag: { seeds: Record<string, number>; crops: number; products: number };
  readonly trays: { empty: number; ripe: number };
  readonly staff: readonly string[];
  readonly shop: readonly { seed: string; price: number; stock: number }[];
  readonly neighbourhood: Record<string, number>;
  readonly planted: Record<string, number>;
  readonly totals: {
    plots: number;
    ready: number;
    dry: number;
    dead: number;
    trees: number;
  };
}
/** @brief Reads the AI model configuration, or `null` when unconfigured. */
export function aiConfig(
  env: Env,
): { base: string; model: string; fallbackModel: string; key: string } | null {
  const direct = typeof env.AI_BOT_API_KEY === "string" ? env.AI_BOT_API_KEY.trim() : "";
  // The recipe lab already ships an OpenCode Go key; reuse it when the bot key is unset.
  const shared = typeof env.OPENCODE_API_KEY === "string" ? env.OPENCODE_API_KEY.trim() : "";
  const raw = direct.length > 0 ? direct : shared;
  if (raw.length === 0) return null;
  const base =
    typeof env.AI_BOT_API_BASE === "string" && env.AI_BOT_API_BASE.trim().length > 0
      ? env.AI_BOT_API_BASE.trim()
      : DEFAULT_AI_BASE;
  const model =
    typeof env.AI_BOT_MODEL === "string" && env.AI_BOT_MODEL.trim().length > 0
      ? env.AI_BOT_MODEL.trim()
      : DEFAULT_AI_MODEL;
  const fallbackModel =
    typeof env.AI_BOT_FALLBACK_MODEL === "string" && env.AI_BOT_FALLBACK_MODEL.trim().length > 0
      ? env.AI_BOT_FALLBACK_MODEL.trim()
      : DEFAULT_AI_FALLBACK_MODEL;
  return { base: base.replace(/\/+$/, ""), model, fallbackModel, key: raw };
}

/** @brief Builds the lean, pre-counted context the model reasons over. */
export function summarizeGarden(
  ledger: GardenLedger,
  season: SeasonSnapshot,
  now: number,
  neighbourhood: Readonly<Record<string, number>>,
): AiGardenContext {
  const readySlots: number[] = [];
  const drySlots: number[] = [];
  const deadSlots: number[] = [];
  const lossSlots: number[] = [];
  const emptySlots: number[] = [];
  const planted: Record<string, number> = {};
  let occupied = 0;
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    const plot = ledger.plots[slot] ?? null;
    if (plot === null) {
      // Only open, undamaged cells are plantable.
      const tab = Math.floor(slot / CROPS_PER_TAB);
      const patch = Math.floor((slot % CROPS_PER_TAB) / PLOTS_PER_PATCH);
      if (tab < ledger.tabs && patch < (ledger.unlockedPatches[tab] ?? 0)) {
        if (ledger.damagedPlots?.[slot] !== true) emptySlots.push(slot);
      }
      continue;
    }
    occupied += 1;
    planted[plot.seed] = (planted[plot.seed] ?? 0) + 1;
    if (plot.dead === true) {
      deadSlots.push(slot);
      continue;
    }
    if (now >= plot.readyAt) {
      readySlots.push(slot);
      continue;
    }
    if (!plot.watered) drySlots.push(slot);
    const sell = (season.prices as Readonly<Record<string, number>>)[plot.seed] ?? 0;
    const cost =
      (season.buyPrices as Readonly<Record<string, number>> | undefined)?.[plot.seed] ??
      SEEDS.find((seed) => seed.id === plot.seed)?.buy ??
      0;
    if (cost > 0 && sell > 0 && sell <= cost) lossSlots.push(slot);
  }
  const treeReadySlots: number[] = [];
  const treeDeadSlots: number[] = [];
  let treeCount = 0;
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = ledger.trees[slot] ?? null;
    if (tree === null) continue;
    treeCount += 1;
    planted[tree.tree] = (planted[tree.tree] ?? 0) + 1;
    if (tree.dead === true) treeDeadSlots.push(slot);
    else if (now >= tree.readyAt) treeReadySlots.push(slot);
  }
  let traysEmpty = 0;
  let traysRipe = 0;
  for (const tray of ledger.mushroomTrays ?? []) {
    if (tray === null) traysEmpty += 1;
    else if (now >= tray.readyAt) traysRipe += 1;
  }
  return {
    coins: ledger.coins,
    prestige: ledger.prestige,
    readySlots,
    drySlots,
    deadSlots,
    lossSlots,
    emptySlots,
    treeReadySlots,
    treeDeadSlots,
    bag: {
      seeds: Object.fromEntries(
        Object.entries(ledger.bag.seeds).filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0),
      ),
      crops: ledger.bag.crops.reduce((sum, stack) => sum + stack.qty, 0),
      products: (ledger.bag.products ?? []).reduce((sum, stack) => sum + stack.qty, 0),
    },
    trays: { empty: traysEmpty, ripe: traysRipe },
    staff: ledger.staff.map((worker) => `${worker.role}:${worker.level}`),
    shop: season.shop.offers.slice(0, 8).map((offer) => ({
      seed: offer.seed,
      price: offer.price,
      stock: offer.stock,
    })),
    neighbourhood,
    planted: Object.fromEntries(Object.entries(planted).slice(0, 12)),
    totals: {
      plots: occupied,
      ready: readySlots.length,
      dry: drySlots.length,
      dead: deadSlots.length,
      trees: treeCount,
    },
  };
}
/** @brief Builds the system and user messages for one planning call. */
export function buildAiMessages(context: AiGardenContext): { role: "system" | "user"; content: string }[] {
  const system = [
    "You run a farm. Reply with STRICT JSON only, nothing else:",
    '{"reasoning":"one short sentence", "actions":[{"kind":"...", ...fields}]} — at most 8 actions, execution order.',
    "The state already contains exact slot lists: readySlots, drySlots, deadSlots, lossSlots, emptySlots, treeReadySlots, treeDeadSlots.",
    "Do NOT recount or dump the state. Pick slots directly from those lists.",
    "Allowed actions:",
    "harvest {slot,tree}, harvestAll {}, water {slot,tree}, waterAll {}, harvestMushroom {slot},",
    "plant {slot,seed}, plantAll {seed}, buySeed {seed,qty}, plantTree {slot,tree},",
    "uproot {slot,tree}, uprootBulk {dead?,priceBelow?,profit?}, sellAll {}, sellCrop {item,effects,star,qty},",
    "quickPlan {}, plantMushroom {slot,mushroom}, buyMushroomSpawn {mushroom,qty},",
    "buySupply {supply,qty}, buyPatch {tab}, buyTab {}, setStaffRole {index,role}.",
    "Priority: 1) uprootBulk {dead:true} and uproot lossSlots, 2) harvest readySlots",
    "and treeReadySlots (or harvestAll), 3) sellAll when bag.crops>0, 4) water drySlots,",
    "5) plant emptySlots with profitable seeds while diversifying from neighbourhood,",
    "6) open land when coins are high. Keep reasoning to one sentence, then the actions.",
  ].join("\n");
  const user = ["State:", JSON.stringify(context), "Reply with the JSON object only."].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
/** @brief Extracts the first JSON object from a model reply, tolerating fences. */
export function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** @brief Validates a model reply into a plan summary plus real actions. */
export function parseAiPlan(raw: string, limit = 8): { reasoning: string | null; actions: GardenAction[] } {
  const parsed = extractJson(raw);
  if (parsed === null || typeof parsed !== "object") return { reasoning: null, actions: [] };
  const record = parsed as { actions?: unknown; reasoning?: unknown };
  const reasoning =
    typeof record.reasoning === "string" && record.reasoning.trim().length > 0
      ? record.reasoning.trim().slice(0, 400)
      : null;
  const list = record.actions;
  if (!Array.isArray(list)) return { reasoning, actions: [] };
  const actions: GardenAction[] = [];
  for (const entry of list) {
    if (actions.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !AI_ALLOWED_ACTIONS.has(kind)) continue;
    const action = parseGardenAction(entry);
    if (action !== null) actions.push(action);
  }
  return { reasoning, actions };
}

/** @brief Validates model decisions into real garden actions. */
export function parseAiDecisions(raw: string, limit = 8): GardenAction[] {
  return parseAiPlan(raw, limit).actions;
}

/**
 * @brief Trims a raw chain of thought to a readable excerpt.
 * @param text Provider reasoning text.
 * @param max Maximum characters to keep.
 * @details Cuts on a sentence boundary when possible so the UI never shows a
 * half-word, and always ends with an ellipsis when shortened.
 */
export function trimReasoning(text: string, max = 600): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (boundary > max * 0.4) return `${slice.slice(0, boundary + 1)}…`;
  const space = slice.lastIndexOf(" ");
  return `${slice.slice(0, space > 0 ? space : max)}…`;
}

/** @brief Asks the model to plan one round; never throws. */
export async function planAiActions(
  env: Env,
  ledger: GardenLedger,
  season: SeasonSnapshot,
  now: number,
  neighbourhood: Readonly<Record<string, number>>,
  fetchImpl: typeof fetch = fetch,
  session = "dynofreechat-bot-ai",
): Promise<AiPlan> {
  const config = aiConfig(env);
  if (config === null) {
    return {
      actions: [],
      reasoning: null,
      rawReasoning: null,
      model: "none",
      error: "AI_BOT_API_KEY is not configured",
    };
  }
  const context = summarizeGarden(ledger, season, now, neighbourhood);
  const messages = buildAiMessages(context);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.key}`,
    "user-agent": "DynoFreeChat/1.0",
  };
  if (config.base.includes("opencode.ai")) {
    headers["x-opencode-session"] = `${session}-${Date.now()}`;
  } else {
    headers["http-referer"] = "https://realkhoa.github.io/DynoFreeChat/";
    headers["x-title"] = "DynoFreeChat AI bots";
  }

  type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
  type ChatReply = { content: string | null; reasoning: string; finish: string };
  type CallResult = { ok: true; reply: ChatReply } | { ok: false; status: number; detail: string };

  /** One chat completion with its own model, budget and timeout. */
  const callModel = async (
    model: string,
    input: ChatMessage[],
    maxTokens: number,
    timeoutMs: number,
    effort: "low" | null,
  ): Promise<CallResult> => {
    try {
      const response = await fetchImpl(`${config.base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: input,
          temperature: 0.2,
          max_tokens: maxTokens,
          ...(effort === null ? {} : { reasoning_effort: effort }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
      }
      const payload = (await response.json()) as {
        choices?: Array<{
          finish_reason?: unknown;
          message?: { content?: unknown; reasoning_content?: unknown };
        }>;
      };
      const choice = payload.choices?.[0];
      const message = choice?.message;
      return {
        ok: true,
        reply: {
          content:
            typeof message?.content === "string" && message.content.trim().length > 0
              ? message.content
              : null,
          reasoning: typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "",
          finish: typeof choice?.finish_reason === "string" ? choice.finish_reason : "",
        },
      };
    } catch (error) {
      return { ok: false, status: 0, detail: (error as Error).message };
    }
  };

  const strictMessages: ChatMessage[] = [
    ...messages,
    { role: "user", content: "Answer now with ONLY the JSON object. No prose and no markdown." },
  ];
  const attempts: Array<{
    model: string;
    input: ChatMessage[];
    maxTokens: number;
    timeoutMs: number;
    effort: "low" | null;
  }> = [
    { model: config.model, input: messages, maxTokens: 4_000, timeoutMs: 25_000, effort: "low" },
    { model: config.model, input: strictMessages, maxTokens: 4_000, timeoutMs: 25_000, effort: "low" },
    // Free reasoning models occasionally ramble past every budget: ask a fast
    // non-reasoning model for the decision instead of falling back to heuristics.
    { model: config.fallbackModel, input: strictMessages, maxTokens: 1_200, timeoutMs: 20_000, effort: null },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    const result = await callModel(
      attempt.model,
      attempt.input,
      attempt.maxTokens,
      attempt.timeoutMs,
      attempt.effort,
    );
    if (!result.ok) {
      errors.push(`${attempt.model}: ${result.detail}`);
      continue;
    }
    const { content, reasoning, finish } = result.reply;
    if (content !== null) {
      const plan = parseAiPlan(content);
      const rawReasoning = reasoning.length > 0 ? trimReasoning(reasoning) : null;
      if (plan.actions.length > 0) {
        return {
          actions: plan.actions,
          reasoning: plan.reasoning ?? rawReasoning,
          rawReasoning,
          model: attempt.model,
          error: null,
        };
      }
      errors.push(`${attempt.model}: no usable actions`);
      continue;
    }
    const fromReasoning = parseAiPlan(reasoning);
    if (fromReasoning.actions.length > 0) {
      return {
        actions: fromReasoning.actions,
        reasoning: fromReasoning.reasoning ?? trimReasoning(reasoning),
        rawReasoning: trimReasoning(reasoning),
        model: attempt.model,
        error: null,
      };
    }
    errors.push(
      `${attempt.model}: no content (finish=${finish || "?"}, reasoning=${reasoning.length} chars)`,
    );
  }
  return {
    actions: [],
    reasoning: null,
    rawReasoning: null,
    model: config.model,
    error: errors.join("; ") || "model failed",
  };
}

/** @brief Seeds suggested to the model as a cheap fallback hint. */
export function seedHints(): string[] {
  return SEEDS.filter((seed) => seed.regrow).map((seed) => seed.id);
}

/** @brief Unused helpers kept for the bot tests. */
export const BOT_LAYOUT = { CROPS_PER_TAB, PLOTS_PER_PATCH } as const;
