import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PolicyContext, PolicyDecision, UsageWithEnergy } from "@mariozechner/pi-agent-core";
import type { TelemetryRecord } from "@mariozechner/pi-ai";
import type { BenchmarkTask, MockTurnUsage, PolicyDecisionLog, RunConfig, RunResult, TaskResult } from "./types.js";

const DEFAULT_TURN_USAGE: MockTurnUsage = {
	input: 500,
	output: 200,
	totalTokens: 700,
	cost: { total: 0.001 },
	energy_joules: 0.5,
	energy_kwh: 0.5 / 3_600_000,
	latency_ms: 100,
};

/**
 * Get mock turn usage for a given turn index.
 * If mockTurnUsage is shorter than the turn index, repeats the last entry.
 */
function getTurnUsage(task: BenchmarkTask, turn: number): MockTurnUsage {
	if (!task.mockTurnUsage || task.mockTurnUsage.length === 0) {
		return DEFAULT_TURN_USAGE;
	}
	const idx = Math.min(turn, task.mockTurnUsage.length - 1);
	return task.mockTurnUsage[idx];
}

/**
 * Compute budget pressure from consumed energy/time and budget limits.
 */
export function computePressure(
	consumedEnergy: number,
	consumedTime: number,
	budget: { energy_budget_joules?: number; time_budget_ms?: number },
): number {
	if (budget.energy_budget_joules && budget.energy_budget_joules > 0) {
		return consumedEnergy / budget.energy_budget_joules;
	}
	if (budget.time_budget_ms && budget.time_budget_ms > 0) {
		return consumedTime / budget.time_budget_ms;
	}
	return 0;
}

/**
 * Execute a single benchmark task under a given policy.
 * Uses mocked turn data — in real integration the agent loop provides actual model responses.
 */
export async function runTask(task: BenchmarkTask, config: RunConfig): Promise<TaskResult> {
	const runId = config.runId ?? randomUUID();
	const startTime = Date.now();
	const telemetryRecords: TelemetryRecord[] = [];
	const policyDecisions: PolicyDecisionLog[] = [];

	let consumedEnergy = 0;
	let totalTokens = 0;
	let estimatedInputTokens = 0;

	for (let turn = 0; turn < task.maxTurns; turn++) {
		const stepId = `${task.id}-step-${turn}`;

		// Build policy context
		const ctx: PolicyContext = {
			taskId: task.id,
			turnNumber: turn,
			model: config.model,
			availableModels: config.availableModels,
			budget: config.budget,
			consumedEnergy,
			consumedTime: Date.now() - startTime,
			messageCount: turn,
			estimatedInputTokens,
		};

		// Call beforeModelCall
		let decision: PolicyDecision = {};
		if (config.policy) {
			decision = config.policy.beforeModelCall(ctx);
		}

		// Check abort
		if (decision.abort) {
			policyDecisions.push({
				turn,
				pressure: computePressure(consumedEnergy, ctx.consumedTime, config.budget),
				reason: decision.reason ?? "budget exhausted",
				actions: ["abort"],
			});
			break;
		}

		// Log policy decision if non-trivial
		const actions: string[] = [];
		if (decision.model) actions.push(`route:${decision.model.id}`);
		if (decision.reasoning) actions.push(`reasoning:${decision.reasoning}`);
		if (decision.maxTokens) actions.push(`maxTokens:${decision.maxTokens}`);
		if (decision.shouldCompact) actions.push("compact");

		if (actions.length > 0 || decision.reason) {
			policyDecisions.push({
				turn,
				pressure: computePressure(consumedEnergy, ctx.consumedTime, config.budget),
				reason: decision.reason ?? "",
				actions,
			});
		}

		// Simulate model call with mock data
		const turnUsage = getTurnUsage(task, turn);

		// Apply model routing — if policy chose a cheaper model, simulate lower energy
		const effectiveModel = decision.model ?? config.model;
		const energyScale = decision.model ? decision.model.cost.output / config.model.cost.output : 1;
		const adjustedEnergy = (turnUsage.energy_joules ?? 0.5) * energyScale;

		consumedEnergy += adjustedEnergy;
		totalTokens += turnUsage.totalTokens;
		estimatedInputTokens = turnUsage.totalTokens;

		// Build telemetry record
		const record: TelemetryRecord = {
			task_id: task.id,
			run_id: runId,
			step_id: stepId,
			model: effectiveModel.id,
			provider: effectiveModel.provider,
			tokens: {
				input: turnUsage.input,
				output: turnUsage.output,
				total: turnUsage.totalTokens,
			},
			latency_ms: turnUsage.latency_ms ?? 100,
			energy_joules: adjustedEnergy,
			energy_kwh: adjustedEnergy / 3_600_000,
			timestamp: Date.now(),
		};
		telemetryRecords.push(record);

		// Call afterModelCall
		if (config.policy) {
			const usageWithEnergy: UsageWithEnergy = {
				input: turnUsage.input,
				output: turnUsage.output,
				totalTokens: turnUsage.totalTokens,
				cost: turnUsage.cost,
				energy_joules: adjustedEnergy,
				energy_kwh: adjustedEnergy / 3_600_000,
			};
			config.policy.afterModelCall(ctx, usageWithEnergy);
		}
	}

	const endTime = Date.now();

	// Validate task result
	const validation = task.validator(telemetryRecords, policyDecisions);

	return {
		task_id: task.id,
		run_id: runId,
		mode: config.mode,
		passed: validation.passed,
		score: validation.score,
		time_ms: endTime - startTime,
		energy_joules: consumedEnergy,
		tokens_total: totalTokens,
		turns: telemetryRecords.length,
		policy_decisions: policyDecisions,
	};
}

/**
 * Run all tasks in a suite under a given configuration.
 */
export async function runSuite(tasks: BenchmarkTask[], config: RunConfig): Promise<RunResult> {
	const runId = config.runId ?? randomUUID();
	const results: TaskResult[] = [];

	for (const task of tasks) {
		const taskConfig: RunConfig = { ...config, runId };
		const result = await runTask(task, taskConfig);
		results.push(result);
	}

	return { runId, mode: config.mode, results, records: [] };
}

/**
 * Write telemetry records to a JSONL file.
 */
export function writeTelemetryJsonl(records: TelemetryRecord[], outputPath: string): void {
	mkdirSync(dirname(outputPath), { recursive: true });
	const lines = records.map((r) => JSON.stringify(r)).join("\n");
	writeFileSync(outputPath, `${lines}\n`, "utf-8");
}
