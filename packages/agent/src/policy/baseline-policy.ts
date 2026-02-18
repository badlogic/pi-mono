import type { PolicyContext, PolicyDecision, RuntimePolicy, UsageWithEnergy } from "./types.js";

/**
 * BaselinePolicy: a no-op policy that observes telemetry but never intervenes.
 * Used as a control for benchmarking — ensures the agent behaves identically
 * to running without a policy.
 */
export class BaselinePolicy implements RuntimePolicy {
	readonly name = "baseline";

	private readonly _log: Array<{ ctx: PolicyContext; usage: UsageWithEnergy }> = [];

	beforeModelCall(_ctx: PolicyContext): PolicyDecision {
		return {};
	}

	afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void {
		this._log.push({ ctx: { ...ctx }, usage: { ...usage } });
	}

	/** Returns the accumulated telemetry log (useful for tests and reports). */
	get log(): ReadonlyArray<{ ctx: PolicyContext; usage: UsageWithEnergy }> {
		return this._log;
	}
}
