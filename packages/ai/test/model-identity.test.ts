import { describe, expect, it } from "vitest";
import type { AssistantMessage, Model, Usage } from "../src/types.ts";
import { isResponseFromModel } from "../src/utils/model-identity.ts";

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createMessage(options: { provider?: string; model?: string; responseModel?: string }): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: options.provider ?? "instacart-anthropic",
		model: options.model ?? "claude-opus-5-5@default",
		usage: createUsage(100),
		stopReason: "length",
		timestamp: 1,
		...(options.responseModel === undefined ? {} : { responseModel: options.responseModel }),
	};
}

const selected: Model<"anthropic-messages"> = {
	id: "claude-opus-5-5@default",
	name: "Claude Opus 5.5",
	api: "anthropic-messages",
	provider: "instacart-anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400_000,
	maxTokens: 128_000,
	responseModelAliases: ["claude-opus-5-5"],
};

describe("isResponseFromModel", () => {
	it("accepts the selected model and its declared response aliases", () => {
		expect(isResponseFromModel(selected, createMessage({}))).toBe(true);
		// The provider reports the gateway's canonical id instead of the configured id.
		expect(isResponseFromModel(selected, createMessage({ responseModel: "claude-opus-5-5" }))).toBe(true);
		// Providers that report the concrete model on `model` keep the same trust rule.
		expect(isResponseFromModel(selected, createMessage({ model: "claude-opus-5-5" }))).toBe(true);
	});

	it("rejects a genuine fallback model even when its name resembles the selection", () => {
		expect(isResponseFromModel(selected, createMessage({ responseModel: "claude-sonnet-4-6" }))).toBe(false);
		expect(isResponseFromModel(selected, createMessage({ model: "claude-opus-5-5-preview" }))).toBe(false);
	});

	it("rejects another provider and a mid-run model switch", () => {
		expect(isResponseFromModel(selected, createMessage({ provider: "anthropic" }))).toBe(false);
		expect(isResponseFromModel(selected, createMessage({ model: "claude-sonnet-4-6" }))).toBe(false);
	});

	it("trusts only the exact id when no aliases are declared", () => {
		const strict: Model<"anthropic-messages"> = { ...selected, responseModelAliases: undefined };
		expect(isResponseFromModel(strict, createMessage({ responseModel: "claude-opus-5-5" }))).toBe(false);
		expect(isResponseFromModel(strict, createMessage({}))).toBe(true);
	});
});
