/**
 * Core types for the energy-aware benchmark harness.
 * TelemetryRecord is a contract shared with packages/ai — update in coordination with the provider agent.
 */

/** Telemetry record produced per model call. Written as JSONL to results files. */
export interface TelemetryRecord {
	task_id: string;
	run_id: string;
	step_id: string;
	mode: "baseline" | "energy-aware";
	model: string;
	provider: string;
	tokens: {
		input: number;
		output: number;
		total: number;
	};
	latency_ms: number;
	energy_joules: number;
	energy_kwh: number;
	timestamp: number;
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
