import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { AssistantMessage, Message, Model, ToolResultMessage } from "../src/types.js";

// Mock model for testing
const mockModel: Model<"completions"> = {
	provider: "anthropic",
	api: "completions",
	id: "claude-sonnet-4-20250514",
	maxContextLength: 200000,
	supportsToolUse: true,
	supportsSystemPrompt: true,
	supportsThinking: true,
	supportsCaching: true,
	supportsPrefill: true,
	defaultThinking: "enabled",
};

describe("transformMessages - orphaned tool results from errored/aborted assistants", () => {
	it("should drop toolResults that reference errored assistant messages", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Run a command" }],
				timestamp: Date.now(),
			},
			// Errored assistant with a tool call
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "toolu_errored_123",
						name: "exec",
						arguments: { command: "echo hello" },
					},
				],
				stopReason: "error",
				errorMessage: "terminated",
				provider: "anthropic",
				api: "completions",
				model: "claude-sonnet-4-20250514",
				timestamp: Date.now(),
			} as AssistantMessage,
			// Orphaned toolResult for the errored assistant (inserted by transcript repair)
			{
				role: "toolResult",
				toolCallId: "toolu_errored_123",
				toolName: "exec",
				content: [{ type: "text", text: "[synthetic] missing tool result" }],
				isError: true,
				timestamp: Date.now(),
			} as ToolResultMessage,
			// Next user message continues the conversation
			{
				role: "user",
				content: [{ type: "text", text: "Continue please" }],
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, mockModel);

		// Should have: user, user (errored assistant + orphaned result dropped)
		expect(result.length).toBe(2);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("user");

		// Verify no toolResult made it through
		const toolResults = result.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBe(0);
	});

	it("should drop toolResults that reference aborted assistant messages", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Edit a file" }],
				timestamp: Date.now(),
			},
			// Aborted assistant with partial tool call
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "toolu_aborted_456",
						name: "edit",
						arguments: { path: "/some/file.txt" },
						partialJson: '{"path": "/some/file.txt", "oldText": "partial...',
					},
				],
				stopReason: "aborted",
				errorMessage: "Request was aborted.",
				provider: "anthropic",
				api: "completions",
				model: "claude-sonnet-4-20250514",
				timestamp: Date.now(),
			} as AssistantMessage,
			// Orphaned toolResult for the aborted assistant
			{
				role: "toolResult",
				toolCallId: "toolu_aborted_456",
				toolName: "edit",
				content: [{ type: "text", text: "[ tool interrupted ]" }],
				isError: true,
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const result = transformMessages(messages, mockModel);

		// Should have: user only (aborted assistant + orphaned result dropped)
		expect(result.length).toBe(1);
		expect(result[0].role).toBe("user");
	});

	it("should preserve valid toolResults for non-errored assistants", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Calculate something" }],
				timestamp: Date.now(),
			},
			// Valid assistant with tool call
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "toolu_valid_789",
						name: "calculate",
						arguments: { expression: "2 + 2" },
					},
				],
				stopReason: "toolUse",
				provider: "anthropic",
				api: "completions",
				model: "claude-sonnet-4-20250514",
				timestamp: Date.now(),
			} as AssistantMessage,
			// Valid toolResult
			{
				role: "toolResult",
				toolCallId: "toolu_valid_789",
				toolName: "calculate",
				content: [{ type: "text", text: "4" }],
				isError: false,
				timestamp: Date.now(),
			} as ToolResultMessage,
		];

		const result = transformMessages(messages, mockModel);

		// Should have: user, assistant, toolResult
		expect(result.length).toBe(3);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
	});

	it("should handle mixed valid and errored assistants in same transcript", () => {
		const messages: Message[] = [
			// First exchange: valid tool call
			{
				role: "user",
				content: [{ type: "text", text: "First question" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "toolu_valid_1",
						name: "search",
						arguments: { query: "test" },
					},
				],
				stopReason: "toolUse",
				provider: "anthropic",
				api: "completions",
				model: "claude-sonnet-4-20250514",
				timestamp: Date.now(),
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_valid_1",
				toolName: "search",
				content: [{ type: "text", text: "Found results" }],
				isError: false,
				timestamp: Date.now(),
			} as ToolResultMessage,
			// Second exchange: errored tool call (should be dropped)
			{
				role: "user",
				content: [{ type: "text", text: "Second question" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "toolu_errored_2",
						name: "exec",
						arguments: { command: "long-running" },
					},
				],
				stopReason: "error",
				errorMessage: "terminated",
				provider: "anthropic",
				api: "completions",
				model: "claude-sonnet-4-20250514",
				timestamp: Date.now(),
			} as AssistantMessage,
			{
				role: "toolResult",
				toolCallId: "toolu_errored_2",
				toolName: "exec",
				content: [{ type: "text", text: "[synthetic] error" }],
				isError: true,
				timestamp: Date.now(),
			} as ToolResultMessage,
			// Third exchange: continue normally
			{
				role: "user",
				content: [{ type: "text", text: "Third question" }],
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, mockModel);

		// Should have: user, assistant, toolResult, user, user
		// (errored assistant + its toolResult dropped)
		expect(result.length).toBe(5);
		expect(result.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "user", "user"]);

		// Verify the valid toolResult is preserved
		const toolResults = result.filter((m) => m.role === "toolResult") as ToolResultMessage[];
		expect(toolResults.length).toBe(1);
		expect(toolResults[0].toolCallId).toBe("toolu_valid_1");
	});
});
