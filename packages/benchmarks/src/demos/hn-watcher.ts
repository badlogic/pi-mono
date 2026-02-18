/**
 * Demo 2: HackerNews Energy-Aware Watcher
 *
 * Simulates a long-running HN monitor that scores stories against AI keywords.
 * Runs baseline and energy-aware modes side-by-side, showing how energy savings
 * compound over sustained operation.
 *
 * Uses simulated story data and policy-driven turn usage to demonstrate
 * real EnergyAwarePolicy strategy escalation without requiring API access.
 *
 * Set NEURALWATT_API_KEY to enable (guarded).
 */

import type { EnergyBudget, PolicyContext, RuntimePolicy, UsageWithEnergy } from "@mariozechner/pi-agent-core";
import { BaselinePolicy, EnergyAwarePolicy } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

// -- Constants ----------------------------------------------------------------

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

const DEFAULT_MODEL = NEURALWATT_MODELS[NEURALWATT_MODELS.length - 1];

const KEYWORDS = [
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

const ENERGY_BUDGET_JOULES = 20.0;

/** Simulated HN stories with pre-computed relevance scores. */
const MOCK_STORIES: Array<{ title: string; score: number; complexity: "low" | "medium" | "high" }> = [
	{ title: "Show HN: Open source LLM routing achieves GPT-4 parity", score: 0.95, complexity: "high" },
	{ title: "React 20 released with server components", score: 0.1, complexity: "low" },
	{ title: "Anthropic releases new inference pricing tiers", score: 0.92, complexity: "high" },
	{ title: "PostgreSQL 18 performance benchmarks", score: 0.05, complexity: "low" },
	{ title: "GPU shortages ease as new fabs come online", score: 0.78, complexity: "medium" },
	{ title: "How we built an energy-efficient AI pipeline", score: 0.88, complexity: "high" },
	{ title: "Rust 2.0 edition announced", score: 0.03, complexity: "low" },
	{ title: "Claude Code: building agents with sustainable computing", score: 0.91, complexity: "high" },
	{ title: "AI agents now handle 40% of customer support calls", score: 0.85, complexity: "medium" },
	{ title: "The state of JavaScript in 2026", score: 0.08, complexity: "low" },
	{ title: "New paper: model routing reduces inference cost by 60%", score: 0.93, complexity: "high" },
	{ title: "Kubernetes 1.33 released", score: 0.02, complexity: "low" },
	{ title: "LLM inference on edge devices: a practical guide", score: 0.82, complexity: "medium" },
	{ title: "Startup uses AI to optimize data center energy usage", score: 0.87, complexity: "high" },
	{ title: "CSS container queries gain browser support", score: 0.01, complexity: "low" },
	{ title: "Open source AI models surpass proprietary in benchmarks", score: 0.89, complexity: "high" },
	{ title: "Python 3.15 type system improvements", score: 0.12, complexity: "low" },
	{ title: "GPU-less inference: running LLMs on CPUs efficiently", score: 0.84, complexity: "medium" },
	{ title: "How Anthropic trains Claude with energy-aware scheduling", score: 0.94, complexity: "high" },
	{ title: "WebAssembly 3.0 proposal advances", score: 0.04, complexity: "low" },
];

/** Per-story simulated usage — varies by story complexity. */
const USAGE_BY_COMPLEXITY = {
	low: { input: 300, output: 100, totalTokens: 400, energy_joules: 0.4, latency_ms: 800 },
	medium: { input: 600, output: 300, totalTokens: 900, energy_joules: 0.8, latency_ms: 1500 },
	high: { input: 1000, output: 600, totalTokens: 1600, energy_joules: 1.2, latency_ms: 2500 },
};

// -- Types --------------------------------------------------------------------

interface StoryResult {
	title: string;
	score: number;
	energy: number;
	model: string;
	decision?: string;
}

interface WatcherStats {
	stories: StoryResult[];
	totalEnergy: number;
	totalTokens: number;
	startTime: number;
	endTime: number;
	highRelevance: StoryResult[];
}

// -- Display helpers ----------------------------------------------------------

function pad(s: string, len: number): string {
	if (s.length >= len) return s.substring(0, len);
	return s + " ".repeat(len - s.length);
}

function truncate(s: string, maxLen: number): string {
	if (s.length <= maxLen) return s;
	return `${s.substring(0, maxLen - 3)}...`;
}

function printHeader(): void {
	console.log(`Monitoring HackerNews | Keywords: ${KEYWORDS.slice(0, 4).join(", ")} ...`);
	console.log(`Budget: ${ENERGY_BUDGET_JOULES}J total\n`);
	console.log(`${pad("[baseline]", 30)}  ${pad("[energy-aware]", 30)}  Policy`);
	console.log("-".repeat(85));
}

function printStoryRow(storyNum: number, baseResult: StoryResult, eaResult: StoryResult): void {
	const baseCol = `Story #${storyNum}: ${baseResult.energy.toFixed(1)}J`;
	const eaCol = `Story #${storyNum}: ${eaResult.energy.toFixed(1)}J`;
	const policyCol = eaResult.decision ?? "no change";
	console.log(`${pad(baseCol, 30)}  ${pad(eaCol, 30)}  ${policyCol}`);
}

function printSummary(baseStats: WatcherStats, eaStats: WatcherStats): void {
	const baseTime = baseStats.endTime - baseStats.startTime;
	const energyDelta =
		baseStats.totalEnergy > 0 ? ((baseStats.totalEnergy - eaStats.totalEnergy) / baseStats.totalEnergy) * 100 : 0;

	console.log(
		`\nElapsed: ${(baseTime / 1000).toFixed(0)}s | Baseline: ${baseStats.totalEnergy.toFixed(1)}J | Energy-aware: ${eaStats.totalEnergy.toFixed(1)}J (-${energyDelta.toFixed(0)}%)`,
	);

	if (eaStats.highRelevance.length > 0) {
		console.log("\nHIGH RELEVANCE (energy-aware found these too):");
		for (const story of eaStats.highRelevance) {
			console.log(`  - "${truncate(story.title, 60)}" (score: ${story.score.toFixed(2)})`);
		}
	}

	// Final scorecard
	console.log("\n+---------------------------------------------------+");
	console.log("|       HackerNews Energy-Aware Watcher Results      |");
	console.log("+------------------+-----------+---------------------+");
	console.log("|                  | Baseline  | Energy-Aware        |");
	console.log("+------------------+-----------+---------------------+");
	console.log(
		`| Stories scored    | ${pad(String(baseStats.stories.length), 9)} | ${pad(String(eaStats.stories.length), 19)} |`,
	);
	console.log(
		`| Total energy     | ${pad(`${baseStats.totalEnergy.toFixed(1)} J`, 9)} | ${pad(`${eaStats.totalEnergy.toFixed(1)} J  (-${energyDelta.toFixed(0)}%)`, 19)} |`,
	);
	console.log(
		`| High relevance   | ${pad(String(baseStats.highRelevance.length), 9)} | ${pad(String(eaStats.highRelevance.length), 19)} |`,
	);
	console.log("+------------------+-----------+---------------------+");
}

// -- Simulation ---------------------------------------------------------------

function simulateWatcher(
	_mode: "baseline" | "energy-aware",
	policy: RuntimePolicy,
	budget: EnergyBudget,
): WatcherStats {
	const stats: WatcherStats = {
		stories: [],
		totalEnergy: 0,
		totalTokens: 0,
		startTime: Date.now(),
		endTime: 0,
		highRelevance: [],
	};

	let consumedEnergy = 0;
	let estimatedInputTokens = 0;

	for (let i = 0; i < MOCK_STORIES.length; i++) {
		const story = MOCK_STORIES[i];
		const usage = USAGE_BY_COMPLEXITY[story.complexity];

		const ctx: PolicyContext = {
			turnNumber: i + 1,
			model: DEFAULT_MODEL,
			availableModels: NEURALWATT_MODELS,
			budget,
			consumedEnergy,
			consumedTime: Date.now() - stats.startTime,
			messageCount: i + 1,
			estimatedInputTokens,
		};

		const decision = policy.beforeModelCall(ctx);

		if (decision.abort) {
			break;
		}

		// Apply model routing
		const effectiveModel = decision.model ?? DEFAULT_MODEL;
		const energyScale = decision.model ? decision.model.cost.output / DEFAULT_MODEL.cost.output : 1;
		const adjustedEnergy = usage.energy_joules * energyScale;

		consumedEnergy += adjustedEnergy;
		estimatedInputTokens = usage.totalTokens;
		stats.totalTokens += usage.totalTokens;

		// Build decision description
		let decisionStr: string | undefined;
		if (decision.model && decision.model.id !== DEFAULT_MODEL.id) {
			decisionStr = `routing: large->${decision.model.id.replace("neuralwatt-", "")}`;
		} else if (decision.reason) {
			decisionStr = decision.reason;
		}

		const result: StoryResult = {
			title: story.title,
			score: story.score,
			energy: adjustedEnergy,
			model: effectiveModel.id,
			decision: decisionStr,
		};
		stats.stories.push(result);

		if (story.score >= 0.8) {
			stats.highRelevance.push(result);
		}

		// Notify policy
		const usageWithEnergy: UsageWithEnergy = {
			input: usage.input,
			output: usage.output,
			totalTokens: usage.totalTokens,
			cost: { total: 0.001 },
			energy_joules: adjustedEnergy,
			energy_kwh: adjustedEnergy / 3_600_000,
		};
		policy.afterModelCall(ctx, usageWithEnergy);

		stats.totalEnergy = consumedEnergy;

		// Simulate processing latency (capped for demo speed)
		const sleepMs = Math.min(usage.latency_ms / 20, 100);
		const end = Date.now() + sleepMs;
		while (Date.now() < end) {
			// busy-wait
		}
	}

	stats.endTime = Date.now();
	return stats;
}

// -- Main ---------------------------------------------------------------------

function main(): void {
	if (!process.env.NEURALWATT_API_KEY) {
		console.error("NEURALWATT_API_KEY required");
		process.exit(1);
	}

	console.log("=== HackerNews Energy-Aware Watcher ===\n");

	printHeader();

	// Run both modes
	const baselinePolicy = new BaselinePolicy();
	const baselineStats = simulateWatcher("baseline", baselinePolicy, {});

	const energyAwarePolicy = new EnergyAwarePolicy();
	const eaStats = simulateWatcher("energy-aware", energyAwarePolicy, {
		energy_budget_joules: ENERGY_BUDGET_JOULES,
	});

	// Print side-by-side results
	const maxStories = Math.max(baselineStats.stories.length, eaStats.stories.length);
	for (let i = 0; i < maxStories; i++) {
		const base = baselineStats.stories[i] ?? { title: "-", score: 0, energy: 0, model: "-" };
		const ea = eaStats.stories[i] ?? { title: "-", score: 0, energy: 0, model: "-" };
		printStoryRow(i + 1, base, ea);
	}

	printSummary(baselineStats, eaStats);
}

main();
