import type { Model, ThinkingLevel } from "@mariozechner/pi-ai";

export interface EnergyBudget {
	energy_budget_joules?: number;
	time_budget_ms?: number;
}

export interface PolicyContext {
	taskId?: string;
	turnNumber: number;
	model: Model<any>;
	/** Models available for routing, sorted by cost.output ascending. */
	availableModels: Model<any>[];
	budget: EnergyBudget;
	/** Joules consumed so far in this run. */
	consumedEnergy: number;
	/** Milliseconds elapsed since run start. */
	consumedTime: number;
	messageCount: number;
	/**
	 * Total input tokens of the current context.
	 * Use the last AssistantMessage's usage.totalTokens as a proxy for context size.
	 */
	estimatedInputTokens: number;
}

export interface PolicyDecision {
	model?: Model<any>;
	maxTokens?: number;
	reasoning?: ThinkingLevel;
	shouldCompact?: boolean;
	abort?: boolean;
	reason?: string;
}

export interface UsageWithEnergy {
	input: number;
	output: number;
	totalTokens: number;
	cost: { total: number };
	energy_joules?: number;
	energy_kwh?: number;
}

export interface RuntimePolicy {
	name: string;
	beforeModelCall(ctx: PolicyContext): PolicyDecision;
	afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void;
}
