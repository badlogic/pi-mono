/**
 * Demo 2: HackerNews Energy-Aware Watcher
 *
 * A long-running agentic monitor that polls real HackerNews top stories, uses
 * an LLM to score relevance against seed keywords, and compares baseline vs
 * energy-aware modes side-by-side. Energy savings compound over sustained
 * operation.
 *
 * Usage:
 *   npx tsx src/demos/hn-watcher.ts [--duration <seconds>] [--budget <joules>]
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
import { type AssistantMessage, completeSimple, type Model, registerBuiltInApiProviders } from "@mariozechner/pi-ai";

// -- Constants ----------------------------------------------------------------

const HN_TOP_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";

const SEED_KEYWORDS = [
	"AI agents",
	"LLM",
	"energy efficiency",
	"open source AI",
	"Claude",
	"Anthropic",
	"inference",
	"GPU",
	"sustainable computing",
	"model routing",
];

const NEURALWATT_MODELS: Model<"openai-completions">[] = [
	{
		id: "neuralwatt-mini",
		name: "Neuralwatt Mini",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 4_096,
	},
	{
		id: "neuralwatt-standard",
		name: "Neuralwatt Standard",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 1.0, output: 3.0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
	},
	{
		id: "neuralwatt-large",
		name: "Neuralwatt Large",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3.0, output: 15.0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 16_384,
	},
];

/** Use neuralwatt-mini for scoring -- it is a simple classification task. */
const SCORING_MODEL = NEURALWATT_MODELS[0];

const DEFAULT_DURATION_S = 180;
const DEFAULT_BUDGET_JOULES = 20.0;
const POLL_INTERVAL_MS = 15_000;
const STORIES_PER_BATCH = 5;

// -- Types --------------------------------------------------------------------

interface StoryScore {
	title: string;
	score: number;
	energy_joules: number;
	model: string;
}

interface WatcherStats {
	storiesScored: number;
	totalEnergy: number;
	totalTokens: number;
	highRelevance: StoryScore[];
	decisions: Array<{ story: number; reason: string }>;
	aborted: boolean;
}

interface HNStory {
	id: number;
	title: string;
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
	model: Model<"openai-completions">,
	apiKey: string,
): Promise<{ score: number; message: AssistantMessage }> {
	const prompt =
		`Rate the relevance of this HN story title to the following topics on a scale 0.0-1.0. ` +
		`Topics: ${SEED_KEYWORDS.join(", ")}. ` +
		`Title: "${title}". Respond with only a decimal number.`;

	const message = await completeSimple(
		model,
		{
			systemPrompt: "You are a relevance scoring system. Respond only with a decimal number between 0.0 and 1.0.",
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
		},
		{ apiKey, maxTokens: 16 },
	);

	const text = message.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { type: "text"; text: string }).text)
		.join("")
		.trim();

	const parsed = Number.parseFloat(text);
	const score = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(1, parsed));

	return { score, message };
}

/**
 * Estimate energy from model cost when real energy telemetry is unavailable.
 */
function estimateEnergy(model: Model<"openai-completions">, message: AssistantMessage): number {
	const tokenCost = model.cost.input * message.usage.input + model.cost.output * message.usage.output;
	return tokenCost * 0.0001;
}

// -- Policy-driven scoring ----------------------------------------------------

async function scoreWithPolicy(
	title: string,
	storyIndex: number,
	policy: RuntimePolicy,
	budget: EnergyBudget,
	consumedEnergy: number,
	consumedTimeMs: number,
	apiKey: string,
): Promise<{
	storyScore: StoryScore;
	decision: PolicyDecision;
	energy: number;
	tokens: number;
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
		estimatedInputTokens: 100,
	};

	const decision = policy.beforeModelCall(ctx);

	if (decision.abort) {
		return {
			storyScore: { title, score: 0, energy_joules: 0, model: SCORING_MODEL.id },
			decision,
			energy: 0,
			tokens: 0,
			aborted: true,
		};
	}

	const effectiveModel = (decision.model as Model<"openai-completions">) ?? SCORING_MODEL;
	const { score, message } = await scoreStoryLLM(title, effectiveModel, apiKey);
	const energy = message.energy?.energy_joules ?? estimateEnergy(effectiveModel, message);
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

	return {
		storyScore: { title, score, energy_joules: energy, model: effectiveModel.id },
		decision,
		energy,
		tokens,
		aborted: false,
	};
}

// -- Display ------------------------------------------------------------------

function pad(s: string, len: number): string {
	return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function truncate(s: string, maxLen: number): string {
	return s.length <= maxLen ? s : `${s.slice(0, maxLen - 3)}...`;
}

function clearScreen(): void {
	process.stdout.write("\x1b[2J\x1b[H");
}

function renderDisplay(
	elapsed: number,
	duration: number,
	budget: number,
	baseStats: WatcherStats,
	eaStats: WatcherStats,
	recentBase: StoryScore[],
	recentEa: StoryScore[],
	lastDecision: string | null,
): void {
	clearScreen();

	const remaining = Math.max(0, Math.round(duration - elapsed));
	const totalEnergy = baseStats.totalEnergy + eaStats.totalEnergy;
	const budgetPct = budget > 0 ? (totalEnergy / budget) * 100 : 0;
	const barLen = 30;
	const filled = Math.min(barLen, Math.round((budgetPct / 100) * barLen));
	const bar = "=".repeat(filled) + " ".repeat(barLen - filled);

	console.log("=== HackerNews Energy-Aware Watcher ===");
	console.log(`Keywords: ${SEED_KEYWORDS.slice(0, 5).join(", ")}...`);
	console.log(
		`Time remaining: ${remaining}s | Shared budget: [${bar}] ${totalEnergy.toFixed(1)}J / ${budget}J (${budgetPct.toFixed(0)}%)`,
	);
	console.log("");

	const colW = 38;
	console.log(`${pad("[baseline]", colW)}  ${pad("[energy-aware]", colW)}  Policy`);
	console.log("-".repeat(colW * 2 + 10));

	// Show recent stories side-by-side
	const maxRows = Math.max(recentBase.length, recentEa.length);
	for (let i = 0; i < maxRows; i++) {
		const b = recentBase[i];
		const e = recentEa[i];
		const bCol = b ? `${b.score.toFixed(2)} | ${b.energy_joules.toFixed(3)}J` : "";
		const eCol = e
			? `${e.score.toFixed(2)} | ${e.energy_joules.toFixed(3)}J`
			: eaStats.aborted
				? "(budget exhausted)"
				: "";
		console.log(`${pad(bCol, colW)}  ${pad(eCol, colW)}`);
		const bTitle = b ? truncate(b.title, colW) : "";
		const eTitle = e ? truncate(e.title, colW) : "";
		console.log(`${pad(bTitle, colW)}  ${pad(eTitle, colW)}`);
	}

	if (lastDecision) {
		console.log(`${pad("", colW)}  [policy] ${lastDecision}`);
	}

	console.log("");
	console.log(
		`Baseline: ${baseStats.storiesScored} stories, ${baseStats.totalEnergy.toFixed(2)}J`.padEnd(colW + 2) +
			`Energy-aware: ${eaStats.storiesScored} stories, ${eaStats.totalEnergy.toFixed(2)}J`,
	);

	if (eaStats.aborted) {
		console.log("\n[energy-aware] Budget exhausted -- stopped scoring.");
	}
}

function printFinalSummary(baseStats: WatcherStats, eaStats: WatcherStats, elapsed: number, budget: number): void {
	clearScreen();

	const energyDelta =
		baseStats.totalEnergy > 0 ? ((eaStats.totalEnergy - baseStats.totalEnergy) / baseStats.totalEnergy) * 100 : 0;
	const fmtDelta = (val: number): string => `${val <= 0 ? "" : "+"}${val.toFixed(0)}%`;

	console.log("=== HackerNews Energy-Aware Watcher -- Final Summary ===");
	console.log(`Elapsed: ${elapsed}s | Budget: ${budget}J`);
	console.log("");
	console.log("+----------------------------------------------+");
	console.log("|     HackerNews Watcher Energy Comparison      |");
	console.log("+--------------+-----------+-------------------+");
	console.log("|              | Baseline  | Energy-Aware      |");
	console.log("+--------------+-----------+-------------------+");
	console.log(
		`| Stories      | ${pad(String(baseStats.storiesScored), 9)} | ${pad(String(eaStats.storiesScored), 17)} |`,
	);
	console.log(
		`| Energy       | ${pad(`${baseStats.totalEnergy.toFixed(2)} J`, 9)} | ${pad(`${eaStats.totalEnergy.toFixed(2)} J (${fmtDelta(energyDelta)})`, 17)} |`,
	);
	console.log(`| Tokens       | ${pad(String(baseStats.totalTokens), 9)} | ${pad(String(eaStats.totalTokens), 17)} |`);
	console.log(
		`| High-rel     | ${pad(String(baseStats.highRelevance.length), 9)} | ${pad(String(eaStats.highRelevance.length), 17)} |`,
	);
	console.log("+--------------+-----------+-------------------+");

	// Merge high-relevance stories
	const allHigh = new Map<string, { baseline: number; energyAware: number }>();
	for (const s of baseStats.highRelevance) {
		allHigh.set(s.title, { baseline: s.score, energyAware: 0 });
	}
	for (const s of eaStats.highRelevance) {
		const existing = allHigh.get(s.title);
		if (existing) {
			existing.energyAware = s.score;
		} else {
			allHigh.set(s.title, { baseline: 0, energyAware: s.score });
		}
	}

	if (allHigh.size > 0) {
		console.log("");
		console.log("HIGH RELEVANCE (score > 0.8):");
		for (const [title, scores] of allHigh) {
			const bStr = scores.baseline > 0 ? scores.baseline.toFixed(2) : "---";
			const eStr = scores.energyAware > 0 ? scores.energyAware.toFixed(2) : "---";
			console.log(`  - "${truncate(title, 55)}" (base: ${bStr}, ea: ${eStr})`);
		}
	}

	if (eaStats.decisions.length > 0) {
		console.log("");
		console.log("Policy decisions (energy-aware):");
		const shown = eaStats.decisions.slice(-10);
		for (const d of shown) {
			console.log(`  Story #${d.story}: ${d.reason}`);
		}
		if (eaStats.decisions.length > 10) {
			console.log(`  ... and ${eaStats.decisions.length - 10} more`);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// -- Main loop ----------------------------------------------------------------

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			duration: { type: "string", default: String(DEFAULT_DURATION_S) },
			budget: { type: "string", default: String(DEFAULT_BUDGET_JOULES) },
		},
		allowPositionals: true,
	});

	if (!process.env.NEURALWATT_API_KEY) {
		console.error("NEURALWATT_API_KEY required");
		process.exit(1);
	}

	const apiKey = process.env.NEURALWATT_API_KEY;
	const durationS = Number(values.duration);
	const budgetJ = Number(values.budget);

	registerBuiltInApiProviders();

	console.log("Fetching HackerNews top stories...");
	const topIds = await fetchTopStoryIds();
	console.log(`Found ${topIds.length} stories. Starting watchers for ${durationS}s.\n`);

	const baselinePolicy = new BaselinePolicy();
	const energyAwarePolicy = new EnergyAwarePolicy();

	const baseStats: WatcherStats = {
		storiesScored: 0,
		totalEnergy: 0,
		totalTokens: 0,
		highRelevance: [],
		decisions: [],
		aborted: false,
	};
	const eaStats: WatcherStats = {
		storiesScored: 0,
		totalEnergy: 0,
		totalTokens: 0,
		highRelevance: [],
		decisions: [],
		aborted: false,
	};

	const baseBudget: EnergyBudget = {};
	const eaBudget: EnergyBudget = { energy_budget_joules: budgetJ };

	const startTime = Date.now();
	let storyIdx = 0;
	const recentBase: StoryScore[] = [];
	const recentEa: StoryScore[] = [];
	let lastDecision: string | null = null;

	while (true) {
		const elapsedS = (Date.now() - startTime) / 1000;
		if (elapsedS >= durationS) break;

		// Get next batch of story IDs
		const batchIds = topIds.slice(storyIdx, storyIdx + STORIES_PER_BATCH);
		if (batchIds.length === 0) {
			storyIdx = 0;
			continue;
		}

		// Fetch stories
		const stories = await Promise.all(batchIds.map(fetchStory));
		const validStories = stories.filter((s): s is HNStory => s !== null);

		for (const story of validStories) {
			const nowS = (Date.now() - startTime) / 1000;
			if (nowS >= durationS) break;

			// Score with both policies concurrently
			const basePromise = scoreWithPolicy(
				story.title,
				baseStats.storiesScored,
				baselinePolicy,
				baseBudget,
				baseStats.totalEnergy,
				nowS * 1000,
				apiKey,
			).catch(() => null);

			const eaPromise = eaStats.aborted
				? Promise.resolve(null)
				: scoreWithPolicy(
						story.title,
						eaStats.storiesScored,
						energyAwarePolicy,
						eaBudget,
						eaStats.totalEnergy,
						nowS * 1000,
						apiKey,
					).catch(() => null);

			const [baseResult, eaResult] = await Promise.all([basePromise, eaPromise]);

			// Process baseline result
			if (baseResult && !baseResult.aborted) {
				baseStats.totalEnergy += baseResult.energy;
				baseStats.totalTokens += baseResult.tokens;
				baseStats.storiesScored++;
				const bScore = baseResult.storyScore;
				recentBase.push(bScore);
				if (recentBase.length > STORIES_PER_BATCH) recentBase.shift();
				if (bScore.score > 0.8) baseStats.highRelevance.push(bScore);
			}

			// Process energy-aware result
			if (eaResult) {
				if (eaResult.aborted) {
					eaStats.aborted = true;
					eaStats.decisions.push({
						story: eaStats.storiesScored + 1,
						reason: eaResult.decision.reason ?? "budget exhausted",
					});
					lastDecision = eaResult.decision.reason ?? "budget exhausted";
				} else {
					eaStats.totalEnergy += eaResult.energy;
					eaStats.totalTokens += eaResult.tokens;
					eaStats.storiesScored++;
					const eScore = eaResult.storyScore;
					recentEa.push(eScore);
					if (recentEa.length > STORIES_PER_BATCH) recentEa.shift();
					if (eScore.score > 0.8) eaStats.highRelevance.push(eScore);

					if (eaResult.decision.reason) {
						eaStats.decisions.push({ story: eaStats.storiesScored, reason: eaResult.decision.reason });
						lastDecision = eaResult.decision.reason;
					} else {
						lastDecision = null;
					}
				}
			}

			// Update live display
			renderDisplay(
				(Date.now() - startTime) / 1000,
				durationS,
				budgetJ,
				baseStats,
				eaStats,
				recentBase,
				recentEa,
				lastDecision,
			);
		}

		storyIdx += STORIES_PER_BATCH;

		// Wait before next poll
		const elapsedAfter = (Date.now() - startTime) / 1000;
		if (elapsedAfter < durationS) {
			const waitMs = Math.min(POLL_INTERVAL_MS, (durationS - elapsedAfter) * 1000);
			await sleep(waitMs);
		}
	}

	// Final summary
	const totalElapsed = Math.round((Date.now() - startTime) / 1000);
	printFinalSummary(baseStats, eaStats, totalElapsed, budgetJ);
}

main().catch((err) => {
	console.error("Demo failed:", err);
	process.exit(1);
});
