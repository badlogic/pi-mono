import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "../src/types.js";

// Mock model for testing
const mockAnthropicModel: Model<"anthropic"> = {
	provider: "anthropic",
	api: "anthropic",
	id: "claude-3-5-sonnet-20241022",
	maxInputTokens: 200000,
	maxOutputTokens: 8192,
};

describe("transformMessages - tool result orphaning fix", () => {
	it("filters tool results when assistant message is skipped due to error", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Call a tool" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				provider: "anthropic",
				api: "anthropic",
				model: "claude-3-5-sonnet-20241022",
				stopReason: "error",
				content: [
					{ type: "text", text: "Error occurred" },
					{ type: "toolCall", id: "toolu_123", name: "test_tool", arguments: {} } as ToolCall,
				],
				timestamp: Date.now(),
				inputTokens: 100,
				outputTokens: 50,
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_123",
				toolName: "test_tool",
				content: [{ type: "text", text: "Tool result" }],
				timestamp: Date.now(),
			} as ToolResultMessage,
			{
				role: "user",
				content: [{ type: "text", text: "Continue" }],
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, mockAnthropicModel);

		// Should have filtered out both errored assistant and its tool result
		expect(result).toHaveLength(2); // Only the two user messages
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("user");

		// Verify no tool_result messages remain
		for (const msg of result) {
			expect(msg.role).not.toBe("toolResult");
		}
	});

	it("filters tool results when assistant message is skipped due to abort", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Call a tool" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				provider: "anthropic",
				api: "anthropic",
				model: "claude-3-5-sonnet-20241022",
				stopReason: "aborted",
				content: [
					{ type: "toolCall", id: "toolu_456", name: "test_tool", arguments: {} } as ToolCall,
				],
				timestamp: Date.now(),
				inputTokens: 100,
				outputTokens: 50,
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_456",
				toolName: "test_tool",
				content: [{ type: "text", text: "Tool result" }],
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const result = transformMessages(messages, mockAnthropicModel);

		// Should have filtered out both aborted assistant and its tool result
		expect(result).toHaveLength(1); // Only the user message
		expect(result[0].role).toBe("user");
	});

	it("preserves tool results for successful assistant messages", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Call a tool" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				provider: "anthropic",
				api: "anthropic",
				model: "claude-3-5-sonnet-20241022",
				stopReason: "tool_use",
				content: [
					{ type: "toolCall", id: "toolu_789", name: "test_tool", arguments: {} } as ToolCall,
				],
				timestamp: Date.now(),
				inputTokens: 100,
				outputTokens: 50,
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_789",
				toolName: "test_tool",
				content: [{ type: "text", text: "Tool result" }],
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const result = transformMessages(messages, mockAnthropicModel);

		// All messages should be preserved (assistant + toolResult)
		expect(result.length).toBeGreaterThanOrEqual(2);

		// Find the assistant and tool result in the output
		const hasAssistant = result.some(msg => msg.role === "assistant");
		const hasToolResult = result.some(msg => msg.role === "toolResult");

		expect(hasAssistant).toBe(true);
		expect(hasToolResult).toBe(true);
	});

	it("handles multiple skipped tool calls correctly", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Test" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				provider: "anthropic",
				api: "anthropic",
				model: "claude-3-5-sonnet-20241022",
				stopReason: "error",
				content: [
					{ type: "toolCall", id: "toolu_111", name: "tool1", arguments: {} } as ToolCall,
					{ type: "toolCall", id: "toolu_222", name: "tool2", arguments: {} } as ToolCall,
				],
				timestamp: Date.now(),
				inputTokens: 100,
				outputTokens: 50,
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_111",
				toolName: "tool1",
				content: [{ type: "text", text: "Result 1" }],
				timestamp: Date.now(),
			} as ToolResultMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_222",
				toolName: "tool2",
				content: [{ type: "text", text: "Result 2" }],
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const result = transformMessages(messages, mockAnthropicModel);

		// Should only have the user message, all tool-related messages filtered
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
	});

	it("handles mixed success and error tool calls in conversation", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "First request" }],
				timestamp: Date.now(),
			},
			// First successful tool call
			{
				role: "assistant",
				provider: "anthropic",
				api: "anthropic",
				model: "claude-3-5-sonnet-20241022",
				stopReason: "tool_use",
				content: [
					{ type: "toolCall", id: "toolu_success", name: "tool_success", arguments: {} } as ToolCall,
				],
				timestamp: Date.now(),
				inputTokens: 100,
				outputTokens: 50,
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_success",
				toolName: "tool_success",
				content: [{ type: "text", text: "Success result" }],
				timestamp: Date.now(),
			} as ToolResultMessage,
			{
				role: "user",
				content: [{ type: "text", text: "Second request" }],
				timestamp: Date.now(),
			},
			// Second errored tool call
			{
				role: "assistant",
				provider: "anthropic",
				api: "anthropic",
				model: "claude-3-5-sonnet-20241022",
				stopReason: "error",
				content: [
					{ type: "toolCall", id: "toolu_error", name: "tool_error", arguments: {} } as ToolCall,
				],
				timestamp: Date.now(),
				inputTokens: 100,
				outputTokens: 50,
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_error",
				toolName: "tool_error",
				content: [{ type: "text", text: "Error result" }],
				timestamp: Date.now(),
			} as ToolResultMessage,
			{
				role: "user",
				content: [{ type: "text", text: "Third request" }],
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, mockAnthropicModel);

		// Should preserve successful tool call but filter errored one
		const hasSuccessAssistant = result.some(
			(msg) => msg.role === "assistant" && msg.content.some((b) => b.type === "toolCall" && (b as ToolCall).id === "toolu_success")
		);
		const hasSuccessResult = result.some(
			(msg) => msg.role === "toolResult" && (msg as ToolResultMessage).toolCallId === "toolu_success"
		);
		const hasErrorAssistant = result.some(
			(msg) => msg.role === "assistant" && msg.content.some((b) => b.type === "toolCall" && (b as ToolCall).id === "toolu_error")
		);
		const hasErrorResult = result.some(
			(msg) => msg.role === "toolResult" && (msg as ToolResultMessage).toolCallId === "toolu_error"
		);

		expect(hasSuccessAssistant).toBe(true);
		expect(hasSuccessResult).toBe(true);
		expect(hasErrorAssistant).toBe(false); // Errored assistant should be filtered
		expect(hasErrorResult).toBe(false); // Errored result should be filtered
	});
});
