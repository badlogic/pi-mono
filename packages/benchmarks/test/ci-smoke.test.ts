/**
 * CI smoke benchmark — runs 2-3 tasks with mocked responses end-to-end.
 * Validates that the benchmark infrastructure works, not actual energy savings.
 * Fails if the runner crashes or produces invalid output.
 */

import type { RuntimePolicy } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { runSuite, runTask } from "../src/runner.js";
import { BENCHMARK_TASKS, getTasksByGlob } from "../src/tasks.js";
import type { RunConfig, TaskResult } from "../src/types.js";

const MOCK_MODEL: Model<Api> = {
	id: "moonshotai/Kimi-K2.5",
	name: "Kimi K2.5",
	api: "openai-completions" as Api,
	provider: "neuralwatt",
	baseUrl: "https://api.neuralwatt.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 1.327, output: 1.327, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_144,
	maxTokens: 16_384,
};

const CHEAP_MODEL: Model<Api> = {
	id: "openai/gpt-oss-20b",
	name: "GPT-OSS 20B",
	api: "openai-completions" as Api,
	provider: "neuralwatt",
	baseUrl: "https://api.neuralwatt.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16_384,
	maxTokens: 4_096,
};

function baseConfig(overrides?: Partial<RunConfig>): RunConfig {
	return {
		mode: "baseline",
		model: MOCK_MODEL,
		availableModels: [CHEAP_MODEL, MOCK_MODEL],
		budget: {},
		...overrides,
	};
}

/** A no-op policy that does not intervene. */
const noOpPolicy: RuntimePolicy = {
	name: "baseline",
	beforeModelCall: () => ({}),
	afterModelCall: () => {},
};

function validateTaskResult(result: TaskResult): void {
	expect(result.task_id).toBeTruthy();
	expect(result.run_id).toBeTruthy();
	expect(typeof result.mode).toBe("string");
	expect(typeof result.passed).toBe("boolean");
	expect(typeof result.score).toBe("number");
	expect(result.score).toBeGreaterThanOrEqual(0);
	expect(result.score).toBeLessThanOrEqual(1);
	expect(result.time_ms).toBeGreaterThanOrEqual(0);
	expect(result.energy_joules).toBeGreaterThanOrEqual(0);
	expect(result.tokens_total).toBeGreaterThanOrEqual(0);
	expect(result.turns).toBeGreaterThanOrEqual(0);
	expect(Array.isArray(result.policy_decisions)).toBe(true);
}

describe("CI smoke benchmark", () => {
	const ciTasks = [
		BENCHMARK_TASKS.find((t) => t.id === "qa-factual")!,
		BENCHMARK_TASKS.find((t) => t.id === "code-fizzbuzz")!,
		BENCHMARK_TASKS.find((t) => t.id === "reason-math")!,
	];

	it("selected CI tasks exist in the suite", () => {
		for (const task of ciTasks) {
			expect(task).toBeDefined();
		}
	});

	describe("baseline mode", () => {
		it("runs all CI tasks without crashing", async () => {
			const config = baseConfig({ mode: "baseline", policy: noOpPolicy });
			const suiteResult = await runSuite(ciTasks, config);

			expect(suiteResult.results).toHaveLength(3);
			expect(suiteResult.mode).toBe("baseline");
			expect(suiteResult.runId).toBeTruthy();
		});

		it("produces valid task results", async () => {
			const config = baseConfig({ mode: "baseline" });
			const suiteResult = await runSuite(ciTasks, config);

			for (const result of suiteResult.results) {
				validateTaskResult(result);
				expect(result.mode).toBe("baseline");
			}
		});

		it("all CI tasks pass validation", async () => {
			const config = baseConfig({ mode: "baseline" });
			const suiteResult = await runSuite(ciTasks, config);

			const allPassed = suiteResult.results.every((r) => r.passed);
			expect(allPassed).toBe(true);
		});
	});

	describe("energy-aware mode", () => {
		it("runs all CI tasks without crashing", async () => {
			const config = baseConfig({ mode: "energy-aware", policy: noOpPolicy });
			const suiteResult = await runSuite(ciTasks, config);

			expect(suiteResult.results).toHaveLength(3);
			expect(suiteResult.mode).toBe("energy-aware");
		});

		it("produces valid task results", async () => {
			const config = baseConfig({ mode: "energy-aware" });
			const suiteResult = await runSuite(ciTasks, config);

			for (const result of suiteResult.results) {
				validateTaskResult(result);
				expect(result.mode).toBe("energy-aware");
			}
		});
	});

	describe("compare mode (both modes back-to-back)", () => {
		it("runs baseline and energy-aware and both produce results", async () => {
			const baselineResult = await runSuite(ciTasks, baseConfig({ mode: "baseline" }));
			const energyResult = await runSuite(ciTasks, baseConfig({ mode: "energy-aware" }));

			expect(baselineResult.results).toHaveLength(3);
			expect(energyResult.results).toHaveLength(3);
			expect(baselineResult.runId).not.toBe(energyResult.runId);
		});
	});

	describe("task filtering with getTasksByGlob", () => {
		it("qa-* filter selects exactly the Q&A tasks", () => {
			const tasks = getTasksByGlob("qa-*");
			expect(tasks).toHaveLength(2);
		});

		it("filtered tasks run successfully", async () => {
			const tasks = getTasksByGlob("qa-*");
			const config = baseConfig({ mode: "baseline" });
			const result = await runSuite(tasks, config);

			expect(result.results).toHaveLength(2);
			expect(result.results.every((r) => r.passed)).toBe(true);
		});
	});

	describe("budget enforcement", () => {
		it("runs with energy budget set", async () => {
			const config = baseConfig({
				mode: "baseline",
				budget: { energy_budget_joules: 10.0 },
			});
			const result = await runSuite(ciTasks, config);
			expect(result.results).toHaveLength(3);
		});

		it("runs with time budget set", async () => {
			const config = baseConfig({
				mode: "baseline",
				budget: { time_budget_ms: 30000 },
			});
			const result = await runSuite(ciTasks, config);
			expect(result.results).toHaveLength(3);
		});
	});

	describe("individual task execution", () => {
		it("runs a single task and produces telemetry turns", async () => {
			const task = ciTasks[1]; // code-fizzbuzz
			const config = baseConfig({ mode: "baseline" });
			const result = await runTask(task, config);

			expect(result.task_id).toBe("code-fizzbuzz");
			expect(result.turns).toBe(2);
			expect(result.tokens_total).toBeGreaterThan(0);
			expect(result.energy_joules).toBeGreaterThan(0);
		});
	});
});
