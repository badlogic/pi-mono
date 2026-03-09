import { describe, expect, it } from "vitest";
import { BENCHMARK_TASKS, getTasksByGlob } from "../src/tasks.js";

describe("benchmark task suite", () => {
	it("contains exactly 10 tasks", () => {
		expect(BENCHMARK_TASKS).toHaveLength(10);
	});

	it("all tasks have unique IDs", () => {
		const ids = BENCHMARK_TASKS.map((t) => t.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});

	it("all tasks have required fields", () => {
		for (const task of BENCHMARK_TASKS) {
			expect(task.id).toBeTruthy();
			expect(task.name).toBeTruthy();
			expect(task.description).toBeTruthy();
			expect(task.prompt).toBeTruthy();
			expect(task.maxTurns).toBeGreaterThan(0);
			expect(typeof task.validator).toBe("function");
		}
	});

	it("includes 2 Q&A tasks", () => {
		const qaTasks = BENCHMARK_TASKS.filter((t) => t.id.startsWith("qa-"));
		expect(qaTasks).toHaveLength(2);
	});

	it("includes 3 code generation tasks", () => {
		const codeTasks = BENCHMARK_TASKS.filter((t) => t.id.startsWith("code-"));
		expect(codeTasks).toHaveLength(3);
	});

	it("includes 2 reasoning tasks", () => {
		const reasonTasks = BENCHMARK_TASKS.filter((t) => t.id.startsWith("reason-"));
		expect(reasonTasks).toHaveLength(2);
	});

	it("includes 2 summarization tasks", () => {
		const summaryTasks = BENCHMARK_TASKS.filter((t) => t.id.startsWith("summary-"));
		expect(summaryTasks).toHaveLength(2);
	});

	it("includes 1 orchestration task", () => {
		const orchTasks = BENCHMARK_TASKS.filter((t) => t.id.startsWith("orchestration-"));
		expect(orchTasks).toHaveLength(1);
	});

	it("all tasks have mockTurnUsage defined", () => {
		for (const task of BENCHMARK_TASKS) {
			expect(task.mockTurnUsage).toBeDefined();
			expect(task.mockTurnUsage!.length).toBeGreaterThan(0);
		}
	});

	it("validators pass with valid telemetry records", () => {
		for (const task of BENCHMARK_TASKS) {
			const mockRecords = Array.from({ length: task.maxTurns }, (_, i) => ({
				task_id: task.id,
				run_id: "test-run",
				step_id: `${task.id}-step-${i}`,
				model: "moonshotai/Kimi-K2.5",
				provider: "neuralwatt",
				tokens: { input: 500, output: 200, total: 700 },
				latency_ms: 100,
				energy_joules: 0.5,
				energy_kwh: 0.5 / 3_600_000,
				timestamp: Date.now(),
			}));
			const result = task.validator(mockRecords, []);
			expect(result.passed).toBe(true);
			expect(result.score).toBeGreaterThan(0);
			expect(result.reason).toBeTruthy();
		}
	});
});

describe("getTasksByGlob", () => {
	it("returns all tasks when no pattern given", () => {
		expect(getTasksByGlob()).toHaveLength(10);
		expect(getTasksByGlob(undefined)).toHaveLength(10);
	});

	it("filters by prefix glob", () => {
		const qaTasks = getTasksByGlob("qa-*");
		expect(qaTasks).toHaveLength(2);
		expect(qaTasks.every((t) => t.id.startsWith("qa-"))).toBe(true);
	});

	it("filters by exact ID", () => {
		const tasks = getTasksByGlob("code-fizzbuzz");
		expect(tasks).toHaveLength(1);
		expect(tasks[0].id).toBe("code-fizzbuzz");
	});

	it("returns empty for non-matching pattern", () => {
		expect(getTasksByGlob("nonexistent-*")).toHaveLength(0);
	});
});
