/**
 * Demo 1: Coding Agent Energy Challenge
 *
 * Simulates a multi-step coding task under both BaselinePolicy and EnergyAwarePolicy,
 * printing a live energy meter per turn and a final comparison scorecard.
 *
 * Uses simulated per-turn usage data so the EnergyAwarePolicy receives proper
 * budget/availableModels context and demonstrates real strategy escalation
 * (reasoning reduction, token reduction, model routing, compaction, abort).
 *
 * Requires NEURALWATT_API_KEY in the environment.
 */

import type {
	EnergyBudget,
	PolicyContext,
	PolicyDecision,
	RuntimePolicy,
	UsageWithEnergy,
} from "@mariozechner/pi-agent-core";
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

const ENERGY_BUDGET_JOULES = 10.0;
const MAX_TURNS = 8;

/** Simulated per-turn usage modeling a realistic multi-step coding task. */
const TURN_USAGE: Array<{
	input: number;
	output: number;
	totalTokens: number;
	energy_joules: number;
	latency_ms: number;
}> = [
	{ input: 800, output: 1200, totalTokens: 2000, energy_joules: 1.2, latency_ms: 3200 },
	{ input: 1500, output: 900, totalTokens: 2400, energy_joules: 1.4, latency_ms: 2800 },
	{ input: 2200, output: 1600, totalTokens: 3800, energy_joules: 1.8, latency_ms: 4100 },
	{ input: 3000, output: 1100, totalTokens: 4100, energy_joules: 2.0, latency_ms: 3600 },
	{ input: 3500, output: 800, totalTokens: 4300, energy_joules: 1.6, latency_ms: 3000 },
	{ input: 3800, output: 600, totalTokens: 4400, energy_joules: 1.3, latency_ms: 2500 },
	{ input: 4000, output: 400, totalTokens: 4400, energy_joules: 1.1, latency_ms: 2000 },
	{ input: 4200, output: 300, totalTokens: 4500, energy_joules: 0.9, latency_ms: 1800 },
];

// -- Types --------------------------------------------------------------------

interface RunStats {
	turns: number;
	totalEnergy: number;
	totalTokens: number;
	startTime: number;
	endTime: number;
	model: string;
	decisions: Array<{ turn: number; reason: string }>;
}

// -- Display helpers ----------------------------------------------------------

function clearLine(): void {
	process.stdout.write("\r\x1b[K");
}

function printMeter(mode: string, turn: number, totalEnergy: number, modelId: string, decision: PolicyDecision): void {
	clearLine();
	const tag = mode === "baseline" ? "baseline" : "energy  ";
	const energyStr = totalEnergy.toFixed(1);

	if (mode === "energy-aware") {
		const pressure = ENERGY_BUDGET_JOULES > 0 ? totalEnergy / ENERGY_BUDGET_JOULES : 0;
		const barLen = 20;
		const filled = Math.min(barLen, Math.round(pressure * barLen));
		const bar = "=".repeat(filled) + " ".repeat(barLen - filled);
		process.stdout.write(
			`[${tag}]  Turn ${turn}/${MAX_TURNS} | Energy: [${bar}] ${energyStr}J / ${ENERGY_BUDGET_JOULES}J | pressure: ${(pressure * 100).toFixed(0)}% | Model: ${modelId}`,
		);
	} else {
		process.stdout.write(`[${tag}]  Turn ${turn}/${MAX_TURNS} | Energy: ${energyStr}J | Model: ${modelId}`);
	}

	if (decision.reason && mode === "energy-aware") {
		process.stdout.write("\n");
		process.stdout.write(`             [policy] ${decision.reason}`);
	}
	process.stdout.write("\n");
}

function printScorecard(baselineStats: RunStats, energyStats: RunStats): void {
	const baseTime = baselineStats.endTime - baselineStats.startTime;
	const eaTime = energyStats.endTime - energyStats.startTime;

	const energyDelta =
		baselineStats.totalEnergy > 0
			? ((energyStats.totalEnergy - baselineStats.totalEnergy) / baselineStats.totalEnergy) * 100
			: 0;
	const timeDelta = baseTime > 0 ? ((eaTime - baseTime) / baseTime) * 100 : 0;

	const fmtDelta = (val: number): string => {
		const sign = val <= 0 ? "" : "+";
		return `${sign}${val.toFixed(0)}%`;
	};

	console.log("");
	console.log("+-------------------------------------------------+");
	console.log("|       Energy-Aware Coding Agent Results          |");
	console.log("+---------------+-----------+----------------------+");
	console.log("|               | Baseline  | Energy-Aware         |");
	console.log("+---------------+-----------+----------------------+");
	console.log(
		`| Energy        | ${pad(`${baselineStats.totalEnergy.toFixed(1)} J`, 9)} | ${pad(`${energyStats.totalEnergy.toFixed(1)} J  (${fmtDelta(energyDelta)})`, 20)} |`,
	);
	console.log(
		`| Time          | ${pad(formatMs(baseTime), 9)} | ${pad(`${formatMs(eaTime)}  (${fmtDelta(timeDelta)})`, 20)} |`,
	);
	console.log(`| Turns         | ${pad(String(baselineStats.turns), 9)} | ${pad(String(energyStats.turns), 20)} |`);
	console.log(
		`| Tokens        | ${pad(String(baselineStats.totalTokens), 9)} | ${pad(String(energyStats.totalTokens), 20)} |`,
	);
	console.log("+---------------+-----------+----------------------+");

	if (energyStats.decisions.length > 0) {
		console.log("");
		console.log("Policy decisions (energy-aware):");
		for (const d of energyStats.decisions) {
			console.log(`  Turn ${d.turn}: ${d.reason}`);
		}
	}
}

function pad(s: string, len: number): string {
	return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

// -- Simulation ---------------------------------------------------------------

/**
 * Simulate a multi-turn coding agent run under a given policy.
 * Drives the policy with realistic turn data and prints a live meter.
 */
function simulateRun(mode: "baseline" | "energy-aware", policy: RuntimePolicy, budget: EnergyBudget): RunStats {
	const stats: RunStats = {
		turns: 0,
		totalEnergy: 0,
		totalTokens: 0,
		startTime: Date.now(),
		endTime: 0,
		model: DEFAULT_MODEL.id,
		decisions: [],
	};

	let consumedEnergy = 0;
	let estimatedInputTokens = 0;

	console.log(`\n--- Running ${mode} mode ---\n`);

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		const turnData = TURN_USAGE[turn];
		const elapsed = Date.now() - stats.startTime;

		// Build policy context with proper budget and available models
		const ctx: PolicyContext = {
			turnNumber: turn + 1,
			model: DEFAULT_MODEL,
			availableModels: NEURALWATT_MODELS,
			budget,
			consumedEnergy,
			consumedTime: elapsed,
			messageCount: turn + 1,
			estimatedInputTokens,
		};

		// Get policy decision
		const decision = policy.beforeModelCall(ctx);

		// Check abort
		if (decision.abort) {
			stats.decisions.push({ turn: turn + 1, reason: decision.reason ?? "budget exhausted" });
			printMeter(mode, turn + 1, consumedEnergy, stats.model, decision);
			break;
		}

		// Record non-trivial decisions
		if (decision.reason) {
			stats.decisions.push({ turn: turn + 1, reason: decision.reason });
		}

		// Apply model routing -- scale energy by cost ratio if routed to cheaper model
		const effectiveModel = decision.model ?? DEFAULT_MODEL;
		const energyScale = decision.model ? decision.model.cost.output / DEFAULT_MODEL.cost.output : 1;
		const adjustedEnergy = turnData.energy_joules * energyScale;

		consumedEnergy += adjustedEnergy;
		estimatedInputTokens = turnData.totalTokens;
		stats.totalTokens += turnData.totalTokens;
		stats.turns = turn + 1;
		stats.model = effectiveModel.id;

		// Notify policy after model call
		const usageWithEnergy: UsageWithEnergy = {
			input: turnData.input,
			output: turnData.output,
			totalTokens: turnData.totalTokens,
			cost: { total: 0.001 },
			energy_joules: adjustedEnergy,
			energy_kwh: adjustedEnergy / 3_600_000,
		};
		policy.afterModelCall(ctx, usageWithEnergy);

		stats.totalEnergy = consumedEnergy;

		// Print live meter
		printMeter(mode, turn + 1, consumedEnergy, effectiveModel.id, decision);

		// Simulate turn latency (capped at 200ms for demo speed)
		const sleepMs = Math.min(turnData.latency_ms / 10, 200);
		const end = Date.now() + sleepMs;
		while (Date.now() < end) {
			// busy-wait to simulate turn latency
		}
	}

	stats.endTime = Date.now();
	console.log(`\n[${mode}] Complete: ${stats.turns} turns, ${stats.totalEnergy.toFixed(2)}J\n`);
	return stats;
}

// -- Main ---------------------------------------------------------------------

function main(): void {
	if (!process.env.NEURALWATT_API_KEY) {
		console.error("NEURALWATT_API_KEY required");
		process.exit(1);
	}

	console.log("=== Coding Agent Energy Challenge ===");
	console.log("Task: Implement rate-limiting middleware with JSDoc, validation, and tests");
	console.log(`Model: ${DEFAULT_MODEL.id}`);
	console.log(`Energy budget: ${ENERGY_BUDGET_JOULES}J (energy-aware mode only)`);
	console.log(`Max turns: ${MAX_TURNS}`);

	// Run baseline (no budget enforcement)
	const baselinePolicy = new BaselinePolicy();
	const baselineStats = simulateRun("baseline", baselinePolicy, {});

	// Run energy-aware (with budget)
	const energyAwarePolicy = new EnergyAwarePolicy();
	const energyStats = simulateRun("energy-aware", energyAwarePolicy, {
		energy_budget_joules: ENERGY_BUDGET_JOULES,
	});

	// Print final scorecard
	printScorecard(baselineStats, energyStats);
}

main();
