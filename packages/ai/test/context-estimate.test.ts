import { describe, expect, it, vi } from "vitest";
import { streamSimple as streamAnthropicSimple } from "../src/api/anthropic-messages.ts";
import {
	buildBaseOptions,
	clampMaxTokensToContext,
	contextOutputBudgetFailure,
	contextOutputBudgetFailureStream,
	MIN_ANSWER_TOKENS,
	resolveContextOutputBudget,
} from "../src/api/simple-options.ts";
import type { AssistantMessage, Model, Usage } from "../src/types.ts";
import { estimateContextTokens } from "../src/utils/estimate.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

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

function createAssistant(timestamp: number, totalTokens: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "kept" }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

const model: Model<"openai-responses"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 8_000,
};

describe("context token estimation", () => {
	// Regression for #10497: large new inputs need more room than chars/4 allows.
	it("reserves 3.5 characters per token for new text when limiting output", () => {
		const context = normalizeContext({
			messages: [createAssistant(100, 2_000), { role: "user", content: "x".repeat(3_500), timestamp: 200 }],
		});

		expect(estimateContextTokens(context)).toEqual({
			tokens: 3_000,
			usageTokens: 2_000,
			trailingTokens: 1_000,
			lastUsageIndex: 0,
		});
		expect(buildBaseOptions(model, context).maxTokens).toBe(2_904);
	});

	it("ignores stale assistant usage after a newer message is inserted before it", () => {
		const context = normalizeContext({
			systemPrompt: "system",
			messages: [
				{ role: "user", content: "summary", timestamp: 200 },
				createAssistant(100, 9_500),
				{ role: "user", content: "x".repeat(4_000), timestamp: 300 },
			],
		});

		expect(estimateContextTokens(context)).toEqual({
			tokens: 1_149,
			usageTokens: 0,
			trailingTokens: 1_149,
			lastUsageIndex: null,
		});
		expect(buildBaseOptions(model, context).maxTokens).toBe(4_755);
	});

	it("uses assistant usage again after a response to the inserted context", () => {
		const context = normalizeContext({
			messages: [
				{ role: "user", content: "summary", timestamp: 200 },
				createAssistant(100, 9_500),
				{ role: "user", content: "new prompt", timestamp: 300 },
				createAssistant(400, 2_000),
				{ role: "user", content: "tail", timestamp: 500 },
			],
		});

		expect(estimateContextTokens(context)).toEqual({
			tokens: 2_002,
			usageTokens: 2_000,
			trailingTokens: 2,
			lastUsageIndex: 3,
		});
	});
});

function createBudgetAssistant(model: Model<any>, timestamp: number, totalTokens: number): AssistantMessage {
	return {
		...createAssistant(timestamp, totalTokens),
		api: model.api,
		provider: model.provider,
		model: model.id,
	};
}

const opusAliasModel: Model<"anthropic-messages"> = {
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
};

function sseResponse(events: Array<{ event: string; data: unknown }>): Response {
	const body = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`).join("\n");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function textSse(modelId: string, text: string, usage: { input: number; output: number }): Response {
	return sseResponse([
		{
			event: "message_start",
			data: {
				type: "message_start",
				message: {
					id: "msg_test",
					model: modelId,
					usage: {
						input_tokens: usage.input,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
		},
		{
			event: "content_block_start",
			data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		},
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		},
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
		{
			event: "message_delta",
			data: {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { input_tokens: usage.input, output_tokens: usage.output },
			},
		},
		{ event: "message_stop", data: { type: "message_stop" } },
	]);
}

function createFetchRecorder(response: () => Response) {
	const requests: Array<Record<string, unknown>> = [];
	const fetch = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
		requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
		return response();
	});
	return { fetch, requests };
}

describe("context output budget", () => {
	it("reports the unfloored response room instead of a one-token cap", () => {
		const context = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 476_791),
				{ role: "user", content: "tool result follows", timestamp: 200 },
			],
		});

		const budget = resolveContextOutputBudget(opusAliasModel, context);
		expect(budget.estimatedContextTokens).toBeGreaterThan(476_791);
		expect(budget.availableResponseTokens).toBeLessThan(0);
		// The clamp still floors at one for direct callers; the budget exposes the real deficit.
		expect(clampMaxTokensToContext(opusAliasModel, context, opusAliasModel.maxTokens)).toBe(1);
	});

	it("fails over-window requests with a recognizable context-overflow reason", () => {
		const context = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 476_791),
				{ role: "user", content: "tool result follows", timestamp: 200 },
			],
		});

		const failure = contextOutputBudgetFailure(opusAliasModel, context);
		expect(failure).toBeDefined();
		expect(failure).toContain(opusAliasModel.id);
		expect(
			isContextOverflow({
				role: "assistant",
				content: [],
				api: opusAliasModel.api,
				provider: opusAliasModel.provider,
				model: opusAliasModel.id,
				usage: createUsage(0),
				stopReason: "error",
				errorMessage: failure,
				timestamp: 300,
			}),
		).toBe(true);
	});

	it("keeps ordinary requests and small output caps unchanged", () => {
		const healthy = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 200_000),
				{ role: "user", content: "hi", timestamp: 200 },
			],
		});
		expect(contextOutputBudgetFailure(opusAliasModel, healthy)).toBeUndefined();
		expect(buildBaseOptions(opusAliasModel, healthy).maxTokens).toBe(128_000);

		const smallCapModel: Model<"anthropic-messages"> = { ...opusAliasModel, maxTokens: 512 };
		const smallCapRoom = normalizeContext({
			messages: [
				createBudgetAssistant(smallCapModel, 100, 200_000),
				{ role: "user", content: "hi", timestamp: 200 },
			],
		});
		expect(resolveContextOutputBudget(smallCapModel, smallCapRoom).availableResponseTokens).toBeGreaterThan(512);
		expect(contextOutputBudgetFailure(smallCapModel, smallCapRoom)).toBeUndefined();

		// A small cap still fails when the context cannot even reserve that cap.
		const smallCapTight = normalizeContext({
			messages: [
				createBudgetAssistant(smallCapModel, 100, 396_000),
				{ role: "user", content: "hi", timestamp: 200 },
			],
		});
		expect(resolveContextOutputBudget(smallCapModel, smallCapTight).availableResponseTokens).toBeLessThan(512);
		expect(contextOutputBudgetFailure(smallCapModel, smallCapTight)).toBeDefined();

		// An unknown window keeps the existing unlimited behavior.
		const unknownWindow: Model<"anthropic-messages"> = { ...opusAliasModel, contextWindow: 0 };
		expect(contextOutputBudgetFailure(unknownWindow, smallCapTight)).toBeUndefined();
		expect(resolveContextOutputBudget(unknownWindow, smallCapTight).availableResponseTokens).toBe(
			Number.POSITIVE_INFINITY,
		);
	});

	it("protects a switch to a smaller configured context window", () => {
		const switched = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 285_770),
				{ role: "user", content: "review the plan", timestamp: 200 },
			],
		});

		expect(contextOutputBudgetFailure(opusAliasModel, switched)).toBeUndefined();

		const smaller: Model<"anthropic-messages"> = {
			...opusAliasModel,
			id: "claude-opus-5-5-small",
			contextWindow: 288_000,
		};
		expect(contextOutputBudgetFailure(smaller, switched)).toBeDefined();
	});

	it("returns a pre-failed stream without touching the provider", async () => {
		const context = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 476_791),
				{ role: "user", content: "tool result follows", timestamp: 200 },
			],
		});
		const { fetch, requests } = createFetchRecorder(() =>
			textSse(opusAliasModel.id, "unused", { input: 1, output: 1 }),
		);

		const guarded = contextOutputBudgetFailureStream(opusAliasModel, context);
		expect(guarded).toBeDefined();
		const message = await guarded!.result();
		expect(message.stopReason).toBe("error");
		expect(isContextOverflow(message)).toBe(true);

		const result = await streamAnthropicSimple(opusAliasModel, context, { apiKey: "test-key", fetch }).result();
		expect(result.stopReason).toBe("error");
		expect(isContextOverflow(result)).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
		expect(requests).toHaveLength(0);
	});

	it("sends ordinary requests with their existing cap and reasoning configuration", async () => {
		const context = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 200_000),
				{ role: "user", content: "hi", timestamp: 200 },
			],
		});
		const { fetch, requests } = createFetchRecorder(() =>
			textSse(opusAliasModel.id, "hello", { input: 200_000, output: 5 }),
		);

		const result = await streamAnthropicSimple(opusAliasModel, context, {
			apiKey: "test-key",
			fetch,
			reasoning: "high",
		}).result();

		expect(result.stopReason).toBe("stop");
		expect(fetch).toHaveBeenCalledTimes(1);
		const body = requests[0] as { max_tokens: number; thinking?: { type: string; budget_tokens?: number } };
		expect(body.max_tokens).toBe(128_000);
		expect(body.thinking).toMatchObject({ type: "enabled" });
		expect(body.max_tokens - (body.thinking?.budget_tokens ?? 0)).toBeGreaterThanOrEqual(MIN_ANSWER_TOKENS);
	});

	it("keeps useful answer room under a clamped thinking budget or fails safely", async () => {
		const tightContext = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 388_000),
				{ role: "user", content: "hi", timestamp: 200 },
			],
		});
		const { fetch, requests } = createFetchRecorder(() =>
			textSse(opusAliasModel.id, "hello", { input: 388_000, output: 5 }),
		);

		const result = await streamAnthropicSimple(opusAliasModel, tightContext, {
			apiKey: "test-key",
			fetch,
			reasoning: "xhigh",
		}).result();

		expect(result.stopReason).toBe("stop");
		const body = requests[0] as { max_tokens: number; thinking?: { type: string; budget_tokens?: number } };
		expect(body.max_tokens).toBeLessThan(opusAliasModel.maxTokens);
		expect(body.max_tokens - (body.thinking?.budget_tokens ?? 0)).toBeGreaterThanOrEqual(MIN_ANSWER_TOKENS);

		const overContext = normalizeContext({
			messages: [
				createBudgetAssistant(opusAliasModel, 100, 397_000),
				{ role: "user", content: "hi", timestamp: 200 },
			],
		});
		const overFetch = createFetchRecorder(() => textSse(opusAliasModel.id, "unused", { input: 1, output: 1 }));
		const overResult = await streamAnthropicSimple(opusAliasModel, overContext, {
			apiKey: "test-key",
			fetch: overFetch.fetch,
			reasoning: "xhigh",
		}).result();
		expect(overResult.stopReason).toBe("error");
		expect(isContextOverflow(overResult)).toBe(true);
		expect(overFetch.fetch).not.toHaveBeenCalled();
	});
});
