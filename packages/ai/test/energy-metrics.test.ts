import { describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.js";
import type { EnergyUsage } from "../src/types.js";

vi.mock("openai", () => {
	let usagePayload: Record<string, unknown> = {};

	class FakeOpenAI {
		chat = {
			completions: {
				create: async () => {
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								choices: [{ delta: { content: "Hello" }, finish_reason: null }],
							};
							yield {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: usagePayload,
							};
						},
					};
				},
			},
		};

		static _setUsagePayload(payload: Record<string, unknown>) {
			usagePayload = payload;
		}
	}

	return { default: FakeOpenAI, _setUsagePayload: FakeOpenAI._setUsagePayload };
});

async function getOpenAIMock() {
	const mod = await import("openai");
	return mod as unknown as { _setUsagePayload: (payload: Record<string, unknown>) => void };
}

describe("energy metrics parsing", () => {
	it("should parse energy_joules and energy_kwh from usage", async () => {
		const mock = await getOpenAIMock();
		mock._setUsagePayload({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
			energy_joules: 0.42,
			energy_kwh: 0.000000116667,
			duration_seconds: 1.5,
		});

		const { complete } = await import("../src/stream.js");
		const model = getModel("neuralwatt", "openai/gpt-oss-20b");
		const response = await complete(
			model,
			{
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			{ apiKey: "test-key" },
		);

		expect(response.energy).toBeDefined();
		const energy = response.energy as EnergyUsage;
		expect(energy.energy_joules).toBe(0.42);
		expect(energy.energy_kwh).toBe(0.000000116667);
		expect(energy.duration_seconds).toBe(1.5);
	});

	it("should compute energy_kwh from energy_joules when energy_kwh is missing", async () => {
		const mock = await getOpenAIMock();
		mock._setUsagePayload({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
			energy_joules: 3600,
		});

		const { complete } = await import("../src/stream.js");
		const model = getModel("neuralwatt", "openai/gpt-oss-20b");
		const response = await complete(
			model,
			{
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			{ apiKey: "test-key" },
		);

		expect(response.energy).toBeDefined();
		const energy = response.energy as EnergyUsage;
		expect(energy.energy_joules).toBe(3600);
		expect(energy.energy_kwh).toBeCloseTo(0.001, 6);
		expect(energy.duration_seconds).toBe(0);
	});

	it("should compute energy_joules from energy_kwh when energy_joules is missing", async () => {
		const mock = await getOpenAIMock();
		mock._setUsagePayload({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
			energy_kwh: 0.001,
		});

		const { complete } = await import("../src/stream.js");
		const model = getModel("neuralwatt", "openai/gpt-oss-20b");
		const response = await complete(
			model,
			{
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			{ apiKey: "test-key" },
		);

		expect(response.energy).toBeDefined();
		const energy = response.energy as EnergyUsage;
		expect(energy.energy_joules).toBe(3600);
		expect(energy.energy_kwh).toBe(0.001);
		expect(energy.duration_seconds).toBe(0);
	});

	it("should not set energy when no energy fields in usage", async () => {
		const mock = await getOpenAIMock();
		mock._setUsagePayload({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
		});

		const { complete } = await import("../src/stream.js");
		const model = getModel("neuralwatt", "openai/gpt-oss-20b");
		const response = await complete(
			model,
			{
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			{ apiKey: "test-key" },
		);

		expect(response.energy).toBeUndefined();
	});

	it("should ignore non-numeric energy fields", async () => {
		const mock = await getOpenAIMock();
		mock._setUsagePayload({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
			energy_joules: "not-a-number",
			energy_kwh: null,
		});

		const { complete } = await import("../src/stream.js");
		const model = getModel("neuralwatt", "openai/gpt-oss-20b");
		const response = await complete(
			model,
			{
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			{ apiKey: "test-key" },
		);

		expect(response.energy).toBeUndefined();
	});

	it("should work with non-neuralwatt providers (energy-agnostic)", async () => {
		const mock = await getOpenAIMock();
		mock._setUsagePayload({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
		});

		const { complete } = await import("../src/stream.js");
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
		const model = { ...baseModel, api: "openai-completions" as const };
		const response = await complete(
			model,
			{
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			{ apiKey: "test-key" },
		);

		expect(response.energy).toBeUndefined();
		expect(response.usage.input).toBe(10);
		expect(response.usage.output).toBe(5);
	});

	it("should parse energy from any openai-completions provider if fields present", async () => {
		const mock = await getOpenAIMock();
		mock._setUsagePayload({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
			energy_joules: 1.23,
			energy_kwh: 0.000000341667,
			duration_seconds: 0.8,
		});

		const { complete } = await import("../src/stream.js");
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
		const model = { ...baseModel, api: "openai-completions" as const };
		const response = await complete(
			model,
			{
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			{ apiKey: "test-key" },
		);

		expect(response.energy).toBeDefined();
		expect(response.energy!.energy_joules).toBe(1.23);
	});
});
