import type { RuntimePolicy } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { computePressure, runSuite, runTask } from "../src/runner.js";
import type { BenchmarkTask, RunConfig } from "../src/types.js";

/** Reusable mock model for testing. */
function createMockModel(overrides?: Partial<Model<Api>>): Model<Api> {
	return {
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
		...overrides,
	};
}

/** Reusable mock task for testing. */
function createMockTask(overrides?: Partial<BenchmarkTask>): BenchmarkTask {
	return {
		id: "test-task-1",
		name: "Test Task",
		description: "A test task for smoke testing",
		prompt: "What is 2 + 2?",
		maxTurns: 3,
		validator: (records) => ({
			passed: records.length > 0,
			score: records.length > 0 ? 1 : 0,
			reason: records.length > 0 ? "produced telemetry" : "no telemetry",
		}),
		...overrides,
	};
}

/** Reusable run config for testing. */
function createRunConfig(overrides?: Partial<RunConfig>): RunConfig {
	return {
		mode: "baseline",
		model: createMockModel(),
		availableModels: [createMockModel()],
		budget: {},
		...overrides,
	};
}

describe("smoke tests", () => {
	describe("runTask", () => {
		it("produces telemetry records for each turn", async () => {
			const task = createMockTask({ maxTurns: 3 });
			const config = createRunConfig();
			const result = await runTask(task, config);

			expect(result.task_id).toBe("test-task-1");
			expect(result.mode).toBe("baseline");
			expect(result.turns).toBe(3);
			expect(result.passed).toBe(true);
			expect(result.score).toBe(1);
			expect(result.tokens_total).toBeGreaterThan(0);
			expect(result.run_id).toBeDefined();
		});

		it("uses mock turn usage when provided", async () => {
			const task = createMockTask({
				maxTurns: 2,
				mockTurnUsage: [
					{
						input: 100,
						output: 50,
						totalTokens: 150,
						cost: { total: 0.0005 },
						energy_joules: 0.2,
						latency_ms: 50,
					},
					{
						input: 200,
						output: 100,
						totalTokens: 300,
						cost: { total: 0.001 },
						energy_joules: 0.4,
						latency_ms: 80,
					},
				],
			});
			const config = createRunConfig();
			const result = await runTask(task, config);

			expect(result.turns).toBe(2);
			expect(result.tokens_total).toBe(450);
			expect(result.energy_joules).toBeCloseTo(0.6, 5);
		});

		it("calls policy beforeModelCall and afterModelCall on each turn", async () => {
			const beforeFn = vi.fn().mockReturnValue({});
			const afterFn = vi.fn();
			const policy = {
				name: "test-policy",
				beforeModelCall: beforeFn,
				afterModelCall: afterFn,
			};

			const task = createMockTask({ maxTurns: 2 });
			const config = createRunConfig({ policy });
			await runTask(task, config);

			expect(beforeFn).toHaveBeenCalledTimes(2);
			expect(afterFn).toHaveBeenCalledTimes(2);
		});

		it("aborts when policy returns abort decision", async () => {
			const policy = {
				name: "abort-policy",
				beforeModelCall: vi.fn().mockReturnValue({
					abort: true,
					reason: "test abort",
				}),
				afterModelCall: vi.fn(),
			};

			const task = createMockTask({ maxTurns: 5 });
			const config = createRunConfig({ policy });
			const result = await runTask(task, config);

			expect(result.turns).toBe(0);
			expect(result.policy_decisions).toHaveLength(1);
			expect(result.policy_decisions[0].actions).toContain("abort");
			expect(result.policy_decisions[0].reason).toBe("test abort");
		});

		it("logs policy decisions with model routing", async () => {
			const cheapModel = createMockModel({
				id: "openai/gpt-oss-20b",
				cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
			});
			const policy = {
				name: "routing-policy",
				beforeModelCall: vi.fn().mockReturnValue({
					model: cheapModel,
					reason: "routing to cheaper model",
				}),
				afterModelCall: vi.fn(),
			};

			const task = createMockTask({ maxTurns: 1 });
			const config = createRunConfig({ policy });
			const result = await runTask(task, config);

			expect(result.policy_decisions).toHaveLength(1);
			expect(result.policy_decisions[0].actions).toContain("route:openai/gpt-oss-20b");
			expect(result.policy_decisions[0].reason).toBe("routing to cheaper model");
		});
	});

	describe("runSuite", () => {
		it("runs multiple tasks and returns results", async () => {
			const tasks = [
				createMockTask({ id: "task-1", name: "Task 1", maxTurns: 2 }),
				createMockTask({ id: "task-2", name: "Task 2", maxTurns: 1 }),
			];
			const config = createRunConfig();
			const result = await runSuite(tasks, config);

			expect(result.results).toHaveLength(2);
			expect(result.results[0].task_id).toBe("task-1");
			expect(result.results[1].task_id).toBe("task-2");
			expect(result.mode).toBe("baseline");
			expect(result.runId).toBeDefined();
		});

		it("assigns the same run_id to all tasks in a suite", async () => {
			const tasks = [createMockTask({ id: "task-a" }), createMockTask({ id: "task-b" })];
			const config = createRunConfig();
			const result = await runSuite(tasks, config);

			const runIds = result.results.map((r) => r.run_id);
			expect(runIds[0]).toBe(runIds[1]);
			expect(runIds[0]).toBe(result.runId);
		});

		it("produces empty results for empty task list", async () => {
			const config = createRunConfig();
			const result = await runSuite([], config);

			expect(result.results).toHaveLength(0);
		});
	});

	describe("computePressure", () => {
		it("computes energy-based pressure", () => {
			expect(computePressure(5, 1000, { energy_budget_joules: 10 })).toBeCloseTo(0.5);
		});

		it("computes time-based pressure when no energy budget", () => {
			expect(computePressure(0, 5000, { time_budget_ms: 10000 })).toBeCloseTo(0.5);
		});

		it("returns 0 when no budget is set", () => {
			expect(computePressure(5, 5000, {})).toBe(0);
		});

		it("prefers energy budget over time budget", () => {
			const pressure = computePressure(7, 3000, {
				energy_budget_joules: 10,
				time_budget_ms: 10000,
			});
			expect(pressure).toBeCloseTo(0.7);
		});
	});

	describe("no-op policy integration", () => {
		it("no-op policy does not modify behavior", async () => {
			const policy: RuntimePolicy = {
				name: "baseline",
				beforeModelCall: () => ({}),
				afterModelCall: () => {},
			};
			const task = createMockTask({ maxTurns: 3 });
			const configWithPolicy = createRunConfig({ policy });
			const configWithout = createRunConfig();

			const resultWith = await runTask(task, configWithPolicy);
			const resultWithout = await runTask(task, configWithout);

			expect(resultWith.turns).toBe(resultWithout.turns);
			expect(resultWith.tokens_total).toBe(resultWithout.tokens_total);
			expect(resultWith.policy_decisions).toHaveLength(0);
		});
	});
});
