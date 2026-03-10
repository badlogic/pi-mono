/**
 * Demo 2: HackerNews Energy-Aware Watcher
 *
 * Polls real HackerNews top stories and uses a Neuralwatt LLM to score each
 * title's relevance against configurable keywords. Runs baseline and energy-aware
 * policies side by side — energy savings compound as the budget tightens,
 * triggering routing from Kimi K2.5 down to GPT-OSS-20B (13x cheaper, 2.8x
 * more energy-efficient).
 *
 * Learned memory: persists score agreement observations across runs so each
 * startup displays routing quality confidence from previous sessions.
 *
 * Usage:
 *   npx tsx src/demos/hn-watcher.ts [--duration <seconds>] [--budget <joules>]
 *     [--keywords "AI,LLM,GPU,RAG"] [--fast] [--clear-memory]
 *
 * Requires NEURALWATT_API_KEY in the environment.
 */

import { parseArgs } from "node:util";
import type {
	EnergyBudget,
	PolicyContext,
	PolicyDecision,
	RuntimePolicy,
	UsageWithEnergy,
} from "@mariozechner/pi-agent-core";
import { BaselinePolicy, EnergyAwarePolicy } from "@mariozechner/pi-agent-core";
import {
	type AssistantMessage,
	completeSimple,
	type Message,
	type Model,
	registerBuiltInApiProviders,
} from "@mariozechner/pi-ai";
import { type DiscriminatorConfig, discriminate } from "./demo-discriminator.js";
import {
	clearMemory,
	formatHNMemory,
	type HNMemory,
	hnRoutingConfidence,
	loadMemory,
	saveMemory,
} from "./demo-memory.js";

// -- Constants ----------------------------------------------------------------

const HN_TOP_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";

const DEFAULT_KEYWORDS = [
	"AI agents",
	"LLM inference",
	"energy efficiency",
	"open source AI",
	"Claude",
	"Anthropic",
	"transformer",
	"GPU compute",
	"sustainable AI",
	"model routing",
];

/** Shared base for all NeuralWatt models. */
const NW_BASE = {
	api: "openai-completions" as const,
	provider: "neuralwatt" as const,
	baseUrl: "https://api.neuralwatt.com/v1",
	reasoning: false,
	input: ["text"] as ["text"],
};

const GPT_OSS_MODEL: Model<"openai-completions"> = {
	// 0.50 tok/J, $0.03/$0.16 per 1M — cheapest model
	id: "openai/gpt-oss-20b",
	name: "GPT-OSS 20B",
	...NW_BASE,
	cost: { input: 0.03, output: 0.16, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_384,
	maxTokens: 4_096,
};

const DEVSTRAL_MODEL: Model<"openai-completions"> = {
	// 22.35 tok/J, $0.12/$0.35 per 1M — most energy-efficient, 262K context
	id: "mistralai/Devstral-Small-2-24B-Instruct-2512",
	name: "Devstral-24B",
	...NW_BASE,
	cost: { input: 0.12, output: 0.35, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 8_192,
};

const KIMI_MODEL: Model<"openai-completions"> = {
	// 0.21 tok/J, $0.52/$2.59 per 1M, 262K context — CoT/thinking
	id: "moonshotai/Kimi-K2.5",
	name: "Kimi K2.5",
	...NW_BASE,
	cost: { input: 0.52, output: 2.59, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 16_384,
};

const KIMI_FAST_MODEL: Model<"openai-completions"> = {
	// Fast alias of Kimi K2.5 — speed-optimized, $0.52/$2.59 per 1M
	id: "kimi-k2.5-fast",
	name: "Kimi K2.5 Fast",
	...NW_BASE,
	cost: { input: 0.52, output: 2.59, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 16_384,
};

/** Models available for EnergyAwarePolicy routing (cheapest-first order). */
const NEURALWATT_MODELS: Model<"openai-completions">[] = [GPT_OSS_MODEL, DEVSTRAL_MODEL, KIMI_MODEL];

/**
 * Start on Kimi K2.5 (0.21 tokens/J) — policy will route to
 * GPT-OSS-20B (0.50 tokens/J, 2.4x more efficient, 13x cheaper) at >70% budget pressure.
 */
const SCORING_MODEL = KIMI_MODEL;

const DEFAULT_DURATION_S = 120;
/**
 * Budget sized so routing kicks in after ~5 stories.
 * Kimi K2.5 at 0.482 tokens/J with ~250 tokens per scoring call ~= 519J each.
 * Budget 3500J: routing fires at story 5 (2595J / 3500J = 74%+ pressure).
 */
const DEFAULT_BUDGET_JOULES = 3_500;

/** Memory key for this routing pair. */
const MEMORY_KEY = "kimi-k2.5→gpt-oss-20b";

/** Energy efficiency (tokens per joule) from portal.neuralwatt.com. */
const TOKENS_PER_JOULE: Record<string, number> = {
	"mistralai/Devstral-Small-2-24B-Instruct-2512": 22.35,
	"Qwen/Qwen3.5-397B-A17B-FP8": 1.03,
	"openai/gpt-oss-20b": 0.5,
	"moonshotai/Kimi-K2.5": 0.21,
	"kimi-k2.5-fast": 0.21,
};

/**
 * Discriminator config for the HN watcher.
 * Three tiers for story scoring:
 *   complex → Kimi K2.5: ambiguous title, niche topic, nuanced reasoning needed
 *   medium  → Devstral-24B: moderately clear title, some judgment required
 *   simple  → GPT-OSS-20B: clear title, obvious relevance or irrelevance
 * No "thinking" tier — scoring tasks don't require chain-of-thought.
 */
const HN_DISCRIMINATOR_CONFIG: DiscriminatorConfig = {
	classifierModel: GPT_OSS_MODEL,
	complex: { model: KIMI_MODEL },
	medium: { model: DEVSTRAL_MODEL, briefMaxTokens: 8 },
	simple: { model: GPT_OSS_MODEL, briefMaxTokens: 8 }, // just a number 0.0–1.0
	tokensPerJoule: TOKENS_PER_JOULE,
	systemPrompt:
		"You are a routing classifier for a relevance-scoring pipeline.\n" +
		"Classify whether scoring a HackerNews story title requires a capable, moderate, or efficient model.\n" +
		'"complex" → Kimi K2.5: ambiguous title, specialized niche topic, nuanced judgment required.\n' +
		'"medium"  → Devstral-24B: moderately clear but needs some domain knowledge.\n' +
		'"simple"  → GPT-OSS-20B: clear title, obviously relevant or irrelevant to AI/ML.\n' +
		'Response length: "brief" for a quick numeric score, "full" if reasoning is needed.\n' +
		'Reply with ONLY valid JSON: {"tier":"simple","length":"brief","reason":"<=10 words"}',
};

// -- Types --------------------------------------------------------------------

interface StoryScore {
	title: string;
	score: number;
	energy_joules: number;
	model: string;
	decision: string;
}

interface WatcherStats {
	storiesScored: number;
	totalEnergy: number;
	totalCost: number;
	totalTokens: number;
	/** Energy spent on discriminator calls — already included in totalEnergy. */
	totalDiscriminatorEnergyJ: number;
	highRelevance: StoryScore[];
	policyDecisions: Array<{ story: number; reason: string }>;
	/** EA only: per-story discriminator decisions for the final summary. */
	discriminatorDecisions: Array<{ story: number; tier: string; reason: string; model: string }>;
	aborted: boolean;
}

interface HNStory {
	id: number;
	title: string;
}

/** Per-story score pair for tracking EA vs baseline agreement. */
interface ScorePair {
	base: number;
	ea: number;
	fast?: number;
}

// -- Energy tracking ----------------------------------------------------------

function getEnergy(message: AssistantMessage, modelId: string): number {
	const api = message.energy?.energy_joules;
	if (api != null && api > 0) return api;
	const tokensPerJoule = TOKENS_PER_JOULE[modelId] ?? 1.0;
	return message.usage.totalTokens / tokensPerJoule;
}

// -- HN API -------------------------------------------------------------------

async function fetchTopStoryIds(): Promise<number[]> {
	const res = await fetch(HN_TOP_URL);
	if (!res.ok) throw new Error(`HN API error: ${res.status}`);
	return (await res.json()) as number[];
}

async function fetchStory(id: number): Promise<HNStory | null> {
	const res = await fetch(`${HN_ITEM_URL}/${id}.json`);
	if (!res.ok) return null;
	const data = (await res.json()) as Record<string, unknown>;
	if (!data || typeof data.title !== "string") return null;
	return { id: data.id as number, title: data.title };
}

// -- LLM scoring --------------------------------------------------------------

async function scoreStoryLLM(
	title: string,
	keywords: string[],
	model: Model<"openai-completions">,
	apiKey: string,
	maxTokens?: number,
): Promise<{ score: number; message: AssistantMessage }> {
	const systemPrompt =
		"You are a relevance scoring engine for an AI research team monitoring HackerNews. " +
		"Respond only with a single decimal number between 0.0 and 1.0.";

	const userPrompt =
		`Score the relevance of this HackerNews story to AI/ML research topics.\n\n` +
		`Topics of interest: ${keywords.join(", ")}.\n\n` +
		`Scoring guide:\n` +
		`  0.9-1.0 — Directly about AI models, training, inference, or AI companies\n` +
		`  0.6-0.9 — Broadly about AI tools, AI applications, or AI-adjacent compute\n` +
		`  0.3-0.6 — Tangentially related (hardware, software that enables AI, etc.)\n` +
		`  0.0-0.3 — Not relevant to AI/ML\n\n` +
		`Story title: "${title}"\n\n` +
		`Relevance score:`;

	const messages: Message[] = [{ role: "user", content: userPrompt, timestamp: Date.now() }];

	const message = await completeSimple(model, { systemPrompt, messages }, { apiKey, maxTokens: maxTokens ?? 8 });

	// Detect API errors (completeSimple doesn't throw — returns stopReason: "error")
	const errorMsg = (message as unknown as Record<string, unknown>).errorMessage;
	if (message.stopReason === "error" || errorMsg) {
		throw new Error(`API error (${model.id}): ${errorMsg ?? "unknown"}`);
	}

	const text = message.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { type: "text"; text: string }).text)
		.join("")
		.trim();

	const parsed = Number.parseFloat(text);
	const score = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(1, parsed));

	return { score, message };
}

// -- Policy-driven scoring ----------------------------------------------------

async function scoreWithPolicy(
	title: string,
	keywords: string[],
	storyIndex: number,
	policy: RuntimePolicy,
	budget: EnergyBudget,
	consumedEnergy: number,
	consumedTimeMs: number,
	apiKey: string,
	memoryConfidence: string,
	/** When set, overrides the policy's model selection (discriminator wins). */
	discriminatorModelOverride?: Model<"openai-completions">,
	discriminatorMaxTokens?: number,
): Promise<{
	storyScore: StoryScore;
	decision: PolicyDecision;
	energy: number;
	tokens: number;
	cost: number;
	aborted: boolean;
}> {
	const ctx: PolicyContext = {
		turnNumber: storyIndex + 1,
		model: SCORING_MODEL,
		availableModels: NEURALWATT_MODELS,
		budget,
		consumedEnergy,
		consumedTime: consumedTimeMs,
		messageCount: storyIndex + 1,
		estimatedInputTokens: 200,
	};

	const decision = policy.beforeModelCall(ctx);

	if (decision.abort) {
		return {
			storyScore: { title, score: 0, energy_joules: 0, model: SCORING_MODEL.id, decision: "aborted" },
			decision,
			energy: 0,
			tokens: 0,
			cost: 0,
			aborted: true,
		};
	}

	// Discriminator model override takes priority over policy's model selection.
	// Policy still handles budget pressure (abort, maxTokens from token-limit strategy).
	// For token limits: use discriminator's briefMaxTokens if set, otherwise policy's limit.
	const effectiveModel =
		discriminatorModelOverride ?? (decision.model as Model<"openai-completions">) ?? SCORING_MODEL;
	const effectiveMaxTokens = discriminatorMaxTokens ?? decision.maxTokens;
	const { score, message } = await scoreStoryLLM(title, keywords, effectiveModel, apiKey, effectiveMaxTokens);
	const energy = getEnergy(message, effectiveModel.id);
	const tokens = message.usage.totalTokens;

	const usageWithEnergy: UsageWithEnergy = {
		input: message.usage.input,
		output: message.usage.output,
		totalTokens: tokens,
		cost: { total: message.usage.cost.total },
		energy_joules: energy,
		energy_kwh: energy / 3_600_000,
	};
	policy.afterModelCall(ctx, usageWithEnergy);

	// Build decision label — annotate routing decisions with learned confidence
	let decisionLabel = "";
	if (discriminatorModelOverride) {
		decisionLabel = `↓ disc → ${modelShort(discriminatorModelOverride.id)}`;
	} else if (decision.model) {
		const conf = memoryConfidence ? ` ${memoryConfidence}` : "";
		decisionLabel = `↓ policy → ${modelShort(decision.model.id)}${conf}`;
	} else if (decision.maxTokens) {
		decisionLabel = "↓ token limit";
	}

	return {
		storyScore: { title, score, energy_joules: energy, model: effectiveModel.id, decision: decisionLabel },
		decision,
		energy,
		tokens,
		cost: message.usage.cost.total,
		aborted: false,
	};
}

// -- Display ------------------------------------------------------------------

const COL = 40;

function fmtDecision(reason: string): string {
	const exhausted = reason.match(/budget exhausted.*?(\d+)%/i);
	if (exhausted) return `Budget exhausted at ${exhausted[1]}% pressure`;
	const route = reason.match(/model:.*?->\s*(\S+).*?pressure\s+(\d+)%/i);
	if (route) return `→ Routed to ${modelShort(route[1])} at ${route[2]}% budget pressure`;
	return reason.split(";")[0].trim();
}

function stars(score: number): string {
	if (score >= 0.9) return "★★★";
	if (score >= 0.7) return "★★ ";
	if (score >= 0.5) return "★  ";
	return "   ";
}

function pad(s: string, len: number): string {
	return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function truncate(s: string, maxLen: number): string {
	return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

function energyBar(consumed: number, budget: number, width = 22): string {
	const pct = Math.min(1, consumed / budget);
	const filled = Math.round(pct * width);
	const color = pct >= 0.9 ? "\x1b[31m" : pct >= 0.7 ? "\x1b[33m" : "\x1b[32m";
	const bar = "█".repeat(filled) + "░".repeat(width - filled);
	return `${color}[${bar}]\x1b[0m ${consumed.toFixed(0)}J / ${budget}J (${Math.round(pct * 100)}%)`;
}

function baselineBar(consumed: number, width = 22): string {
	const bar = "▓".repeat(width);
	return `\x1b[2m[${bar}]\x1b[0m ${consumed.toFixed(0)}J (no limit)`;
}

const modelShort = (id: string): string => {
	if (id === "kimi-k2.5-fast") return "kimi-fast";
	if (id.includes("gpt-oss")) return "gpt-oss-20b";
	if (id.includes("Devstral")) return "devstral-24b";
	if (id.includes("deepseek")) return "deepseek-33b";
	if (id.includes("Kimi")) return "kimi-k2.5";
	if (id.includes("Qwen")) return "qwen3-480b";
	return id.split("/").pop()?.slice(0, 12) ?? id.slice(0, 12);
};

function renderDisplay(
	elapsed: number,
	duration: number,
	budget: number,
	currentTitle: string,
	baseStats: WatcherStats,
	eaStats: WatcherStats,
	recentBase: StoryScore[],
	recentEa: StoryScore[],
	lastDecision: string | null,
	fastStats?: WatcherStats,
): void {
	process.stdout.write("\x1b[2J\x1b[H");

	const remaining = Math.max(0, Math.round(duration - elapsed));
	const mm = Math.floor(remaining / 60);
	const ss = remaining % 60;
	const timeStr = `${mm}m ${String(ss).padStart(2, "0")}s`;

	const eaStoryCount = eaStats.storiesScored;
	const baselineEnergyForSameStories =
		eaStoryCount > 0 && baseStats.storiesScored >= eaStoryCount
			? (baseStats.totalEnergy / baseStats.storiesScored) * eaStoryCount
			: baseStats.totalEnergy;
	const saved =
		baselineEnergyForSameStories > 0
			? ((baselineEnergyForSameStories - eaStats.totalEnergy) / baselineEnergyForSameStories) * 100
			: 0;

	console.log("╔══════════════════════════════════════════════════════════════════════╗");
	console.log("║              HackerNews Energy-Aware Watcher                        ║");
	console.log("╚══════════════════════════════════════════════════════════════════════╝");
	console.log(`  Time remaining: ${timeStr}`);
	console.log(
		`  [baseline  ] ${baselineBar(baseStats.totalEnergy)}  ${baseStats.storiesScored} stories, still running…`,
	);

	if (eaStats.aborted) {
		const savingsStr = saved > 0 ? `  \x1b[32m— used ${saved.toFixed(0)}% less energy than baseline\x1b[0m` : "";
		console.log(
			`  [energy-▼  ] ${energyBar(eaStats.totalEnergy, budget)}  ${eaStats.storiesScored} stories \x1b[32m✓ DONE\x1b[0m${savingsStr}`,
		);
	} else {
		console.log(`  [energy-▼  ] ${energyBar(eaStats.totalEnergy, budget)}  ${eaStats.storiesScored} stories`);
		if (lastDecision) {
			console.log(`               \x1b[33m[policy] ${fmtDecision(lastDecision)}\x1b[0m`);
		}
	}
	if (fastStats) {
		console.log(
			`  \x1b[33m[fast      ]\x1b[0m ${baselineBar(fastStats.totalEnergy)}  ${fastStats.storiesScored} stories`,
		);
	}

	console.log("");

	if (eaStats.aborted) {
		console.log(`  ─── BASELINE (still scoring) ──────────────────────────────────────`);
		console.log(`  → "${truncate(currentTitle || "Fetching stories…", 68)}"`);
	} else {
		console.log(`  ─── NOW SCORING ───────────────────────────────────────────────────`);
		console.log(`  → "${truncate(currentTitle || "Fetching stories…", 68)}"`);
	}
	console.log("");

	const eaHeader = eaStats.aborted ? "[energy-aware / ✓ BUDGET REACHED]" : "[energy-aware / policy-driven]";
	console.log(`  ${"[baseline  / kimi-k2.5]".padEnd(COL + 4)}  ${eaHeader}`);
	console.log(`  ${"─".repeat(COL + 4)}  ${"─".repeat(COL)}`);

	const rows = Math.max(recentBase.length, recentEa.length);
	for (let i = rows - 1; i >= 0; i--) {
		const b = recentBase[i];
		const e = recentEa[i];
		const bCol = b
			? `${stars(b.score)} ${b.score.toFixed(2)} ${b.energy_joules.toFixed(0)}J [${modelShort(b.model)}]`
			: "";
		const eCol = e
			? `${stars(e.score)} ${e.score.toFixed(2)} ${e.energy_joules.toFixed(0)}J [${modelShort(e.model)}] ${e.decision}`
			: eaStats.aborted
				? "\x1b[2m(energy-aware complete)\x1b[0m"
				: "";
		console.log(`  ${pad(bCol, COL + 4)}  ${eCol}`);
		const bTitle = b ? truncate(b.title, COL + 2) : "";
		console.log(`  \x1b[2m${pad(bTitle, COL + 4)}\x1b[0m`);
	}

	const allHigh = [...baseStats.highRelevance, ...eaStats.highRelevance]
		.filter((s, i, arr) => arr.findIndex((x) => x.title === s.title) === i)
		.sort((a, b) => b.score - a.score)
		.slice(0, 4);

	if (allHigh.length > 0) {
		console.log("");
		console.log("  ─── HIGH RELEVANCE FINDS ───────────────────────────────────────────");
		for (const s of allHigh) {
			console.log(`  ${stars(s.score)} ${s.score.toFixed(2)}  "${truncate(s.title, 62)}"`);
		}
	}

	if (!eaStats.aborted && eaStats.policyDecisions.length > 0) {
		console.log("");
		const recent = eaStats.policyDecisions.slice(-3);
		for (const d of recent) {
			console.log(`  \x1b[33m[policy #${d.story}]\x1b[0m ${fmtDecision(d.reason)}`);
		}
	}
}

function printFinalSummary(
	baseStats: WatcherStats,
	eaStats: WatcherStats,
	elapsed: number,
	budget: number,
	scorePairs: ScorePair[],
	fastStats?: WatcherStats,
): void {
	process.stdout.write("\x1b[2J\x1b[H");

	const energySaved =
		baseStats.totalEnergy > 0 ? ((baseStats.totalEnergy - eaStats.totalEnergy) / baseStats.totalEnergy) * 100 : 0;

	// Score agreement stats
	const matches = scorePairs.filter((p) => Math.abs(p.base - p.ea) <= 0.15).length;
	const agreementPct = scorePairs.length > 0 ? ((matches / scorePairs.length) * 100).toFixed(0) : "n/a";

	const hasFast = fastStats != null && fastStats.storiesScored > 0;
	const fastEnergySaved =
		hasFast && baseStats.totalEnergy > 0
			? ((baseStats.totalEnergy - fastStats.totalEnergy) / baseStats.totalEnergy) * 100
			: 0;
	const fastCostSaved =
		hasFast && baseStats.totalCost > 0
			? ((baseStats.totalCost - fastStats.totalCost) / baseStats.totalCost) * 100
			: 0;

	console.log("╔══════════════════════════════════════════════════════════════════════╗");
	console.log("║            HackerNews Energy-Aware Watcher  — Final Report          ║");
	console.log("╚══════════════════════════════════════════════════════════════════════╝");
	console.log(`  Elapsed: ${elapsed}s | Per-run budget: ${budget}J`);
	console.log("");

	const fmtDelta = (pct: number) => `${pct >= 0 ? "-" : "+"}${Math.abs(pct).toFixed(0)}%`;
	const fmtCost = (c: number) => `$${c.toFixed(5)}`;
	const costSaved =
		baseStats.totalCost > 0 ? ((baseStats.totalCost - eaStats.totalCost) / baseStats.totalCost) * 100 : 0;

	if (hasFast) {
		const c1 = 13;
		const c2 = 25;
		const c3 = 18;
		const sep = `  +-----------------+${"-".repeat(c1 + 2)}+${"-".repeat(c2 + 2)}+${"-".repeat(c3 + 2)}+`;
		console.log(sep);
		console.log(`  |                 | ${pad("Baseline", c1)} | ${pad("Energy-Aware", c2)} | ${pad("Fast", c3)} |`);
		console.log(sep);
		console.log(
			`  | Model           | ${pad("kimi-k2.5", c1)} | ${pad("kimi→gpt-oss (routed)", c2)} | ${pad("kimi-k2.5-fast", c3)} |`,
		);
		console.log(
			`  | Stories scored  | ${pad(String(baseStats.storiesScored), c1)} | ${pad(String(eaStats.storiesScored), c2)} | ${pad(String(fastStats.storiesScored), c3)} |`,
		);
		console.log(
			`  | Energy used     | ${pad(`${baseStats.totalEnergy.toFixed(1)} J`, c1)} | ${pad(`${eaStats.totalEnergy.toFixed(1)} J (${fmtDelta(energySaved)})`, c2)} | ${pad(`${fastStats.totalEnergy.toFixed(1)} J (${fmtDelta(fastEnergySaved)})`, c3)} |`,
		);
		if (eaStats.totalDiscriminatorEnergyJ > 0) {
			console.log(
				`  | Discriminator   | ${pad("n/a", c1)} | ${pad(`${eaStats.totalDiscriminatorEnergyJ.toFixed(1)}J (incl.)`, c2)} | ${pad("n/a", c3)} |`,
			);
		}
		console.log(
			`  | Est. cost       | ${pad(fmtCost(baseStats.totalCost), c1)} | ${pad(`${fmtCost(eaStats.totalCost)} (${fmtDelta(costSaved)})`, c2)} | ${pad(`${fmtCost(fastStats.totalCost)} (${fmtDelta(fastCostSaved)})`, c3)} |`,
		);
		console.log(
			`  | Tokens used     | ${pad(String(baseStats.totalTokens), c1)} | ${pad(String(eaStats.totalTokens), c2)} | ${pad(String(fastStats.totalTokens), c3)} |`,
		);
		console.log(
			`  | High-relevance  | ${pad(String(baseStats.highRelevance.length), c1)} | ${pad(String(eaStats.highRelevance.length), c2)} | ${pad(String(fastStats.highRelevance.length), c3)} |`,
		);
		console.log(
			`  | Score agreement | ${pad("(baseline)", c1)} | ${pad(`${agreementPct}% (n=${scorePairs.length})`, c2)} | ${pad("n/a", c3)} |`,
		);
		console.log(sep);
	} else {
		console.log("  +-----------------+---------------+---------------------------+");
		console.log("  |                 | Baseline      | Energy-Aware              |");
		console.log("  +-----------------+---------------+---------------------------+");
		console.log(`  | Model           | ${pad("kimi-k2.5", 13)} | ${pad("kimi → gpt-oss (routed)", 25)} |`);
		console.log(
			`  | Stories scored  | ${pad(String(baseStats.storiesScored), 13)} | ${pad(String(eaStats.storiesScored), 25)} |`,
		);
		console.log(
			`  | Energy used     | ${pad(`${baseStats.totalEnergy.toFixed(2)} J`, 13)} | ${pad(`${eaStats.totalEnergy.toFixed(2)} J  (${fmtDelta(energySaved)})`, 25)} |`,
		);
		if (eaStats.totalDiscriminatorEnergyJ > 0) {
			console.log(
				`  | Discriminator   | ${pad("n/a", 13)} | ${pad(`${eaStats.totalDiscriminatorEnergyJ.toFixed(1)}J (incl. in energy)`, 25)} |`,
			);
		}
		console.log(
			`  | Est. cost       | ${pad(fmtCost(baseStats.totalCost), 13)} | ${pad(`${fmtCost(eaStats.totalCost)}  (${fmtDelta(costSaved)})`, 25)} |`,
		);
		console.log(
			`  | Tokens used     | ${pad(String(baseStats.totalTokens), 13)} | ${pad(String(eaStats.totalTokens), 25)} |`,
		);
		console.log(
			`  | High-relevance  | ${pad(String(baseStats.highRelevance.length), 13)} | ${pad(String(eaStats.highRelevance.length), 25)} |`,
		);
		console.log(
			`  | Score agreement | ${pad("(baseline)", 13)} | ${pad(`${agreementPct}% within 0.15 (n=${scorePairs.length})`, 25)} |`,
		);
		console.log("  +-----------------+---------------+---------------------------+");
	}

	// Verdict
	console.log("");
	const qualityOk = scorePairs.length === 0 || Number(agreementPct) >= 80;
	if (qualityOk && energySaved > 0 && costSaved > 0) {
		console.log(
			`  \x1b[32m✓ Energy-aware wins: ${energySaved.toFixed(0)}% less energy, ${costSaved.toFixed(0)}% lower cost — same scoring quality\x1b[0m`,
		);
	} else if (!qualityOk) {
		console.log(
			`  \x1b[31m✗ Energy-aware quality degraded: only ${agreementPct}% score agreement (threshold: 80%)\x1b[0m`,
		);
	} else if (energySaved <= 0) {
		console.log(`  \x1b[33m~ Energy-aware used more energy this run (budget may be too high for story count)\x1b[0m`);
	}
	if (hasFast && fastEnergySaved > 0) {
		console.log(
			`  \x1b[33m✓ Fast mode: ${fastEnergySaved.toFixed(0)}% less energy, ${fastCostSaved.toFixed(0)}% lower cost vs baseline\x1b[0m`,
		);
	}

	const allHigh = [...baseStats.highRelevance, ...eaStats.highRelevance]
		.filter((s, i, arr) => arr.findIndex((x) => x.title === s.title) === i)
		.sort((a, b) => b.score - a.score);

	if (allHigh.length > 0) {
		console.log("");
		console.log("  HIGH RELEVANCE STORIES (score > 0.8):");
		for (const s of allHigh.slice(0, 8)) {
			console.log(`    ${stars(s.score)} ${s.score.toFixed(2)}  "${truncate(s.title, 62)}"`);
		}
	}

	if (eaStats.discriminatorDecisions.length > 0) {
		const simpleCount = eaStats.discriminatorDecisions.filter((d) => d.tier === "simple").length;
		const mediumCount = eaStats.discriminatorDecisions.filter((d) => d.tier === "medium").length;
		const complexCount = eaStats.discriminatorDecisions.filter((d) => d.tier === "complex").length;
		const total = eaStats.discriminatorDecisions.length;
		console.log("");
		console.log(
			`  DISCRIMINATOR SUMMARY (${total} stories): ${simpleCount} simple→GPT-OSS | ${mediumCount} medium→Devstral | ${complexCount} complex→Kimi`,
		);
		// Show a sample of decisions (last 5)
		const sample = eaStats.discriminatorDecisions.slice(-5);
		for (const d of sample) {
			const icon =
				d.tier === "complex"
					? "\x1b[33m▲ complex\x1b[0m"
					: d.tier === "medium"
						? "\x1b[36m● medium \x1b[0m"
						: "\x1b[32m▼ simple \x1b[0m";
			console.log(`    Story #${String(d.story).padStart(2)}: ${icon}  "${d.reason}"`);
		}
	}

	if (eaStats.policyDecisions.length > 0) {
		console.log("");
		console.log("  POLICY DECISIONS (energy-aware):");
		for (const d of eaStats.policyDecisions) {
			console.log(`    Story #${String(d.story).padStart(2)}: ${fmtDecision(d.reason)}`);
		}
	}
}

// -- Memory helpers -----------------------------------------------------------

function updateHNMemory(
	mem: ReturnType<typeof loadMemory>,
	baseStats: WatcherStats,
	eaStats: WatcherStats,
	scorePairs: ScorePair[],
): void {
	const prev: HNMemory = mem.hn[MEMORY_KEY] ?? {
		totalStories: 0,
		scoreMatches: 0,
		runs: 0,
		avgEnergySavingsPct: 0,
		lastUpdated: "",
	};

	const runs = prev.runs + 1;
	const totalStories = prev.totalStories + scorePairs.length;
	const newMatches = scorePairs.filter((p) => Math.abs(p.base - p.ea) <= 0.15).length;
	const scoreMatches = prev.scoreMatches + newMatches;

	const energySavedPct =
		baseStats.totalEnergy > 0 ? ((baseStats.totalEnergy - eaStats.totalEnergy) / baseStats.totalEnergy) * 100 : 0;
	const avgEnergySavingsPct = (prev.avgEnergySavingsPct * prev.runs + energySavedPct) / runs;

	mem.hn[MEMORY_KEY] = {
		totalStories,
		scoreMatches,
		runs,
		avgEnergySavingsPct,
		lastUpdated: new Date().toISOString(),
	};
}

// -- Main loop ----------------------------------------------------------------

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			duration: { type: "string", default: String(DEFAULT_DURATION_S) },
			budget: { type: "string", default: String(DEFAULT_BUDGET_JOULES) },
			keywords: { type: "string" },
			fast: { type: "boolean", default: false },
			"clear-memory": { type: "boolean", default: false },
		},
		allowPositionals: true,
	});

	if (!process.env.NEURALWATT_API_KEY) {
		console.error("NEURALWATT_API_KEY required");
		process.exit(1);
	}

	// Handle --clear-memory before anything else
	if (values["clear-memory"]) {
		clearMemory();
		console.log("Memory cleared.");
	}

	const apiKey = process.env.NEURALWATT_API_KEY;
	const durationS = Number(values.duration);
	const budgetJ = Number(values.budget);
	const keywords = values.keywords
		? values.keywords
				.split(",")
				.map((k) => k.trim())
				.filter(Boolean)
		: DEFAULT_KEYWORDS;

	const enableFast = values.fast ?? false;

	registerBuiltInApiProviders();

	// Load and display memory
	const mem = loadMemory();
	const memSummary = formatHNMemory(MEMORY_KEY, mem);

	console.log("Fetching HackerNews top stories…");
	if (values.keywords) {
		console.log(`Keywords: ${keywords.join(", ")}`);
	}
	if (enableFast) {
		console.log(`Fast mode: ${KIMI_FAST_MODEL.name} (speed-optimized 3rd column)`);
	}

	if (memSummary) {
		console.log(memSummary);
	} else {
		console.log("  Memory: No previous runs recorded.");
	}

	const topIds = await fetchTopStoryIds();
	console.log(`Found ${topIds.length} stories. Running for ${durationS}s with ${budgetJ}J budget per run.\n`);

	const baselinePolicy = new BaselinePolicy();
	const energyAwarePolicy = new EnergyAwarePolicy();

	const baseStats: WatcherStats = {
		storiesScored: 0,
		totalEnergy: 0,
		totalCost: 0,
		totalTokens: 0,
		totalDiscriminatorEnergyJ: 0,
		highRelevance: [],
		policyDecisions: [],
		discriminatorDecisions: [],
		aborted: false,
	};
	const eaStats: WatcherStats = {
		storiesScored: 0,
		totalEnergy: 0,
		totalCost: 0,
		totalTokens: 0,
		totalDiscriminatorEnergyJ: 0,
		highRelevance: [],
		policyDecisions: [],
		discriminatorDecisions: [],
		aborted: false,
	};
	const fastStats: WatcherStats = {
		storiesScored: 0,
		totalEnergy: 0,
		totalCost: 0,
		totalTokens: 0,
		totalDiscriminatorEnergyJ: 0,
		highRelevance: [],
		policyDecisions: [],
		discriminatorDecisions: [],
		aborted: false,
	};

	const baseBudget: EnergyBudget = {};
	const eaBudget: EnergyBudget = { energy_budget_joules: budgetJ };

	const recentBase: StoryScore[] = [];
	const recentEa: StoryScore[] = [];
	const recentFast: StoryScore[] = [];
	const scorePairs: ScorePair[] = [];
	let lastDecision: string | null = null;
	let currentTitle = "";
	// Track current memory confidence for routing labels (re-derived from in-memory state)
	let memoryConfidence = hnRoutingConfidence(MEMORY_KEY, mem);
	const startTime = Date.now();
	let storyIdx = 0;

	while (true) {
		const elapsedS = (Date.now() - startTime) / 1000;
		if (elapsedS >= durationS) break;

		if (storyIdx >= topIds.length) {
			storyIdx = 0;
		}

		const story = await fetchStory(topIds[storyIdx++]);
		if (!story) continue;

		currentTitle = story.title;

		const nowS = (Date.now() - startTime) / 1000;

		// Run baseline, discriminator, and fast concurrently to avoid adding latency.
		// Then use the discriminator result to drive the EA scoring call.
		const logErr = (label: string) => (e: unknown) => {
			console.error(`  [${label}] ${e instanceof Error ? e.message : String(e)}`);
			return null;
		};
		const [baseResult, discResult, fastResult] = await Promise.all([
			scoreWithPolicy(
				story.title,
				keywords,
				baseStats.storiesScored,
				baselinePolicy,
				baseBudget,
				baseStats.totalEnergy,
				nowS * 1000,
				apiKey,
				"",
			).catch(logErr("baseline")),
			eaStats.aborted
				? Promise.resolve(null)
				: discriminate("score", story.title, HN_DISCRIMINATOR_CONFIG, "", apiKey).catch(logErr("disc")),
			enableFast
				? scoreStoryLLM(story.title, keywords, KIMI_FAST_MODEL, apiKey)
						.then((r) => ({
							score: r.score,
							energy: getEnergy(r.message, KIMI_FAST_MODEL.id),
							tokens: r.message.usage.totalTokens,
							cost: r.message.usage.cost.total,
							model: KIMI_FAST_MODEL.id,
						}))
						.catch(logErr("fast"))
				: Promise.resolve(null),
		]);

		// Account for discriminator energy before the EA scoring call so the
		// consumed-energy value passed to EnergyAwarePolicy is accurate.
		if (!eaStats.aborted && discResult) {
			eaStats.totalDiscriminatorEnergyJ += discResult.energyJ;
			eaStats.totalEnergy += discResult.energyJ;
			eaStats.discriminatorDecisions.push({
				story: eaStats.storiesScored + 1,
				tier: discResult.tier,
				reason: discResult.reason,
				model: discResult.model.id,
			});
		}

		const eaResult = eaStats.aborted
			? null
			: await scoreWithPolicy(
					story.title,
					keywords,
					eaStats.storiesScored,
					energyAwarePolicy,
					eaBudget,
					eaStats.totalEnergy,
					nowS * 1000,
					apiKey,
					memoryConfidence,
					// Override model for simple/medium — complex defers to EnergyAwarePolicy
					discResult && discResult.tier !== "complex" ? discResult.model : undefined,
					discResult?.maxTokens,
				).catch(logErr("ea"));

		if (baseResult && !baseResult.aborted) {
			baseStats.totalEnergy += baseResult.energy;
			baseStats.totalCost += baseResult.cost;
			baseStats.totalTokens += baseResult.tokens;
			baseStats.storiesScored++;
			recentBase.push(baseResult.storyScore);
			if (recentBase.length > 5) recentBase.shift();
			if (baseResult.storyScore.score > 0.8) baseStats.highRelevance.push(baseResult.storyScore);
		}

		if (eaResult) {
			if (eaResult.aborted) {
				eaStats.aborted = true;
				const reason = eaResult.decision.reason ?? "budget exhausted";
				eaStats.policyDecisions.push({ story: eaStats.storiesScored + 1, reason });
				lastDecision = reason;
			} else {
				eaStats.totalEnergy += eaResult.energy;
				eaStats.totalCost += eaResult.cost;
				eaStats.totalTokens += eaResult.tokens;
				eaStats.storiesScored++;
				recentEa.push(eaResult.storyScore);
				if (recentEa.length > 5) recentEa.shift();
				if (eaResult.storyScore.score > 0.8) eaStats.highRelevance.push(eaResult.storyScore);
				if (eaResult.decision.reason) {
					eaStats.policyDecisions.push({ story: eaStats.storiesScored, reason: eaResult.decision.reason });
					lastDecision = eaResult.decision.reason;
				}
			}
		}

		if (fastResult) {
			fastStats.totalEnergy += fastResult.energy;
			fastStats.totalCost += fastResult.cost;
			fastStats.totalTokens += fastResult.tokens;
			fastStats.storiesScored++;
			const fastStoryScore: StoryScore = {
				title: story.title,
				score: fastResult.score,
				energy_joules: fastResult.energy,
				model: fastResult.model,
				decision: "",
			};
			recentFast.push(fastStoryScore);
			if (recentFast.length > 5) recentFast.shift();
			if (fastResult.score > 0.8) fastStats.highRelevance.push(fastStoryScore);
		}

		// Record score pair when both baseline and EA returned results for this story
		const pair: ScorePair = {
			base: baseResult && !baseResult.aborted ? baseResult.storyScore.score : 0,
			ea: eaResult && !eaResult.aborted ? eaResult.storyScore.score : 0,
		};
		if (fastResult) pair.fast = fastResult.score;
		if (baseResult && !baseResult.aborted && eaResult && !eaResult.aborted) {
			scorePairs.push(pair);
		}

		renderDisplay(
			(Date.now() - startTime) / 1000,
			durationS,
			budgetJ,
			currentTitle,
			baseStats,
			eaStats,
			recentBase,
			recentEa,
			lastDecision,
			enableFast ? fastStats : undefined,
		);
	}

	const totalElapsed = Math.round((Date.now() - startTime) / 1000);
	printFinalSummary(baseStats, eaStats, totalElapsed, budgetJ, scorePairs, enableFast ? fastStats : undefined);

	// Update and persist memory
	updateHNMemory(mem, baseStats, eaStats, scorePairs);
	saveMemory(mem);

	// Update confidence for display on next run
	memoryConfidence = hnRoutingConfidence(MEMORY_KEY, mem);
	console.log(`\n  Memory saved to ~/.energy-demo-memory.json`);
	if (scorePairs.length > 0) {
		const matches = scorePairs.filter((p) => Math.abs(p.base - p.ea) <= 0.15).length;
		const pct = ((matches / scorePairs.length) * 100).toFixed(0);
		console.log(`  Score agreement this run: ${pct}% within 0.15 (${matches}/${scorePairs.length} stories)`);
	}
}

main().catch((err) => {
	console.error("Demo failed:", err);
	process.exit(1);
});
