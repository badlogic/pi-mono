/**
 * Core types for the energy-aware benchmark harness.
 */

import type { AgentTool, EnergyBudget, RuntimePolicy } from "@mariozechner/pi-agent-core";
import type { Api, Model, TelemetryRecord as ProviderTelemetryRecord } from "@mariozechner/pi-ai";

/** Re-export the provider TelemetryRecord as the canonical schema. */
export type { TelemetryRecord } from "@mariozechner/pi-ai";

/** Extends TelemetryRecord with benchmark-specific mode field. */
export interface BenchmarkTelemetryRecord extends ProviderTelemetryRecord {
	mode: "baseline" | "energy-aware";
}

/** Simulated per-turn usage data for mocked benchmark runs. */
export interface MockTurnUsage {
	input: number;
	output: number;
	totalTokens: number;
	cost: { total: number };
	energy_joules?: number;
	energy_kwh?: number;
	latency_ms?: number;
}

/** Definition of a single benchmark task. Supports mocked responses for CI. */
export interface BenchmarkTask {
	id: string;
	name: string;
	description: string;
	prompt: string;
	tools?: AgentTool[];
	maxTurns: number;
	/** Mock usage data per turn. If shorter than maxTurns, defaults are used. */
	mockTurnUsage?: MockTurnUsage[];
	/** Validator receives telemetry records and policy decisions from the run. */
	validator: (
		records: ProviderTelemetryRecord[],
		decisions: PolicyDecisionLog[],
	) => { passed: boolean; score: number; reason: string };
}

/** Aggregated result for a single task run. */
export interface TaskResult {
	task_id: string;
	run_id: string;
	mode: "baseline" | "energy-aware";
	passed: boolean;
	score: number;
	time_ms: number;
	energy_joules: number;
	tokens_total: number;
	turns: number;
	policy_decisions: PolicyDecisionLog[];
}

/** Log entry for a single policy decision. */
export interface PolicyDecisionLog {
	turn: number;
	pressure: number;
	reason: string;
	actions: string[];
}

/** Benchmark comparison report data. */
export interface BenchmarkReport {
	run_date: string;
	baseline_run_id: string;
	energy_aware_run_id: string;
	tasks: TaskComparison[];
	aggregate: {
		mean_energy_savings_pct: number;
		mean_time_delta_pct: number;
		baseline_success_rate: number;
		energy_aware_success_rate: number;
	};
}

/** Side-by-side comparison for one task. */
export interface TaskComparison {
	task_id: string;
	task_name: string;
	baseline: TaskResult;
	energy_aware: TaskResult;
	energy_savings_pct: number;
	time_delta_pct: number;
}

/** Runner configuration with resolved model/policy references. */
export interface RunConfig {
	runId?: string;
	mode: "baseline" | "energy-aware";
	model: Model<Api>;
	availableModels: Model<Api>[];
	budget: EnergyBudget;
	policy?: RuntimePolicy;
}

/** Result of running a complete benchmark suite. */
export interface RunResult {
	runId: string;
	mode: "baseline" | "energy-aware";
	results: TaskResult[];
	records: ProviderTelemetryRecord[];
}
