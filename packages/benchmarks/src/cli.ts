import { parseArgs } from "node:util";
import { BaselinePolicy } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { runSuite } from "./runner.js";
import { getTasksByGlob } from "./tasks.js";
import type { RunConfig } from "./types.js";

/**
 * Neuralwatt model definitions from portal.neuralwatt.com (March 2026).
 * Sorted by cost.output ascending, then by energy (Wh/request) ascending.
 */
const NEURALWATT_MODELS: Model<"openai-completions">[] = [
	{
		id: "Qwen/Qwen3.5-35B-A3B",
		name: "Qwen3.5 35B",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16_384,
		maxTokens: 4_096,
		capabilities: ["tool_calling"],
	},
	{
		id: "Qwen/Qwen3.5-397B-A17B-FP8",
		name: "Qwen3.5 397B",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		capabilities: ["tool_calling"],
	},
	{
		id: "MiniMaxAI/MiniMax-M2.5",
		name: "MiniMax M2.5",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 196_608,
		maxTokens: 16_384,
		capabilities: ["tool_calling"],
	},
	{
		id: "zai-org/GLM-5-FP8",
		name: "GLM-5",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 202_752,
		maxTokens: 16_384,
		capabilities: ["tool_calling"],
	},
	{
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
		capabilities: ["tool_calling"],
	},
	{
		id: "mistralai/Devstral-Small-2-24B-Instruct-2512",
		name: "Devstral 24B",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.12, output: 0.12, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		capabilities: ["tool_calling"],
	},
	{
		id: "moonshotai/Kimi-K2.5",
		name: "Kimi K2.5",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 1.327, output: 1.327, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 16_384,
		capabilities: ["tool_calling"],
	},
];

function printUsage(): void {
	console.log(`Usage: bench run [options]

Options:
  --mode <mode>           Run mode: baseline, energy-aware, or compare (default: compare)
  --tasks <glob>          Task glob filter (default: all tasks)
  --budget-joules <n>     Energy budget in joules
  --budget-ms <n>         Time budget in milliseconds
  --output <dir>          Output directory (default: ./results)
  --help                  Show this help message
`);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			mode: { type: "string", default: "compare" },
			tasks: { type: "string" },
			"budget-joules": { type: "string" },
			"budget-ms": { type: "string" },
			output: { type: "string", default: "./results" },
			help: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});

	if (values.help) {
		printUsage();
		process.exit(0);
	}

	const mode = values.mode as "baseline" | "energy-aware" | "compare";
	const budgetJoules = values["budget-joules"] ? Number(values["budget-joules"]) : undefined;
	const budgetMs = values["budget-ms"] ? Number(values["budget-ms"]) : undefined;
	const defaultModel = NEURALWATT_MODELS[NEURALWATT_MODELS.length - 1];

	const tasks = getTasksByGlob(values.tasks as string | undefined);

	const baseConfig: RunConfig = {
		mode: "baseline",
		model: defaultModel,
		availableModels: NEURALWATT_MODELS,
		budget: {
			energy_budget_joules: budgetJoules,
			time_budget_ms: budgetMs,
		},
		policy: new BaselinePolicy(),
	};

	if (mode === "baseline" || mode === "compare") {
		console.log("Running baseline...");
		const baselineResult = await runSuite(tasks, baseConfig);
		console.log(
			`Baseline: ${baselineResult.results.length} tasks, ${baselineResult.results.filter((r) => r.passed).length} passed`,
		);

		for (const result of baselineResult.results) {
			console.log(
				`  ${result.task_id}: ${result.passed ? "PASS" : "FAIL"} (${result.energy_joules.toFixed(3)}J, ${result.turns} turns)`,
			);
		}
	}

	if (mode === "energy-aware" || mode === "compare") {
		// Energy-aware mode will use EnergyAwarePolicy once T2.3 is complete
		// For now, use BaselinePolicy as a placeholder
		const energyConfig: RunConfig = {
			...baseConfig,
			mode: "energy-aware",
			policy: new BaselinePolicy(), // Placeholder — replaced when EnergyAwarePolicy is ready
		};

		console.log("Running energy-aware...");
		const energyResult = await runSuite(tasks, energyConfig);
		console.log(
			`Energy-aware: ${energyResult.results.length} tasks, ${energyResult.results.filter((r) => r.passed).length} passed`,
		);

		for (const result of energyResult.results) {
			console.log(
				`  ${result.task_id}: ${result.passed ? "PASS" : "FAIL"} (${result.energy_joules.toFixed(3)}J, ${result.turns} turns)`,
			);
		}
	}
}

main().catch((err) => {
	console.error("Benchmark runner failed:", err);
	process.exit(1);
});
