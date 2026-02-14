import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { Message, Model, ToolResultMessage } from "../src/types.js";

function makeModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

describe("Errored assistant orphaned tool results", () => {
	it("drops toolResults referencing tool calls from errored assistants", () => {
		const model = makeModel();
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: 1000 },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call_err_1",
						name: "bash",
						arguments: { command: "ls" },
					},
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-sonnet-4",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error",
				timestamp: 2000,
			},
			{
				role: "toolResult",
				toolCallId: "call_err_1",
				toolName: "bash",
				content: [{ type: "text", text: "synthetic result from transcript repair" }],
				isError: true,
				timestamp: 3000,
			},
			{ role: "user", content: "try again", timestamp: 4000 },
		];

		const result = transformMessages(messages, model);

		// The errored assistant should be skipped
		const assistants = result.filter((m) => m.role === "assistant");
		expect(assistants).toHaveLength(0);

		// The orphaned toolResult should also be dropped
		const toolResults = result.filter((m) => m.role === "toolResult");
		expect(toolResults).toHaveLength(0);

		// Only user messages should remain
		expect(result).toHaveLength(2);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("user");
	});

	it("drops toolResults referencing tool calls from aborted assistants", () => {
		const model = makeModel();
		const messages: Message[] = [
			{ role: "user", content: "run commands", timestamp: 1000 },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call_abort_1",
						name: "bash",
						arguments: { command: "ls" },
					},
					{
						type: "toolCall",
						id: "call_abort_2",
						name: "bash",
						arguments: { command: "pwd" },
					},
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-sonnet-4",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "aborted",
				timestamp: 2000,
			},
			{
				role: "toolResult",
				toolCallId: "call_abort_1",
				toolName: "bash",
				content: [{ type: "text", text: "output1" }],
				isError: false,
				timestamp: 3000,
			},
			{
				role: "toolResult",
				toolCallId: "call_abort_2",
				toolName: "bash",
				content: [{ type: "text", text: "output2" }],
				isError: true,
				timestamp: 4000,
			},
			{ role: "user", content: "retry", timestamp: 5000 },
		];

		const result = transformMessages(messages, model);

		// No assistant or toolResult messages should remain
		const assistants = result.filter((m) => m.role === "assistant");
		const toolResults = result.filter((m) => m.role === "toolResult");
		expect(assistants).toHaveLength(0);
		expect(toolResults).toHaveLength(0);

		// Only user messages remain
		expect(result).toHaveLength(2);
	});

	it("keeps toolResults for valid (non-errored) assistants", () => {
		const model = makeModel();
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: 1000 },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call_ok_1",
						name: "bash",
						arguments: { command: "ls" },
					},
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-sonnet-4",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 2000,
			},
			{
				role: "toolResult",
				toolCallId: "call_ok_1",
				toolName: "bash",
				content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
				isError: false,
				timestamp: 3000,
			},
		];

		const result = transformMessages(messages, model);

		// Both assistant and toolResult should remain
		expect(result).toHaveLength(3);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
	});

	it("handles mixed errored and valid assistants correctly", () => {
		const model = makeModel();
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: 1000 },
			// First attempt: errored
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call_err_1",
						name: "bash",
						arguments: { command: "ls" },
					},
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-sonnet-4",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error",
				timestamp: 2000,
			},
			{
				role: "toolResult",
				toolCallId: "call_err_1",
				toolName: "bash",
				content: [{ type: "text", text: "synthetic" }],
				isError: true,
				timestamp: 3000,
			},
			// Retry: succeeded
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call_ok_1",
						name: "bash",
						arguments: { command: "ls" },
					},
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-sonnet-4",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 4000,
			},
			{
				role: "toolResult",
				toolCallId: "call_ok_1",
				toolName: "bash",
				content: [{ type: "text", text: "file1.txt" }],
				isError: false,
				timestamp: 5000,
			},
		];

		const result = transformMessages(messages, model);

		// Errored assistant and its toolResult should be dropped
		// Valid assistant and its toolResult should remain
		expect(result).toHaveLength(3);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		expect((result[2] as ToolResultMessage).toolCallId).toBe("call_ok_1");
	});
});
