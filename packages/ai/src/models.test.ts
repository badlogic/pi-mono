import { describe, it, expect } from "vitest";
import { calculateCost } from "./models.js";
import type { Api, Model, Usage } from "./types.js";

function makeUsage(input: number, output: number, cacheRead: number, cacheWrite: number): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function makeModel(costPerMillion: { input: number; output: number; cacheRead: number; cacheWrite: number }): Model<Api> {
	return {
		cost: costPerMillion,
	} as Model<Api>;
}

describe("calculateCost", () => {
	// gemini-3-flash-preview pricing: input=$0.50, output=$3.00, cacheRead=$0.05, cacheWrite=$0.05 per 1M tokens
	const model = makeModel({ input: 0.50, output: 3.00, cacheRead: 0.05, cacheWrite: 0.05 });

	it("should not double-count cached tokens in input cost", () => {
		// Real-world example: 20212 input tokens, 16298 cached, 931 output
		const usage = makeUsage(20212, 931, 16298, 0);
		const cost = calculateCost(model, usage);

		// Correct calculation:
		// uncached input = 20212 - 16298 = 3914 tokens at $0.50/1M = $0.001957
		// output = 931 tokens at $3.00/1M = $0.002793
		// cache read = 16298 tokens at $0.05/1M = $0.000815
		// total = $0.005565
		const expectedTotal = (3914 * 0.50 + 931 * 3.00 + 16298 * 0.05) / 1_000_000;

		expect(cost.total).toBeCloseTo(expectedTotal, 6);
	});

	it("should charge full input rate only on uncached tokens", () => {
		const usage = makeUsage(100_000, 1_000, 80_000, 0);
		const cost = calculateCost(model, usage);

		// Only 20,000 tokens should be charged at input rate
		const expectedInputCost = (20_000 * 0.50) / 1_000_000;
		expect(cost.input).toBeCloseTo(expectedInputCost, 8);
	});

	it("should be correct with no caching", () => {
		const usage = makeUsage(10_000, 1_000, 0, 0);
		const cost = calculateCost(model, usage);

		const expectedTotal = (10_000 * 0.50 + 1_000 * 3.00) / 1_000_000;
		expect(cost.total).toBeCloseTo(expectedTotal, 8);
	});

	it("should handle cache write tokens", () => {
		const usage = makeUsage(10_000, 1_000, 0, 5_000);
		const cost = calculateCost(model, usage);

		const expectedTotal = (10_000 * 0.50 + 1_000 * 3.00 + 5_000 * 0.05) / 1_000_000;
		expect(cost.total).toBeCloseTo(expectedTotal, 8);
	});
});
