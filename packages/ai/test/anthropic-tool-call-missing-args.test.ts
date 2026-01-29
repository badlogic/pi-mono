import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, Model, ToolCall } from "../src/types.js";

/**
 * Test that anthropic provider defaults undefined tool arguments to empty object.
 * This prevents API errors when replaying history with incomplete tool calls
 * (e.g., from aborted streams where input_json_delta never arrived).
 */

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
	return {
		default: vi.fn().mockImplementation(() => ({
			messages: {
				stream: vi.fn().mockImplementation(() => {
					const events = [
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
								id: "tool_123",
								name: "get_status",
								input: {}, // Empty input simulates missing args
							},
						},
						{
							type: "content_block_stop",
							index: 0,
						},
						{
							type: "message_delta",
							delta: { stop_reason: "tool_use" },
							usage: { input_tokens: 10, output_tokens: 5 },
						},
					];

					return {
						[Symbol.asyncIterator]: async function* () {
							for (const event of events) {
								yield event;
							}
						},
					};
				}),
			},
		})),
	};
});

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("anthropic provider tool call missing args", () => {
	it("defaults arguments to empty object when undefined in history replay", async () => {
		// Import after mocking
		const { streamAnthropic } = await import("../src/providers/anthropic.js");

		const model: Model<"anthropic-messages"> = {
			id: "claude-sonnet-4-20250514",
			name: "Claude Sonnet 4",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 8192,
		};

		// Simulate history with a tool call that has undefined arguments
		// (as would happen from an aborted stream)
		const historyWithUndefinedArgs: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "prev_tool_123",
					name: "get_status",
					arguments: undefined as unknown as Record<string, unknown>, // Simulate undefined from aborted stream
				},
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		};

		const context: Context = {
			messages: [
				{ role: "user", content: "Check status", timestamp: Date.now() },
				historyWithUndefinedArgs,
				{
					role: "toolResult",
					toolCallId: "prev_tool_123",
					toolName: "get_status",
					content: [{ type: "text", text: "Status OK" }],
					isError: false,
					timestamp: Date.now(),
				},
				{ role: "user", content: "Check again", timestamp: Date.now() },
			],
			tools: [
				{
					name: "get_status",
					description: "Get current status",
					parameters: Type.Object({}),
				},
			],
		};

		// This should not throw - the fix ensures undefined arguments become {}
		const stream = streamAnthropic(model, context, {
			apiKey: "test-key",
		});

		for await (const _ of stream) {
			// consume stream
		}

		const result = await stream.result();

		expect(result.stopReason).toBe("toolUse");
		expect(result.content).toHaveLength(1);

		const toolCall = result.content[0] as ToolCall;
		expect(toolCall.type).toBe("toolCall");
		expect(toolCall.name).toBe("get_status");
		// The new tool call should have valid arguments
		expect(toolCall.arguments).toEqual({});
	});
});
