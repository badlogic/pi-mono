import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport, generateCsv, generateMarkdownReport, generateReport } from "../src/report.js";
import type { TaskResult } from "../src/types.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

function createResult(
	overrides: Partial<TaskResult> & { task_id: string; mode: "baseline" | "energy-aware" },
): TaskResult {
	return {
		run_id: "run-1",
		passed: true,
		score: 1,
		time_ms: 100,
		energy_joules: 1.0,
		tokens_total: 700,
		turns: 3,
		policy_decisions: [],
		...overrides,
	};
}

describe("report", () => {
	describe("buildReport", () => {
		it("pairs baseline and energy-aware results by task_id", () => {
			const baseline = [
				createResult({ task_id: "task-1", mode: "baseline", energy_joules: 2.0 }),
				createResult({ task_id: "task-2", mode: "baseline", energy_joules: 4.0 }),
			];
			const energyAware = [
				createResult({ task_id: "task-1", mode: "energy-aware", energy_joules: 1.0 }),
				createResult({ task_id: "task-2", mode: "energy-aware", energy_joules: 3.0 }),
			];

			const report = buildReport(baseline, energyAware);

			expect(report.tasks).toHaveLength(2);
			expect(report.tasks[0].task_id).toBe("task-1");
			expect(report.tasks[0].energy_savings_pct).toBeCloseTo(50, 1);
			expect(report.tasks[1].task_id).toBe("task-2");
			expect(report.tasks[1].energy_savings_pct).toBeCloseTo(25, 1);
		});

		it("computes aggregate stats correctly", () => {
			const baseline = [
				createResult({ task_id: "t1", mode: "baseline", energy_joules: 10, time_ms: 1000, passed: true }),
				createResult({ task_id: "t2", mode: "baseline", energy_joules: 10, time_ms: 1000, passed: true }),
			];
			const energyAware = [
				createResult({ task_id: "t1", mode: "energy-aware", energy_joules: 7, time_ms: 900, passed: true }),
				createResult({ task_id: "t2", mode: "energy-aware", energy_joules: 5, time_ms: 800, passed: false }),
			];

			const report = buildReport(baseline, energyAware);

			expect(report.aggregate.mean_energy_savings_pct).toBeCloseTo(40, 0);
			expect(report.aggregate.baseline_success_rate).toBe(100);
			expect(report.aggregate.energy_aware_success_rate).toBe(50);
		});

		it("skips tasks missing from one side", () => {
			const baseline = [createResult({ task_id: "t1", mode: "baseline" })];
			const energyAware = [createResult({ task_id: "t2", mode: "energy-aware" })];

			const report = buildReport(baseline, energyAware);

			expect(report.tasks).toHaveLength(0);
		});

		it("handles empty results", () => {
			const report = buildReport([], []);

			expect(report.tasks).toHaveLength(0);
			expect(report.aggregate.mean_energy_savings_pct).toBe(0);
			expect(report.aggregate.baseline_success_rate).toBe(0);
		});
	});

	describe("generateCsv", () => {
		it("produces correct CSV format", () => {
			const results = [
				createResult({
					task_id: "t1",
					mode: "baseline",
					time_ms: 150,
					energy_joules: 1.5,
					tokens_total: 800,
					passed: true,
					score: 1,
				}),
				createResult({
					task_id: "t2",
					mode: "energy-aware",
					time_ms: 100,
					energy_joules: 0.8,
					tokens_total: 600,
					passed: false,
					score: 0,
				}),
			];

			const csv = generateCsv(results);
			const lines = csv.split("\n");

			expect(lines[0]).toBe("task_id,mode,time_ms,energy_joules,tokens_total,success,score");
			expect(lines[1]).toContain("t1,baseline,150,1.500000,800,true,1");
			expect(lines[2]).toContain("t2,energy-aware,100,0.800000,600,false,0");
		});

		it("handles empty results", () => {
			const csv = generateCsv([]);
			expect(csv).toBe("task_id,mode,time_ms,energy_joules,tokens_total,success,score");
		});
	});

	describe("generateMarkdownReport", () => {
		it("produces valid markdown with all sections", () => {
			const baseline = [createResult({ task_id: "t1", mode: "baseline", energy_joules: 10, time_ms: 1000 })];
			const energyAware = [createResult({ task_id: "t1", mode: "energy-aware", energy_joules: 6, time_ms: 800 })];

			const report = buildReport(baseline, energyAware);
			const md = generateMarkdownReport(report);

			expect(md).toContain("# Energy-Aware Benchmark Report");
			expect(md).toContain("## Per-Task Results");
			expect(md).toContain("## Aggregate");
			expect(md).toContain("## Verdict");
			expect(md).toContain("t1");
			expect(md).toContain("40.0%");
		});

		it("handles negative savings (energy-aware used more)", () => {
			const baseline = [createResult({ task_id: "t1", mode: "baseline", energy_joules: 5 })];
			const energyAware = [createResult({ task_id: "t1", mode: "energy-aware", energy_joules: 8 })];

			const report = buildReport(baseline, energyAware);
			const md = generateMarkdownReport(report);

			expect(md).toContain("more energy than baseline");
		});
	});

	describe("generateReport (from JSONL to files)", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = mkdtempSync(join(tmpdir(), "bench-report-"));
		});

		afterEach(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("reads results.jsonl and writes summary.csv and report.md", () => {
			const resultsPath = join(FIXTURES_DIR, "results.jsonl");
			const report = generateReport(resultsPath, tmpDir);

			// Verify report data
			expect(report.tasks).toHaveLength(3);
			expect(report.baseline_run_id).toBe("run-baseline-1");
			expect(report.energy_aware_run_id).toBe("run-ea-1");

			// qa-factual: baseline 0.2J, ea 0.15J -> 25% savings
			const qaTask = report.tasks.find((t) => t.task_id === "qa-factual");
			expect(qaTask).toBeDefined();
			expect(qaTask!.energy_savings_pct).toBeCloseTo(25, 0);

			// code-fizzbuzz: baseline 1.6J, ea 1.0J -> 37.5% savings
			const codeTask = report.tasks.find((t) => t.task_id === "code-fizzbuzz");
			expect(codeTask).toBeDefined();
			expect(codeTask!.energy_savings_pct).toBeCloseTo(37.5, 0);

			// reason-math: baseline 2.4J, ea 1.6J -> 33.3% savings
			const reasonTask = report.tasks.find((t) => t.task_id === "reason-math");
			expect(reasonTask).toBeDefined();
			expect(reasonTask!.energy_savings_pct).toBeCloseTo(33.3, 0);

			// All tasks pass in both modes
			expect(report.aggregate.baseline_success_rate).toBe(100);
			expect(report.aggregate.energy_aware_success_rate).toBe(100);
			expect(report.aggregate.mean_energy_savings_pct).toBeGreaterThan(0);

			// Verify summary.csv was written
			const csvPath = join(tmpDir, "summary.csv");
			expect(existsSync(csvPath)).toBe(true);
			const csv = readFileSync(csvPath, "utf-8");
			const csvLines = csv.trim().split("\n");
			expect(csvLines[0]).toBe("task_id,mode,time_ms,energy_joules,tokens_total,success,score");
			expect(csvLines).toHaveLength(7); // header + 6 data rows

			// Verify report.md was written
			const mdPath = join(tmpDir, "report.md");
			expect(existsSync(mdPath)).toBe(true);
			const markdown = readFileSync(mdPath, "utf-8");
			expect(markdown).toContain("# Energy-Aware Benchmark Report");
			expect(markdown).toContain("## Per-Task Results");
			expect(markdown).toContain("## Aggregate");
			expect(markdown).toContain("## Verdict");
			expect(markdown).toContain("saved");
		});
	});
});
