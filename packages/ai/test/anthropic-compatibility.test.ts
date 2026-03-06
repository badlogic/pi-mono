import { Type } from "@sinclair/typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamAnthropic } from "../src/providers/anthropic.js";
import type { Context, Model, Tool } from "../src/types.js";

const mockState = vi.hoisted(() => ({
	constructorOpts: undefined as Record<string, unknown> | undefined,
	streamParams: undefined as Record<string, unknown> | undefined,
	events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@anthropic-ai/sdk", () => {
	class FakeAnthropic {
		constructor(opts: Record<string, unknown>) {
			mockState.constructorOpts = opts;
		}

		messages = {
			stream: (params: Record<string, unknown>) => {
				mockState.streamParams = params;
				return {
					async *[Symbol.asyncIterator]() {
						for (const event of mockState.events) {
							yield event;
						}
					},
				};
			},
		};
	}

	return { default: FakeAnthropic };
});

function createModel(baseUrl = "https://api.z.ai/api/anthropic"): Model<"anthropic-messages"> {
	return {
		id: "glm-5",
		name: "GLM-5",
		api: "anthropic-messages",
		provider: "zai",
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 32000,
	};
}

const readTool: Tool = {
	name: "read",
	description: "Read a file",
	parameters: Type.Object({
		path: Type.String(),
		limit: Type.Number(),
	}),
};

function createContext(): Context {
	return {
		systemPrompt: "Use the read tool when needed.",
		messages: [{ role: "user", content: "Read the file.", timestamp: Date.now() }],
		tools: [readTool],
	};
}

describe("Anthropic-compatible tool calling", () => {
	beforeEach(() => {
		mockState.constructorOpts = undefined;
		mockState.streamParams = undefined;
		mockState.events = [];
	});

	it("does not enable fine-grained tool streaming by default", async () => {
		mockState.events = [
			{
				type: "message_start",
				message: {
					usage: {
						input_tokens: 10,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: {},
			},
		];

		const s = streamAnthropic(createModel(), createContext(), { apiKey: "test-key" });
		for await (const _event of s) {
			// consume
		}

		const headers = (mockState.constructorOpts?.defaultHeaders as Record<string, string>) ?? {};
		const tools = (mockState.streamParams?.tools as Array<Record<string, unknown>>) ?? [];

		expect(headers["anthropic-beta"] ?? "").not.toContain("fine-grained-tool-streaming-2025-05-14");
		expect(tools).toHaveLength(1);
		expect(tools[0]?.eager_input_streaming).toBe(false);
	});

	it("enables fine-grained tool streaming when explicitly requested", async () => {
		mockState.events = [
			{
				type: "message_start",
				message: {
					usage: {
						input_tokens: 10,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: {},
			},
		];

		const s = streamAnthropic(createModel(), createContext(), {
			apiKey: "test-key",
			anthropicFineGrainedToolStreaming: true,
		});
		for await (const _event of s) {
			// consume
		}

		const headers = (mockState.constructorOpts?.defaultHeaders as Record<string, string>) ?? {};
		const tools = (mockState.streamParams?.tools as Array<Record<string, unknown>>) ?? [];

		expect(headers["anthropic-beta"] ?? "").toContain("fine-grained-tool-streaming-2025-05-14");
		expect(tools).toHaveLength(1);
		expect(tools[0]?.eager_input_streaming).toBe(true);
	});

	it("forwards top_p and omits unsupported penalty controls", async () => {
		mockState.events = [
			{
				type: "message_start",
				message: {
					usage: {
						input_tokens: 10,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: {},
			},
		];

		const s = streamAnthropic(createModel(), createContext(), {
			apiKey: "test-key",
			topP: 0.7,
			presencePenalty: 1.2,
			repetitionPenalty: 1.1,
		});
		for await (const _event of s) {
			// consume
		}

		expect(mockState.streamParams?.top_p).toBe(0.7);
		expect(mockState.streamParams).not.toHaveProperty("presence_penalty");
		expect(mockState.streamParams).not.toHaveProperty("repetition_penalty");
	});

	it("preserves tool input sent at content_block_start when no JSON delta arrives", async () => {
		mockState.events = [
			{
				type: "message_start",
				message: {
					usage: {
						input_tokens: 10,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: {
					type: "tool_use",
					id: "call_1",
					name: "read",
					input: { path: "/tmp/demo.md", limit: 200 },
				},
			},
			{
				type: "content_block_stop",
				index: 0,
			},
			{
				type: "message_delta",
				delta: { stop_reason: "tool_use" },
				usage: { output_tokens: 5 },
			},
		];

		const s = streamAnthropic(createModel(), createContext(), { apiKey: "test-key" });
		for await (const _event of s) {
			// consume
		}

		const result = await s.result();
		const toolCall = result.content.find((block) => block.type === "toolCall");

		expect(result.stopReason).toBe("toolUse");
		expect(toolCall?.type).toBe("toolCall");
		if (toolCall?.type === "toolCall") {
			expect(toolCall.arguments).toEqual({ path: "/tmp/demo.md", limit: 200 });
		}
	});

	it("recovers malformed XML-like tool text into a structured tool call", async () => {
		mockState.events = [
			{
				type: "message_start",
				message: {
					usage: {
						input_tokens: 10,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: {
					type: "text_delta",
					text: 'I found the existing types. <invoke name="read"><parameter name="path">/tmp/demo.md</parameter><parameter name="limit">200</parameter></invoke>',
				},
			},
			{
				type: "content_block_stop",
				index: 0,
			},
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 5 },
			},
		];

		const s = streamAnthropic(createModel(), createContext(), { apiKey: "test-key" });
		for await (const _event of s) {
			// consume
		}

		const result = await s.result();
		const toolCall = result.content.find((block) => block.type === "toolCall");
		const textBlocks = result.content.filter((block) => block.type === "text");

		expect(result.stopReason).toBe("toolUse");
		expect(toolCall?.type).toBe("toolCall");
		if (toolCall?.type === "toolCall") {
			expect(toolCall.name).toBe("read");
			expect(toolCall.arguments).toEqual({ path: "/tmp/demo.md", limit: 200 });
		}
		expect(textBlocks.map((block) => block.text).join("\n")).not.toContain("<invoke");
	});
});
