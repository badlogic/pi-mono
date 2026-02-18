import type { ThinkingLevel } from "@mariozechner/pi-ai";
import type { PolicyContext, PolicyDecision, RuntimePolicy, UsageWithEnergy } from "./types.js";

const REASONING_LEVELS: readonly ThinkingLevel[] = ["high", "medium", "low", "minimal"];

/**
 * EnergyAwarePolicy: reduces energy consumption via a strategy chain
 * that progressively intervenes as budget pressure increases.
 *
 * Strategy chain (priority order):
 * 1. Reasoning reduction (pressure > 30%)
 * 2. Token limit reduction (pressure > 50%)
 * 3. Model routing (pressure > 70%)
 * 4. Context compaction (pressure > 50% AND estimatedInputTokens > 60% of contextWindow)
 * 5. Budget exhaustion abort (pressure >= 100%)
 */
export class EnergyAwarePolicy implements RuntimePolicy {
	readonly name = "energy-aware";

	private readonly _log: Array<{ ctx: PolicyContext; usage: UsageWithEnergy }> = [];

	beforeModelCall(ctx: PolicyContext): PolicyDecision {
		const pressure = this.calculatePressure(ctx);

		// No intervention when pressure is 0 (no budget set or no consumption)
		if (pressure === 0) {
			return {};
		}

		const decision: PolicyDecision = {};
		const reasons: string[] = [];

		// Strategy 5 first: budget exhaustion check (>= 100%)
		if (pressure >= 1.0) {
			this.applyBudgetExhaustion(decision, reasons, pressure);
			return decision;
		}

		// Strategy 1: reasoning reduction (> 30%)
		this.applyReasoningReduction(ctx, decision, reasons, pressure);

		// Strategy 2: token limit reduction (> 50%)
		this.applyTokenReduction(ctx, decision, reasons, pressure);

		// Strategy 3: model routing (> 70%)
		this.applyModelRouting(ctx, decision, reasons, pressure);

		// Strategy 4: context compaction (> 50% AND estimatedInputTokens > 60% of contextWindow)
		this.applyContextCompaction(ctx, decision, reasons, pressure);

		if (reasons.length > 0) {
			decision.reason = reasons.join("; ");
		}

		return decision;
	}

	afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void {
		this._log.push({ ctx: { ...ctx }, usage: { ...usage } });
	}

	get log(): ReadonlyArray<{ ctx: PolicyContext; usage: UsageWithEnergy }> {
		return this._log;
	}

	/** Calculate budget pressure as a ratio from 0 to unbounded. */
	private calculatePressure(ctx: PolicyContext): number {
		const { budget, consumedEnergy, consumedTime } = ctx;

		if (budget.energy_budget_joules != null && budget.energy_budget_joules > 0) {
			return consumedEnergy / budget.energy_budget_joules;
		}

		if (budget.time_budget_ms != null && budget.time_budget_ms > 0) {
			return consumedTime / budget.time_budget_ms;
		}

		return 0;
	}

	/**
	 * Strategy 1: Reduce reasoning level when pressure > 30%.
	 * Steps down through: high -> medium -> low -> minimal.
	 */
	private applyReasoningReduction(
		ctx: PolicyContext,
		decision: PolicyDecision,
		reasons: string[],
		pressure: number,
	): void {
		if (pressure <= 0.3) return;

		const currentLevel = ctx.model.reasoning ? "high" : undefined;
		if (currentLevel === undefined) return;

		// Scale reasoning reduction with pressure: higher pressure = lower reasoning
		let targetIndex: number;
		if (pressure > 0.8) {
			targetIndex = 3; // minimal
		} else if (pressure > 0.6) {
			targetIndex = 2; // low
		} else {
			targetIndex = 1; // medium (> 30% threshold)
		}

		const target = REASONING_LEVELS[targetIndex];
		if (target !== currentLevel) {
			decision.reasoning = target;
			reasons.push(`reasoning: ${currentLevel} -> ${target} (pressure ${(pressure * 100).toFixed(0)}%)`);
		}
	}

	/**
	 * Strategy 2: Reduce maxTokens by up to 40% when pressure > 50%.
	 * Scales linearly: 50% pressure = 0% reduction, 100% pressure = 40% reduction.
	 */
	private applyTokenReduction(
		ctx: PolicyContext,
		decision: PolicyDecision,
		reasons: string[],
		pressure: number,
	): void {
		if (pressure <= 0.5) return;

		const reductionFactor = Math.min(0.4, ((pressure - 0.5) / 0.5) * 0.4);
		const newMaxTokens = Math.floor(ctx.model.maxTokens * (1 - reductionFactor));

		if (newMaxTokens < ctx.model.maxTokens) {
			decision.maxTokens = newMaxTokens;
			reasons.push(
				`maxTokens: ${ctx.model.maxTokens} -> ${newMaxTokens} (-${(reductionFactor * 100).toFixed(0)}%, pressure ${(pressure * 100).toFixed(0)}%)`,
			);
		}
	}

	/**
	 * Strategy 3: Route to cheaper model when pressure > 70%.
	 * Picks the cheapest model from availableModels that supports required capabilities.
	 */
	private applyModelRouting(ctx: PolicyContext, decision: PolicyDecision, reasons: string[], pressure: number): void {
		if (pressure <= 0.7) return;
		if (ctx.availableModels.length === 0) return;

		const currentModel = ctx.model;
		const requiresReasoning = currentModel.reasoning;
		const requiresImage = currentModel.input.includes("image");

		// availableModels is already sorted by cost.output ascending
		for (const candidate of ctx.availableModels) {
			// Skip the current model
			if (candidate.id === currentModel.id) continue;

			// Must be cheaper
			if (candidate.cost.output >= currentModel.cost.output) continue;

			// Check capabilities
			if (requiresReasoning && !candidate.reasoning) continue;
			if (requiresImage && !candidate.input.includes("image")) continue;

			decision.model = candidate;
			reasons.push(
				`model: ${currentModel.id} -> ${candidate.id} (cost ${currentModel.cost.output} -> ${candidate.cost.output}, pressure ${(pressure * 100).toFixed(0)}%)`,
			);
			break;
		}
	}

	/**
	 * Strategy 4: Trigger context compaction when pressure > 50%
	 * AND estimatedInputTokens > 60% of contextWindow.
	 */
	private applyContextCompaction(
		ctx: PolicyContext,
		decision: PolicyDecision,
		reasons: string[],
		pressure: number,
	): void {
		if (pressure <= 0.5) return;

		const activeModel = decision.model ?? ctx.model;
		const threshold = activeModel.contextWindow * 0.6;

		if (ctx.estimatedInputTokens > threshold) {
			decision.shouldCompact = true;
			reasons.push(
				`compact: estimatedInputTokens ${ctx.estimatedInputTokens} > 60% of contextWindow ${activeModel.contextWindow} (pressure ${(pressure * 100).toFixed(0)}%)`,
			);
		}
	}

	/**
	 * Strategy 5: Abort when budget is exhausted (pressure >= 100%).
	 */
	private applyBudgetExhaustion(decision: PolicyDecision, reasons: string[], pressure: number): void {
		decision.abort = true;
		const reason = `budget exhausted: pressure ${(pressure * 100).toFixed(0)}%`;
		reasons.push(reason);
		decision.reason = reason;
	}
}
