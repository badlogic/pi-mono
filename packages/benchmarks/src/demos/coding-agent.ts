/**
 * Demo 1: Coding Agent Energy Challenge
 *
 * Runs a real multi-turn coding task under both BaselinePolicy and
 * EnergyAwarePolicy using actual Neuralwatt API calls. Shows turn-by-turn
 * energy consumption, live code output, and policy interventions.
 *
 * Task: implement a TypeScript rate-limiting middleware with types, JSDoc,
 * validation, and unit tests — across 6 focused turns.
 *
 * Baseline: uses Devstral-Small throughout (full quality, full energy).
 * Energy-aware: starts on Devstral-Small, routes to GPT-OSS-20B at >70%
 * budget pressure, reduces token limits at >50% — saving energy while
 * completing the task.
 *
 * Energy benchmarks from portal.neuralwatt.com:
 *   Devstral-Small-2-24B: 0.809 tokens/J  ($0.12/$0.12 per 1M)
 *   GPT-OSS-20B:          1.371 tokens/J  ($0.10/$0.10 per 1M)  ← 1.7x more efficient
 *
 * Usage:
 *   npx tsx src/demos/coding-agent.ts [--budget <joules>]
 *
 * Requires NEURALWATT_API_KEY in the environment.
 */

import { parseArgs } from "node:util";
import type { EnergyBudget, PolicyContext, RuntimePolicy, UsageWithEnergy } from "@mariozechner/pi-agent-core";
import { BaselinePolicy, EnergyAwarePolicy } from "@mariozechner/pi-agent-core";
import {
	type AssistantMessage,
	completeSimple,
	type Message,
	type Model,
	registerBuiltInApiProviders,
} from "@mariozechner/pi-ai";

// -- Models -------------------------------------------------------------------

/**
 * Energy efficiency benchmarks from portal.neuralwatt.com (tokens per joule).
 * Used to estimate energy when the API does not return real energy_joules.
 */
const TOKENS_PER_JOULE: Record<string, number> = {
	"openai/gpt-oss-20b": 1.371,
	"mistralai/Devstral-Small-2-24B-Instruct-2512": 0.809,
	"deepseek-ai/deepseek-coder-33b-instruct": 0.092,
	"moonshotai/Kimi-K2.5": 0.482,
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": 0.314,
};

const NEURALWATT_MODELS: Model<"openai-completions">[] = [
	{
		// Most energy-efficient: 1.371 tokens/J, cheapest at $0.10/$0.10/1M
		id: "openai/gpt-oss-20b",
		name: "GPT-OSS 20B",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16_384,
		maxTokens: 4_096,
	},
	{
		// Default: 0.809 tokens/J, $0.12/$0.12/1M — good coding model
		id: "mistralai/Devstral-Small-2-24B-Instruct-2512",
		name: "Devstral Small 24B",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.12, output: 0.12, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 8_192,
	},
];

const DEFAULT_MODEL = NEURALWATT_MODELS[1]; // Devstral-Small — routes to GPT-OSS at >70%

/**
 * Budget sized so routing kicks in around turn 4 of 6.
 * Devstral-Small at 0.809 tokens/J: each turn costs ~600-3000J as context grows.
 * At ~6000J total budget, routing fires around turn 4 when context grows large.
 */
const DEFAULT_BUDGET_JOULES = 6_000;

// -- Task definition ----------------------------------------------------------

const SYSTEM_PROMPT =
	"You are an expert TypeScript engineer. " +
	"Implement code concisely and correctly. " +
	"Include TypeScript types, JSDoc for public APIs, and production-quality error handling. " +
	"Each response should be focused — implement only what is asked in the current turn.";

/** Ordered turns for the coding task. */
const TURNS = [
	"Design a TypeScript interface for a rate limiter: RateLimiterOptions (windowMs, maxRequests, keyFn) and RateLimiterState (map of key → {count, resetAt}). Keep it concise.",
	"Implement a RateLimiter class using those interfaces. Include: constructor(options), isAllowed(key): boolean method that enforces the sliding window. Add JSDoc.",
	"Write an Express-style middleware factory: createRateLimitMiddleware(options: RateLimiterOptions): (req, res, next) => void. It should set X-RateLimit-Remaining and X-RateLimit-Reset headers, and return 429 with a JSON error when the limit is exceeded.",
	"Add input validation to the RateLimiter constructor: throw descriptive errors for invalid windowMs (must be > 0), invalid maxRequests (must be > 0 integer), and missing keyFn.",
	"Write 4 focused Vitest unit tests for the RateLimiter class: (1) allows requests within limit, (2) blocks requests over limit, (3) resets after window expires, (4) throws on invalid options.",
	"Write a brief integration test for the Express middleware using a mock req/res. Test: (1) sets correct headers, (2) calls next() when allowed, (3) sends 429 when limited.",
];

// -- Energy tracking ----------------------------------------------------------

function estimateEnergy(message: AssistantMessage, modelId: string): number {
	const tokensPerJoule = TOKENS_PER_JOULE[modelId] ?? 1.0;
	return message.usage.totalTokens / tokensPerJoule;
}

function getEnergy(message: AssistantMessage, modelId: string): number {
	const fromApi = message.energy?.energy_joules;
	if (fromApi != null && fromApi > 0) return fromApi;
	return estimateEnergy(message, modelId);
}

// -- Display ------------------------------------------------------------------

function energyBar(consumed: number, budget: number, width = 20): string {
	const pct = budget > 0 ? Math.min(1, consumed / budget) : 0;
	const filled = Math.round(pct * width);
	const bar = "█".repeat(filled) + "░".repeat(width - filled);
	const color = pct >= 0.9 ? "\x1b[31m" : pct >= 0.7 ? "\x1b[33m" : "\x1b[32m";
	return `${color}[${bar}]\x1b[0m ${consumed.toFixed(2)}J / ${budget}J (${Math.round(pct * 100)}%)`;
}

function truncateCode(text: string, maxLines = 8): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	return `${lines.slice(0, maxLines).join("\n")}\n  \x1b[2m… (${lines.length - maxLines} more lines)\x1b[0m`;
}

function extractText(message: AssistantMessage): string {
	return message.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { type: "text"; text: string }).text)
		.join("");
}

function printTurnHeader(
	mode: string,
	turnNum: number,
	totalTurns: number,
	modelId: string,
	decisionLabel: string,
	energy: number,
	budget: number,
): void {
	const tag = mode === "baseline" ? "\x1b[36m[baseline ]\x1b[0m" : "\x1b[35m[energy-▼ ]\x1b[0m";
	const modelShort = modelId.replace("neuralwatt-", "");
	console.log(`\n${tag} Turn ${turnNum}/${totalTurns}  model: ${modelShort}  ${energyBar(energy, budget)}`);
	if (decisionLabel) {
		console.log(`           \x1b[33m${decisionLabel}\x1b[0m`);
	}
}

// -- Run ----------------------------------------------------------------------

interface TurnResult {
	turn: number;
	model: string;
	energy: number;
	tokens: number;
	decision: string;
}

interface RunStats {
	mode: string;
	totalEnergy: number;
	totalTokens: number;
	turns: TurnResult[];
	abortedAt?: number;
	startTime: number;
	endTime: number;
}

async function runCodingAgent(
	mode: "baseline" | "energy-aware",
	policy: RuntimePolicy,
	budget: EnergyBudget,
	apiKey: string,
): Promise<RunStats> {
	const stats: RunStats = {
		mode,
		totalEnergy: 0,
		totalTokens: 0,
		turns: [],
		startTime: Date.now(),
		endTime: 0,
	};

	const messages: Message[] = [];
	const budgetJ = budget.energy_budget_joules ?? DEFAULT_BUDGET_JOULES;

	console.log(`\n${"═".repeat(70)}`);
	console.log(`  Running: ${mode.toUpperCase()} mode  |  Budget: ${budgetJ}J  |  Model: ${DEFAULT_MODEL.id}`);
	console.log(`${"═".repeat(70)}`);

	for (let i = 0; i < TURNS.length; i++) {
		const turnNum = i + 1;
		const prompt = TURNS[i];

		const ctx: PolicyContext = {
			turnNumber: turnNum,
			model: DEFAULT_MODEL,
			availableModels: NEURALWATT_MODELS,
			budget,
			consumedEnergy: stats.totalEnergy,
			consumedTime: Date.now() - stats.startTime,
			messageCount: messages.length,
			estimatedInputTokens: messages.reduce((sum, m) => {
				if (m.role === "user" && typeof m.content === "string") return sum + Math.round(m.content.length / 4);
				if (m.role === "assistant") {
					return (
						sum +
						m.content
							.filter((c) => c.type === "text")
							.reduce((s, c) => s + Math.round((c as { type: "text"; text: string }).text.length / 4), 0)
					);
				}
				return sum;
			}, 0),
		};

		const decision = policy.beforeModelCall(ctx);

		if (decision.abort) {
			stats.abortedAt = turnNum;
			console.log(
				`\n\x1b[31m[${mode}] ✗ Budget exhausted at turn ${turnNum} — ${decision.reason ?? "aborting"}\x1b[0m`,
			);
			break;
		}

		const decisionLabel = decision.model
			? `→ routing to ${decision.model.id} (budget pressure ≥ 70%)`
			: decision.maxTokens
				? `→ token limit: ${decision.maxTokens} (budget pressure ≥ 50%)`
				: "";

		const effectiveModel = (decision.model as Model<"openai-completions">) ?? DEFAULT_MODEL;

		printTurnHeader(mode, turnNum, TURNS.length, effectiveModel.id, decisionLabel, stats.totalEnergy, budgetJ);
		console.log(`  \x1b[2m${prompt.slice(0, 90)}${prompt.length > 90 ? "…" : ""}\x1b[0m`);

		// Add user message and call the API
		const userMsg: Message = { role: "user", content: prompt, timestamp: Date.now() };
		messages.push(userMsg);

		const assistantMsg = await completeSimple(
			effectiveModel,
			{ systemPrompt: SYSTEM_PROMPT, messages },
			{ apiKey, maxTokens: decision.maxTokens },
		);

		messages.push(assistantMsg);

		const energy = getEnergy(assistantMsg, effectiveModel.id);
		const tokens = assistantMsg.usage.totalTokens;
		stats.totalEnergy += energy;
		stats.totalTokens += tokens;

		const energySource =
			assistantMsg.energy?.energy_joules != null && assistantMsg.energy.energy_joules > 0 ? "api" : "est";
		console.log(
			`  \x1b[2m${tokens} tokens | ${energy.toFixed(3)}J [${energySource}] | input:${assistantMsg.usage.input} output:${assistantMsg.usage.output}\x1b[0m`,
		);

		// Show a snippet of the generated code
		const responseText = extractText(assistantMsg);
		console.log(truncateCode(responseText, 10));

		const usageWithEnergy: UsageWithEnergy = {
			input: assistantMsg.usage.input,
			output: assistantMsg.usage.output,
			totalTokens: tokens,
			cost: { total: assistantMsg.usage.cost.total },
			energy_joules: energy,
			energy_kwh: energy / 3_600_000,
		};
		policy.afterModelCall(ctx, usageWithEnergy);

		stats.turns.push({ turn: turnNum, model: effectiveModel.id, energy, tokens, decision: decisionLabel });
	}

	stats.endTime = Date.now();
	const elapsed = ((stats.endTime - stats.startTime) / 1000).toFixed(1);
	console.log(
		`\n  \x1b[1mDone: ${stats.turns.length} turns | ${stats.totalEnergy.toFixed(2)}J | ${stats.totalTokens} tokens | ${elapsed}s\x1b[0m`,
	);
	return stats;
}

// -- Scorecard ----------------------------------------------------------------

function printScorecard(baseline: RunStats, energyAware: RunStats, _budget: number): void {
	const baseTime = (baseline.endTime - baseline.startTime) / 1000;
	const eaTime = (energyAware.endTime - energyAware.startTime) / 1000;
	const energySaved =
		baseline.totalEnergy > 0 ? ((baseline.totalEnergy - energyAware.totalEnergy) / baseline.totalEnergy) * 100 : 0;
	const timeDelta = baseTime > 0 ? ((eaTime - baseTime) / baseTime) * 100 : 0;

	const fmtDelta = (val: number, positive = "+"): string => `${val >= 0 ? positive : ""}${val.toFixed(0)}%`;

	console.log(`\n${"═".repeat(70)}`);
	console.log("  FINAL SCORECARD — Coding Agent Energy Challenge");
	console.log(`${"═".repeat(70)}`);
	console.log("  +-----------------+-------------------+---------------------------+");
	console.log("  |                 | Baseline          | Energy-Aware              |");
	console.log("  +-----------------+-------------------+---------------------------+");
	console.log(
		`  | Turns           | ${String(baseline.turns.length).padEnd(17)} | ${String(energyAware.turns.length + (energyAware.abortedAt ? " (aborted)" : " (complete)")).padEnd(25)} |`,
	);
	console.log(
		`  | Energy used     | ${`${baseline.totalEnergy.toFixed(2)} J`.padEnd(17)} | ${`${energyAware.totalEnergy.toFixed(2)} J  (${fmtDelta(-energySaved, "-")} saved)`.padEnd(25)} |`,
	);
	console.log(
		`  | Tokens used     | ${String(baseline.totalTokens).padEnd(17)} | ${String(energyAware.totalTokens).padEnd(25)} |`,
	);
	console.log(
		`  | Wall time       | ${`${baseTime.toFixed(1)} s`.padEnd(17)} | ${`${eaTime.toFixed(1)} s  (${fmtDelta(timeDelta)})`.padEnd(25)} |`,
	);
	console.log("  +-----------------+-------------------+---------------------------+");

	const eaDecisions = energyAware.turns.filter((t) => t.decision);
	if (eaDecisions.length > 0) {
		console.log("\n  POLICY DECISIONS (energy-aware):");
		for (const t of eaDecisions) {
			console.log(`    Turn ${t.turn}: ${t.decision}`);
		}
	}

	console.log("");
	if (energySaved > 0) {
		console.log(
			`  \x1b[32m✓ Energy-aware mode saved ${energySaved.toFixed(0)}% energy${energyAware.abortedAt ? ` (stopped at turn ${energyAware.abortedAt})` : ""}\x1b[0m`,
		);
	} else {
		console.log("  Budget was not exhausted — increase --budget to see routing in action.");
	}
}

// -- Main ---------------------------------------------------------------------

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			budget: { type: "string", default: String(DEFAULT_BUDGET_JOULES) },
		},
		allowPositionals: true,
	});

	if (!process.env.NEURALWATT_API_KEY) {
		console.error("NEURALWATT_API_KEY required");
		process.exit(1);
	}

	const apiKey = process.env.NEURALWATT_API_KEY;
	const budgetJ = Number(values.budget);

	registerBuiltInApiProviders();

	console.log("╔══════════════════════════════════════════════════════════════════════╗");
	console.log("║               Coding Agent Energy Challenge                         ║");
	console.log("║  Task: TypeScript rate-limiting middleware with types and tests      ║");
	console.log(`║  Model: ${DEFAULT_MODEL.id.padEnd(61)}║`);
	console.log(`║  Budget: ${`${budgetJ}J (energy-aware only)`.padEnd(60)}║`);
	console.log(`║  Turns: ${`${TURNS.length} (plan → implement → types → validate → test → integrate)`.padEnd(61)}║`);
	console.log("╚══════════════════════════════════════════════════════════════════════╝");

	const baselineStats = await runCodingAgent("baseline", new BaselinePolicy(), {}, apiKey);
	const energyAwareStats = await runCodingAgent(
		"energy-aware",
		new EnergyAwarePolicy(),
		{ energy_budget_joules: budgetJ },
		apiKey,
	);

	printScorecard(baselineStats, energyAwareStats, budgetJ);
}

main().catch((err) => {
	console.error("Demo failed:", err);
	process.exit(1);
});
