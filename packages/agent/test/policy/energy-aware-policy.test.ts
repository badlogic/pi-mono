import type { Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { EnergyAwarePolicy } from "../../src/policy/energy-aware-policy.js";
import type { PolicyContext, PolicyDecision, UsageWithEnergy } from "../../src/policy/types.js";

function createModel(overrides?: Partial<Model<"openai-completions">>): Model<"openai-completions"> {
	return {
		id: "neuralwatt-large",
		name: "Neuralwatt Large",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	};
}

function createCheapModel(overrides?: Partial<Model<"openai-completions">>): Model<"openai-completions"> {
	return {
		id: "neuralwatt-mini",
		name: "Neuralwatt Mini",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32000,
		maxTokens: 2048,
		...overrides,
	};
}

function createMidModel(overrides?: Partial<Model<"openai-completions">>): Model<"openai-completions"> {
	return {
		id: "neuralwatt-mid",
		name: "Neuralwatt Mid",
		api: "openai-completions",
		provider: "neuralwatt",
		baseUrl: "https://api.neuralwatt.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.5, output: 7, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 64000,
		maxTokens: 4096,
		...overrides,
	};
}

function createCtx(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		turnNumber: 1,
		model: createModel(),
		availableModels: [],
		budget: { energy_budget_joules: 10 },
		consumedEnergy: 0,
		consumedTime: 0,
		messageCount: 1,
		estimatedInputTokens: 0,
		...overrides,
	};
}

function createUsage(overrides?: Partial<UsageWithEnergy>): UsageWithEnergy {
	return {
		input: 100,
		output: 50,
		totalTokens: 150,
		cost: { total: 0.003 },
		energy_joules: 1.0,
		energy_kwh: 0.00000028,
		...overrides,
	};
}

describe("EnergyAwarePolicy", () => {
	it("should have name 'energy-aware'", () => {
		const policy = new EnergyAwarePolicy();
		expect(policy.name).toBe("energy-aware");
	});

	// --- Pressure calculation ---

	describe("pressure calculation", () => {
		it("should return empty decision when no budget is set", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ budget: {}, consumedEnergy: 100 });
			const decision = policy.beforeModelCall(ctx);
			expect(decision).toEqual({});
		});

		it("should use energy budget for pressure when available", () => {
			const policy = new EnergyAwarePolicy();
			// 5/10 = 50% pressure -> should trigger token reduction
			const ctx = createCtx({ consumedEnergy: 5, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reason).toBeDefined();
		});

		it("should fall back to time-based pressure when no energy budget", () => {
			const policy = new EnergyAwarePolicy();
			// 5000/10000 = 50% pressure
			const ctx = createCtx({
				budget: { time_budget_ms: 10000 },
				consumedTime: 5000,
				consumedEnergy: 0,
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reason).toBeDefined();
		});

		it("should prefer energy budget over time budget when both are set", () => {
			const policy = new EnergyAwarePolicy();
			// energy: 1/10 = 10% (no intervention), time: 5000/10000 = 50% (intervention)
			const ctx = createCtx({
				budget: { energy_budget_joules: 10, time_budget_ms: 10000 },
				consumedEnergy: 1,
				consumedTime: 5000,
			});
			const decision = policy.beforeModelCall(ctx);
			// Should use energy pressure (10%) -> no intervention
			expect(decision).toEqual({});
		});

		it("should return empty decision when pressure is 0", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 0 });
			const decision = policy.beforeModelCall(ctx);
			expect(decision).toEqual({});
		});

		it("should handle 0 energy budget without crashing", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ budget: { energy_budget_joules: 0 }, consumedEnergy: 5 });
			const decision = policy.beforeModelCall(ctx);
			// 0 budget -> pressure = 0 (guarded by > 0 check)
			expect(decision).toEqual({});
		});

		it("should handle 0 time budget without crashing", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ budget: { time_budget_ms: 0 }, consumedTime: 5000 });
			const decision = policy.beforeModelCall(ctx);
			expect(decision).toEqual({});
		});
	});

	// --- Strategy 1: Reasoning reduction ---

	describe("reasoning reduction", () => {
		it("should not reduce reasoning when pressure <= 30%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 3, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reasoning).toBeUndefined();
		});

		it("should reduce reasoning to medium when pressure > 30% on a reasoning model", () => {
			const policy = new EnergyAwarePolicy();
			// 3.5/10 = 35% pressure -> medium (> 30% threshold)
			const ctx = createCtx({ consumedEnergy: 3.5, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reasoning).toBe("medium");
			expect(decision.reason).toContain("reasoning");
		});

		it("should reduce reasoning to low when pressure > 60%", () => {
			const policy = new EnergyAwarePolicy();
			// 6.5/10 = 65%
			const ctx = createCtx({ consumedEnergy: 6.5, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reasoning).toBe("low");
		});

		it("should reduce reasoning to minimal when pressure > 80%", () => {
			const policy = new EnergyAwarePolicy();
			// 8.5/10 = 85%
			const ctx = createCtx({ consumedEnergy: 8.5, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reasoning).toBe("minimal");
			expect(decision.reason).toContain("reasoning:");
		});

		it("should not reduce reasoning on non-reasoning model", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 8.5,
				budget: { energy_budget_joules: 10 },
				model: createModel({ reasoning: false }),
			});
			const decision = policy.beforeModelCall(ctx);
			// reasoning should not be in the decision since model doesn't support it
			expect(decision.reasoning).toBeUndefined();
			// reason should not mention reasoning
			if (decision.reason) {
				expect(decision.reason).not.toContain("reasoning:");
			}
		});
	});

	// --- Strategy 2: Token reduction ---

	describe("token reduction", () => {
		it("should not reduce tokens when pressure <= 50%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 5, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.maxTokens).toBeUndefined();
		});

		it("should reduce tokens when pressure > 50%", () => {
			const policy = new EnergyAwarePolicy();
			// 6/10 = 60%
			const ctx = createCtx({ consumedEnergy: 6, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.maxTokens).toBeDefined();
			expect(decision.maxTokens!).toBeLessThan(4096);
			expect(decision.reason).toContain("maxTokens");
		});

		it("should scale token reduction linearly with pressure", () => {
			const policy = new EnergyAwarePolicy();

			// 60% pressure -> 8% reduction
			const ctx60 = createCtx({ consumedEnergy: 6, budget: { energy_budget_joules: 10 } });
			const d60 = policy.beforeModelCall(ctx60);

			// 80% pressure -> 24% reduction
			const ctx80 = createCtx({ consumedEnergy: 8, budget: { energy_budget_joules: 10 } });
			const d80 = policy.beforeModelCall(ctx80);

			expect(d60.maxTokens!).toBeGreaterThan(d80.maxTokens!);
		});

		it("should cap token reduction at 40%", () => {
			const policy = new EnergyAwarePolicy();
			// 99% pressure (just under abort): factor = min(0.4, ((0.99-0.5)/0.5)*0.4) = 0.392
			const ctx = createCtx({ consumedEnergy: 9.9, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			const expectedFactor = Math.min(0.4, ((0.99 - 0.5) / 0.5) * 0.4);
			expect(decision.maxTokens).toBe(Math.floor(4096 * (1 - expectedFactor)));
			// Verify the factor is close to the cap but doesn't exceed it
			expect(expectedFactor).toBeLessThanOrEqual(0.4);
			expect(expectedFactor).toBeGreaterThan(0.38);
		});
	});

	// --- Strategy 3: Model routing ---

	describe("model routing", () => {
		it("should not route when pressure <= 70%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 7,
				budget: { energy_budget_joules: 10 },
				availableModels: [createCheapModel(), createModel()],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeUndefined();
		});

		it("should route to cheaper model when pressure > 70%", () => {
			const policy = new EnergyAwarePolicy();
			// 7.5/10 = 75%
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap, createModel()],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeDefined();
			expect(decision.model!.id).toBe("neuralwatt-mini");
			expect(decision.reason).toContain("model:");
		});

		it("should skip candidates that lack reasoning capability", () => {
			const policy = new EnergyAwarePolicy();
			// Current model requires reasoning
			const cheapNoReasoning = createCheapModel({ reasoning: false });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheapNoReasoning],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeUndefined();
		});

		it("should skip candidates that lack image capability", () => {
			const policy = new EnergyAwarePolicy();
			// Current model requires image
			const cheapNoImage = createCheapModel({ reasoning: true, input: ["text"] });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheapNoImage],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeUndefined();
		});

		it("should not route to a model with same or higher cost", () => {
			const policy = new EnergyAwarePolicy();
			const expensiveModel = createModel({
				id: "expensive",
				cost: { input: 5, output: 20, cacheRead: 0, cacheWrite: 0 },
			});
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [expensiveModel],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeUndefined();
		});

		it("should skip the current model in available models", () => {
			const policy = new EnergyAwarePolicy();
			const currentModel = createModel();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [currentModel],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeUndefined();
		});

		it("should pick the first (cheapest) suitable candidate", () => {
			const policy = new EnergyAwarePolicy();
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			const mid = createMidModel();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap, mid, createModel()],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model!.id).toBe("neuralwatt-mini");
		});

		it("should not route when availableModels is empty", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeUndefined();
		});

		it("should not require reasoning from non-reasoning model", () => {
			const policy = new EnergyAwarePolicy();
			const nonReasoningModel = createModel({ reasoning: false, input: ["text"] });
			const cheap = createCheapModel({ reasoning: false, input: ["text"] });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				model: nonReasoningModel,
				availableModels: [cheap],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model!.id).toBe("neuralwatt-mini");
		});
	});

	// --- Strategy 4: Context compaction ---

	describe("context compaction", () => {
		it("should not compact when pressure <= 50%", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 5,
				budget: { energy_budget_joules: 10 },
				estimatedInputTokens: 100000, // > 60% of 128000
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.shouldCompact).toBeUndefined();
		});

		it("should not compact when tokens are below 60% of context window", () => {
			const policy = new EnergyAwarePolicy();
			// 60% pressure but tokens are low
			const ctx = createCtx({
				consumedEnergy: 6,
				budget: { energy_budget_joules: 10 },
				estimatedInputTokens: 50000, // < 60% of 128000 (76800)
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.shouldCompact).toBeUndefined();
		});

		it("should compact when pressure > 50% AND tokens > 60% of context window", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 6,
				budget: { energy_budget_joules: 10 },
				estimatedInputTokens: 80000, // > 60% of 128000 (76800)
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.shouldCompact).toBe(true);
			expect(decision.reason).toContain("compact");
		});

		it("should use routed model's context window for compaction check", () => {
			const policy = new EnergyAwarePolicy();
			// Route to cheap model with 32000 context window
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap],
				estimatedInputTokens: 20000, // > 60% of 32000 (19200) but < 60% of 128000
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model!.id).toBe("neuralwatt-mini");
			expect(decision.shouldCompact).toBe(true);
		});
	});

	// --- Strategy 5: Budget exhaustion ---

	describe("budget exhaustion", () => {
		it("should abort at exactly 100% pressure", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 10,
				budget: { energy_budget_joules: 10 },
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
			expect(decision.reason).toContain("budget exhausted");
		});

		it("should abort when over 100% pressure", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 15,
				budget: { energy_budget_joules: 10 },
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
			expect(decision.reason).toContain("budget exhausted");
			expect(decision.reason).toContain("150%");
		});

		it("should not set other strategies when aborting", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 10,
				budget: { energy_budget_joules: 10 },
				availableModels: [createCheapModel()],
				estimatedInputTokens: 100000,
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
			expect(decision.model).toBeUndefined();
			expect(decision.maxTokens).toBeUndefined();
			expect(decision.shouldCompact).toBeUndefined();
		});

		it("should abort with time budget too", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				budget: { time_budget_ms: 10000 },
				consumedTime: 10000,
				consumedEnergy: 0,
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
		});
	});

	// --- Reason strings ---

	describe("reason strings", () => {
		it("should include reason on every non-empty decision", () => {
			const policy = new EnergyAwarePolicy();

			// Pressure at 55% -> reasoning + token reduction
			const ctx = createCtx({
				consumedEnergy: 5.5,
				budget: { energy_budget_joules: 10 },
			});
			const decision = policy.beforeModelCall(ctx);
			// At 55%, token reduction should fire -> reason present
			expect(decision.reason).toBeDefined();
			expect(decision.reason!.length).toBeGreaterThan(0);
		});

		it("should have no reason when decision is empty", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 0 });
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reason).toBeUndefined();
		});

		it("should combine multiple strategy reasons with semicolons", () => {
			const policy = new EnergyAwarePolicy();
			// 75% pressure -> reasoning + tokens + model routing
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap],
				estimatedInputTokens: 80000,
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.reason).toContain(";");
		});
	});

	// --- Graceful degradation ---

	describe("graceful degradation", () => {
		it("should return empty decision when energy data is missing (no budget)", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ budget: {} });
			const decision = policy.beforeModelCall(ctx);
			expect(decision).toEqual({});
		});

		it("should handle undefined energy in usage without crashing", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx();
			const usage = createUsage({ energy_joules: undefined, energy_kwh: undefined });
			expect(() => policy.afterModelCall(ctx, usage)).not.toThrow();
			expect(policy.log).toHaveLength(1);
		});

		it("should handle missing availableModels gracefully at high pressure", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 8,
				budget: { energy_budget_joules: 10 },
				availableModels: [],
			});
			const decision = policy.beforeModelCall(ctx);
			// Should still apply other strategies, just not model routing
			expect(decision.model).toBeUndefined();
			expect(decision.reason).toBeDefined();
		});
	});

	// --- Strategy ordering ---

	describe("strategy ordering", () => {
		it("should apply reasoning before model routing", () => {
			const policy = new EnergyAwarePolicy();
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			// 75% pressure
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap],
			});
			const decision = policy.beforeModelCall(ctx);
			// Both reasoning and model routing should fire
			expect(decision.reasoning).toBeDefined();
			expect(decision.model).toBeDefined();
			// Reasoning appears first in reason string
			const reasonParts = decision.reason!.split(";");
			const reasoningIdx = reasonParts.findIndex((p) => p.includes("reasoning:"));
			const modelIdx = reasonParts.findIndex((p) => p.includes("model:"));
			expect(reasoningIdx).toBeLessThan(modelIdx);
		});

		it("should apply token reduction before model routing", () => {
			const policy = new EnergyAwarePolicy();
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			// 75% pressure
			const ctx = createCtx({
				consumedEnergy: 7.5,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.maxTokens).toBeDefined();
			expect(decision.model).toBeDefined();
			const reasonParts = decision.reason!.split(";");
			const tokenIdx = reasonParts.findIndex((p) => p.includes("maxTokens:"));
			const modelIdx = reasonParts.findIndex((p) => p.includes("model:"));
			expect(tokenIdx).toBeLessThan(modelIdx);
		});
	});

	// --- afterModelCall / telemetry logging ---

	describe("afterModelCall", () => {
		it("should log telemetry entries", () => {
			const policy = new EnergyAwarePolicy();
			policy.afterModelCall(createCtx(), createUsage());
			expect(policy.log).toHaveLength(1);
			expect(policy.log[0].usage.energy_joules).toBe(1.0);
		});

		it("should accumulate multiple entries", () => {
			const policy = new EnergyAwarePolicy();
			for (let i = 0; i < 5; i++) {
				policy.afterModelCall(createCtx({ turnNumber: i + 1 }), createUsage({ energy_joules: i + 1 }));
			}
			expect(policy.log).toHaveLength(5);
			expect(policy.log[4].usage.energy_joules).toBe(5);
			expect(policy.log[4].ctx.turnNumber).toBe(5);
		});
	});

	// --- Integration: progressive escalation ---

	describe("integration: progressive escalation", () => {
		it("should escalate strategies as energy accumulates", () => {
			const policy = new EnergyAwarePolicy();
			const budget = { energy_budget_joules: 10 };
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			const availableModels = [cheap, createModel()];

			const decisions: PolicyDecision[] = [];

			// Turn 1: 10% pressure -> no intervention
			const d1 = policy.beforeModelCall(createCtx({ consumedEnergy: 1, budget, availableModels, turnNumber: 1 }));
			decisions.push(d1);
			policy.afterModelCall(
				createCtx({ consumedEnergy: 1, budget, turnNumber: 1 }),
				createUsage({ energy_joules: 1 }),
			);

			// Turn 2: 35% pressure -> reasoning reduction starts
			const d2 = policy.beforeModelCall(createCtx({ consumedEnergy: 3.5, budget, availableModels, turnNumber: 2 }));
			decisions.push(d2);
			policy.afterModelCall(
				createCtx({ consumedEnergy: 3.5, budget, turnNumber: 2 }),
				createUsage({ energy_joules: 2.5 }),
			);

			// Turn 3: 55% pressure -> token reduction kicks in
			const d3 = policy.beforeModelCall(createCtx({ consumedEnergy: 5.5, budget, availableModels, turnNumber: 3 }));
			decisions.push(d3);
			policy.afterModelCall(
				createCtx({ consumedEnergy: 5.5, budget, turnNumber: 3 }),
				createUsage({ energy_joules: 2 }),
			);

			// Turn 4: 75% pressure -> model routing kicks in
			const d4 = policy.beforeModelCall(createCtx({ consumedEnergy: 7.5, budget, availableModels, turnNumber: 4 }));
			decisions.push(d4);
			policy.afterModelCall(
				createCtx({ consumedEnergy: 7.5, budget, turnNumber: 4 }),
				createUsage({ energy_joules: 2 }),
			);

			// Turn 5: 100% pressure -> abort
			const d5 = policy.beforeModelCall(createCtx({ consumedEnergy: 10, budget, availableModels, turnNumber: 5 }));
			decisions.push(d5);

			// Verify escalation
			expect(d1).toEqual({}); // no intervention
			expect(d2.reason).toBeDefined(); // reasoning mentioned (even if no change at 35%)
			expect(d3.maxTokens).toBeDefined(); // token reduction
			expect(d4.model).toBeDefined(); // model routing
			expect(d4.model!.id).toBe("neuralwatt-mini");
			expect(d5.abort).toBe(true); // budget exhausted

			// Verify telemetry was accumulated
			expect(policy.log).toHaveLength(4);
		});
	});

	// --- Edge cases ---

	describe("edge cases", () => {
		it("should handle exactly at 30% threshold (no intervention)", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({ consumedEnergy: 3, budget: { energy_budget_joules: 10 } });
			const decision = policy.beforeModelCall(ctx);
			// 30% is at the boundary (<=30% means no reasoning reduction)
			expect(decision).toEqual({});
		});

		it("should handle exactly at 50% threshold (no token reduction)", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 5,
				budget: { energy_budget_joules: 10 },
				model: createModel({ reasoning: false }),
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.maxTokens).toBeUndefined();
		});

		it("should handle exactly at 70% threshold (no model routing)", () => {
			const policy = new EnergyAwarePolicy();
			const cheap = createCheapModel({ reasoning: true, input: ["text", "image"] });
			const ctx = createCtx({
				consumedEnergy: 7,
				budget: { energy_budget_joules: 10 },
				availableModels: [cheap],
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.model).toBeUndefined();
		});

		it("should handle very small budget", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 0.001,
				budget: { energy_budget_joules: 0.001 },
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
		});

		it("should handle very large consumed energy", () => {
			const policy = new EnergyAwarePolicy();
			const ctx = createCtx({
				consumedEnergy: 1000000,
				budget: { energy_budget_joules: 10 },
			});
			const decision = policy.beforeModelCall(ctx);
			expect(decision.abort).toBe(true);
		});
	});
});
