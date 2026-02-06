import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { AssistantMessage, Message, Model, ToolCall } from "../src/types.js";

// Normalize function matching what anthropic.ts uses
function anthropicNormalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function makeCopilotClaudeModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "github-copilot",
		baseUrl: "https://api.individual.githubcopilot.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

describe("OpenAI to Anthropic session migration for Copilot Claude", () => {
	it("converts thinking blocks to plain text when source model differs", () => {
		const model = makeCopilotClaudeModel();
		const messages: Message[] = [
			{ role: "user", content: "hello", timestamp: Date.now() },
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "Let me think about this...",
						thinkingSignature: "reasoning_content",
					},
					{ type: "text", text: "Hi there!" },
				],
				api: "openai-completions",
				provider: "github-copilot",
				model: "gpt-4o",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, model, anthropicNormalizeToolCallId);
		const assistantMsg = result.find((m) => m.role === "assistant") as AssistantMessage;

		// Thinking block should be converted to text since models differ
		const textBlocks = assistantMsg.content.filter((b) => b.type === "text");
		const thinkingBlocks = assistantMsg.content.filter((b) => b.type === "thinking");
		expect(thinkingBlocks).toHaveLength(0);
		expect(textBlocks.length).toBeGreaterThanOrEqual(2);
	});

	it("normalizes tool call IDs with disallowed characters", () => {
		const model = makeCopilotClaudeModel();
		const toolCallId = "call_abc+123/def=456|some_very_long_id_that_exceeds_limits";
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: Date.now() },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: toolCallId,
						name: "bash",
						arguments: { command: "ls" },
					},
				],
				api: "openai-completions",
				provider: "github-copilot",
				model: "gpt-4o",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId,
				toolName: "bash",
				content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
				isError: false,
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, model, anthropicNormalizeToolCallId);

		// Get the normalized tool call ID
		const assistantMsg = result.find((m) => m.role === "assistant") as AssistantMessage;
		const toolCall = assistantMsg.content.find((b) => b.type === "toolCall") as ToolCall;
		const normalizedId = toolCall.id;

		// Verify it only has allowed characters and is <= 64 chars
		expect(normalizedId).toMatch(/^[a-zA-Z0-9_-]+$/);
		expect(normalizedId.length).toBeLessThanOrEqual(64);

		// Verify tool result references the normalized ID
		const toolResultMsg = result.find((m) => m.role === "toolResult");
		expect(toolResultMsg).toBeDefined();
		if (toolResultMsg && toolResultMsg.role === "toolResult") {
			expect(toolResultMsg.toolCallId).toBe(normalizedId);
		}
	});

	it("removes thoughtSignature from tool calls when migrating between models", () => {
		const model = makeCopilotClaudeModel();
		const messages: Message[] = [
			{ role: "user", content: "run a command", timestamp: Date.now() },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call_123",
						name: "bash",
						arguments: { command: "ls" },
						thoughtSignature: JSON.stringify({ type: "reasoning.encrypted", id: "call_123", data: "encrypted" }),
					},
				],
				api: "openai-responses",
				provider: "github-copilot",
				model: "gpt-5",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "call_123",
				toolName: "bash",
				content: [{ type: "text", text: "output" }],
				isError: false,
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, model, anthropicNormalizeToolCallId);
		const assistantMsg = result.find((m) => m.role === "assistant") as AssistantMessage;
		const toolCall = assistantMsg.content.find((b) => b.type === "toolCall") as ToolCall;

		expect(toolCall.thoughtSignature).toBeUndefined();
	});
});
