import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BenchmarkReport, TaskComparison, TaskResult } from "./types.js";

/**
 * Build a BenchmarkReport from paired baseline and energy-aware results.
 * Results are matched by task_id.
 */
export function buildReport(baselineResults: TaskResult[], energyAwareResults: TaskResult[]): BenchmarkReport {
	const baselineByTask = new Map(baselineResults.map((r) => [r.task_id, r]));
	const energyByTask = new Map(energyAwareResults.map((r) => [r.task_id, r]));

	const taskIds = [...new Set([...baselineByTask.keys(), ...energyByTask.keys()])];
	const tasks: TaskComparison[] = [];

	for (const taskId of taskIds) {
		const baseline = baselineByTask.get(taskId);
		const energy = energyByTask.get(taskId);
		if (!baseline || !energy) continue;

		const energySavingsPct =
			baseline.energy_joules > 0
				? ((baseline.energy_joules - energy.energy_joules) / baseline.energy_joules) * 100
				: 0;

		const timeDeltaPct = baseline.time_ms > 0 ? ((energy.time_ms - baseline.time_ms) / baseline.time_ms) * 100 : 0;

		tasks.push({
			task_id: taskId,
			task_name: taskId,
			baseline,
			energy_aware: energy,
			energy_savings_pct: energySavingsPct,
			time_delta_pct: timeDeltaPct,
		});
	}

	const baselineSuccessRate = computeSuccessRate(baselineResults);
	const energyAwareSuccessRate = computeSuccessRate(energyAwareResults);
	const meanEnergySavings =
		tasks.length > 0 ? tasks.reduce((sum, t) => sum + t.energy_savings_pct, 0) / tasks.length : 0;
	const meanTimeDelta = tasks.length > 0 ? tasks.reduce((sum, t) => sum + t.time_delta_pct, 0) / tasks.length : 0;

	return {
		run_date: new Date().toISOString().split("T")[0],
		baseline_run_id: baselineResults[0]?.run_id ?? "unknown",
		energy_aware_run_id: energyAwareResults[0]?.run_id ?? "unknown",
		tasks,
		aggregate: {
			mean_energy_savings_pct: round2(meanEnergySavings),
			mean_time_delta_pct: round2(meanTimeDelta),
			baseline_success_rate: round2(baselineSuccessRate),
			energy_aware_success_rate: round2(energyAwareSuccessRate),
		},
	};
}

/**
 * Generate a full report from a results.jsonl file.
 * Each line is a JSON-encoded TaskResult with a "mode" field.
 * Returns the BenchmarkReport, summary CSV string, and Markdown string.
 */
export function generateReport(resultsPath: string): {
	report: BenchmarkReport;
	csv: string;
	markdown: string;
} {
	const content = readFileSync(resultsPath, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	const results: TaskResult[] = lines.map((line) => JSON.parse(line) as TaskResult);

	const baseline = results.filter((r) => r.mode === "baseline");
	const energyAware = results.filter((r) => r.mode === "energy-aware");

	const report = buildReport(baseline, energyAware);
	const csv = generateCsv(results);
	const markdown = generateMarkdownReport(report);

	return { report, csv, markdown };
}

/**
 * Generate a CSV summary from task results.
 * Columns: task_id, mode, time_ms, energy_joules, tokens_total, success, score
 */
export function generateCsv(results: TaskResult[]): string {
	const header = "task_id,mode,time_ms,energy_joules,tokens_total,success,score";
	const rows = results.map(
		(r) =>
			`${r.task_id},${r.mode},${r.time_ms},${r.energy_joules.toFixed(6)},${r.tokens_total},${r.passed},${r.score}`,
	);
	return [header, ...rows].join("\n");
}

/**
 * Generate a markdown report from a BenchmarkReport.
 */
export function generateMarkdownReport(report: BenchmarkReport): string {
	const lines: string[] = [];

	lines.push("# Energy-Aware Benchmark Report");
	lines.push("");
	lines.push(`**Date:** ${report.run_date}`);
	lines.push(`**Baseline run:** ${report.baseline_run_id}`);
	lines.push(`**Energy-aware run:** ${report.energy_aware_run_id}`);
	lines.push("");

	// Per-task table
	lines.push("## Per-Task Results");
	lines.push("");
	lines.push(
		"| Task | Baseline Time | EA Time | Baseline Energy | EA Energy | Energy Savings | Baseline Pass | EA Pass |",
	);
	lines.push(
		"|------|--------------|---------|----------------|-----------|---------------|--------------|---------|",
	);

	for (const t of report.tasks) {
		lines.push(
			`| ${t.task_id} | ${t.baseline.time_ms}ms | ${t.energy_aware.time_ms}ms | ${t.baseline.energy_joules.toFixed(3)}J | ${t.energy_aware.energy_joules.toFixed(3)}J | ${t.energy_savings_pct.toFixed(1)}% | ${t.baseline.passed ? "PASS" : "FAIL"} | ${t.energy_aware.passed ? "PASS" : "FAIL"} |`,
		);
	}

	lines.push("");

	// Aggregate
	lines.push("## Aggregate");
	lines.push("");
	lines.push(`- **Mean energy savings:** ${report.aggregate.mean_energy_savings_pct.toFixed(1)}%`);
	lines.push(`- **Mean time delta:** ${report.aggregate.mean_time_delta_pct.toFixed(1)}%`);
	lines.push(`- **Baseline success rate:** ${report.aggregate.baseline_success_rate.toFixed(1)}%`);
	lines.push(`- **Energy-aware success rate:** ${report.aggregate.energy_aware_success_rate.toFixed(1)}%`);
	lines.push("");

	// Verdict
	const successDelta = report.aggregate.energy_aware_success_rate - report.aggregate.baseline_success_rate;
	const verdict =
		report.aggregate.mean_energy_savings_pct > 0
			? `Energy-aware mode saved ${report.aggregate.mean_energy_savings_pct.toFixed(1)}% energy with ${Math.abs(successDelta).toFixed(1)}% success rate ${successDelta >= 0 ? "improvement" : "impact"}.`
			: `Energy-aware mode used ${Math.abs(report.aggregate.mean_energy_savings_pct).toFixed(1)}% more energy than baseline.`;

	lines.push("## Verdict");
	lines.push("");
	lines.push(verdict);
	lines.push("");

	return lines.join("\n");
}

/**
 * Write a CSV summary file.
 */
export function writeCsv(results: TaskResult[], outputPath: string): void {
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, generateCsv(results), "utf-8");
}

/**
 * Write a markdown report file.
 */
export function writeReport(report: BenchmarkReport, outputPath: string): void {
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, generateMarkdownReport(report), "utf-8");
}

function computeSuccessRate(results: TaskResult[]): number {
	if (results.length === 0) return 0;
	return (results.filter((r) => r.passed).length / results.length) * 100;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
