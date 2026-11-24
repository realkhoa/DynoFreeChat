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

/** Compact, model-friendly context for one prompt. */
export interface AiGardenContext {
  readonly coins: number;
  readonly prestige: number;
  readonly plots: readonly {
    slot: number;
    seed: SeedId;
    readyInSec: number;
    watered: boolean;
    dead: boolean;
    pest: boolean;
  }[];
  readonly trees: readonly {
    slot: number;
    tree: string;
    readyInSec: number;
    watered: boolean;
    dead: boolean;
  }[];
  readonly bag: { seeds: Record<string, number>; crops: number; products: number };
  readonly trays: { empty: number; ripe: number; growing: number };
  readonly totals?: {
    plots: number;
    ready: number;
    dry: number;
    dead: number;
    trees: number;
  };
  readonly staff: readonly { role: string; level: number }[];
  readonly shop: readonly { seed: string; price: number; stock: number }[];
  readonly neighbourhood: Record<string, number>;
  readonly planted: Record<string, number>;
}

/** @brief Reads the AI model configuration, or `null` when unconfigured. */
export function aiConfig(env: Env): { base: string; model: string; key: string } | null {
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
  return { base: base.replace(/\/+$/, ""), model, key: raw };
}

/** @brief Builds the lean context the model reasons over. */
export function summarizeGarden(
  ledger: GardenLedger,
  season: SeasonSnapshot,
  now: number,
  neighbourhood: Readonly<Record<string, number>>,
): AiGardenContext {
  const plots: AiGardenContext["plots"][number][] = [];
  const planted: Record<string, number> = {};
  for (let slot = 0; slot < ledger.plots.length; slot += 1) {
    const plot = ledger.plots[slot] ?? null;
    if (plot === null) continue;
    planted[plot.seed] = (planted[plot.seed] ?? 0) + 1;
    plots.push({
      slot,
      seed: plot.seed,
      readyInSec: Math.max(0, Math.ceil((plot.readyAt - now) / 1_000)),
      watered: plot.watered,
      dead: plot.dead === true,
      pest: plot.pest,
    });
  }
  const trees: AiGardenContext["trees"][number][] = [];
  for (let slot = 0; slot < ledger.trees.length; slot += 1) {
    const tree = ledger.trees[slot] ?? null;
    if (tree === null) continue;
    planted[tree.tree] = (planted[tree.tree] ?? 0) + 1;
    trees.push({
      slot,
      tree: tree.tree,
      readyInSec: Math.max(0, Math.ceil((tree.readyAt - now) / 1_000)),
      watered: tree.watered,
      dead: tree.dead === true,
    });
  }
  // Keep the prompt small: list the most urgent cells only (ready, then dead/dry).
  const plotPriority = (entry: AiGardenContext["plots"][number]): number =>
    entry.readyInSec === 0 ? 0 : entry.dead ? 1 : entry.watered ? 3 : 2;
  const listedPlots = [...plots].sort((left, right) => plotPriority(left) - plotPriority(right)).slice(0, 30);
  const listedTrees = [...trees]
    .sort((left, right) => (left.readyInSec === 0 ? 0 : 1) - (right.readyInSec === 0 ? 0 : 1))
    .slice(0, 10);
  let traysEmpty = 0;
  let traysRipe = 0;
  let traysGrowing = 0;
  for (const tray of ledger.mushroomTrays ?? []) {
    if (tray === null) traysEmpty += 1;
    else if (now >= tray.readyAt) traysRipe += 1;
    else traysGrowing += 1;
  }
  return {
    coins: ledger.coins,
    prestige: ledger.prestige,
    plots: listedPlots,
    trees: listedTrees,
    bag: {
      seeds: Object.fromEntries(
        Object.entries(ledger.bag.seeds).filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0),
      ),
      crops: ledger.bag.crops.reduce((sum, stack) => sum + stack.qty, 0),
      products: (ledger.bag.products ?? []).reduce((sum, stack) => sum + stack.qty, 0),
    },
    trays: { empty: traysEmpty, ripe: traysRipe, growing: traysGrowing },
    staff: ledger.staff.map((worker) => ({ role: worker.role, level: worker.level })),
    shop: season.shop.offers.slice(0, 12).map((offer) => ({
      seed: offer.seed,
      price: offer.price,
      stock: offer.stock,
    })),
    totals: {
      plots: plots.length,
      ready: plots.filter((entry) => entry.readyInSec === 0).length,
      dry: plots.filter((entry) => !entry.watered && entry.readyInSec > 0).length,
      dead: plots.filter((entry) => entry.dead).length,
      trees: trees.length,
    },
    neighbourhood,
    planted,
  };
}

/** @brief Builds the system and user messages for one planning call. */
export function buildAiMessages(context: AiGardenContext): { role: "system" | "user"; content: string }[] {
  const system = [
    "You are an expert player of a farming game. Reply with STRICT JSON only:",
    '{"reasoning":"one or two short sentences explaining the plan", "actions":[{"kind":"...", ...fields}]}.',
    "Keep reasoning under 200 characters; actions at most 8, in execution order.",
    "Allowed action kinds and fields:",
    "water {slot,tree}, waterAll {}, harvest {slot,tree}, harvestAll {},",
    "harvestMushroom {slot}, plant {slot,seed}, plantAll {seed}, buySeed {seed,qty},",
    "plantTree {slot,tree}, buyTree {tree}, uproot {slot,tree}, uprootBulk {dead?,priceBelow?,profit?},",
    "sellAll {}, sellCrop {item,effects,star,qty}, plantMushroom {slot,mushroom},",
    "buyMushroomSpawn {mushroom,qty}, quickPlan {}, fertilize {slot,supply,tree},",
    "spray {slot,supply,tree}, buySupply {supply,qty}, buyPatch {tab}, buyTab {},",
    "buyTool {tool,qty}, hireStaff {id}, setStaffRole {index,role},",
    "collectMachine {machine}, queueMachine {machine,item?,qty?}, patAnimal {building,slot},",
    "buyAnimal {building,slot,animal}, sellAnimal {building,slot}, claimQuest {id}, spinWheel {}.",
    "Priorities: 1) uproot every dead or loss-making plant, 2) harvest ripe plants,",
    "3) sell the finished bag, 4) water dry plants, 5) plant every empty cell with",
    "profitable seeds while diversifying away from the neighbourhood survey,",
    "6) open land when coins pile up. Never uproot a ripe or healthy profitable plant.",
  ].join("\n");
  const user = ["Current garden state:", JSON.stringify(context), "Return only the JSON object."].join("\n");
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
  try {
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
    type ChatReply = {
      content: string | null;
      reasoning: string;
      finish: string;
    };
    const callModel = async (
      input: ChatMessage[],
      maxTokens: number,
    ): Promise<{ ok: true; reply: ChatReply } | { ok: false; status: number }> => {
      const response = await fetchImpl(`${config.base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: input,
          temperature: 0.3,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) return { ok: false, status: response.status };
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
    };

    let result = await callModel(messages, 3_000);
    if (!result.ok) {
      return {
        actions: [],
        reasoning: null,
        rawReasoning: null,
        model: config.model,
        error: `model HTTP ${result.status}`,
      };
    }
    // A reasoning model can burn the whole budget on chain-of-thought and return
    // empty content; retry once with a bigger budget and an explicit "JSON only".
    if (result.reply.content === null) {
      const fromReasoning = parseAiPlan(result.reply.reasoning);
      if (fromReasoning.actions.length > 0) {
        return {
          actions: fromReasoning.actions,
          reasoning: fromReasoning.reasoning ?? trimReasoning(result.reply.reasoning),
          rawReasoning: trimReasoning(result.reply.reasoning),
          model: config.model,
          error: null,
        };
      }
      const retryMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: "Answer now with ONLY the JSON object. No prose and no markdown." },
      ];
      result = await callModel(retryMessages, 4_000);
      if (!result.ok) {
        return {
          actions: [],
          reasoning: null,
          rawReasoning: null,
          model: config.model,
          error: `model HTTP ${result.status}`,
        };
      }
    }
    if (result.reply.content === null) {
      return {
        actions: [],
        reasoning: null,
        rawReasoning: trimReasoning(result.reply.reasoning) || null,
        model: config.model,
        error: `model returned no content (finish=${result.reply.finish || "?"}, reasoning=${result.reply.reasoning.length} chars)`,
      };
    }
    const plan = parseAiPlan(result.reply.content);
    // Prefer the short plan summary; keep the raw chain of thought as an excerpt.
    const rawReasoning = result.reply.reasoning.length > 0 ? trimReasoning(result.reply.reasoning) : null;
    return {
      actions: plan.actions,
      reasoning: plan.reasoning ?? rawReasoning,
      rawReasoning,
      model: config.model,
      error: plan.actions.length === 0 ? "model returned no usable actions" : null,
    };
  } catch (error) {
    return {
      actions: [],
      reasoning: null,
      rawReasoning: null,
      model: config.model,
      error: (error as Error).message,
    };
  }
}

/** @brief Seeds suggested to the model as a cheap fallback hint. */
export function seedHints(): string[] {
  return SEEDS.filter((seed) => seed.regrow).map((seed) => seed.id);
}

/** @brief Unused helpers kept for the bot tests. */
export const BOT_LAYOUT = { CROPS_PER_TAB, PLOTS_PER_PATCH } as const;
