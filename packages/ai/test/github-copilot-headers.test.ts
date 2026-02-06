import { describe, expect, it } from "vitest";
import {
	buildCopilotDynamicHeaders,
	hasCopilotVisionInput,
	inferCopilotInitiator,
} from "../src/providers/github-copilot-headers.js";
import type { Message } from "../src/types.js";

describe("inferCopilotInitiator", () => {
	it("returns 'user' when there are no messages", () => {
		expect(inferCopilotInitiator([])).toBe("user");
	});

	it("returns 'agent' when last message role is assistant", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello", timestamp: Date.now() },
			{
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
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
		expect(inferCopilotInitiator(messages)).toBe("agent");
	});

	it("returns 'agent' when last message is toolResult", () => {
		const messages: Message[] = [
			{
				role: "toolResult",
				toolCallId: "tc_1",
				toolName: "bash",
				content: [{ type: "text", text: "output" }],
				isError: false,
				timestamp: Date.now(),
			},
		];
		expect(inferCopilotInitiator(messages)).toBe("agent");
	});

	it("returns 'user' when last message is user with text content", () => {
		const messages: Message[] = [{ role: "user", content: "what time is it?", timestamp: Date.now() }];
		expect(inferCopilotInitiator(messages)).toBe("user");
	});

	it("returns 'user' when last message is user with text content blocks", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "explain this image" }],
				timestamp: Date.now(),
			},
		];
		expect(inferCopilotInitiator(messages)).toBe("user");
	});

	it("returns 'agent' when last message is user but last content block is tool_result (Anthropic conversion)", () => {
		// After Anthropic conversion, tool results become user messages with tool_result blocks
		const messages: unknown[] = [
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tc_1", content: "done" }],
			},
		];
		expect(inferCopilotInitiator(messages)).toBe("agent");
	});
});

describe("hasCopilotVisionInput", () => {
	it("returns false when no messages have images", () => {
		const messages: Message[] = [{ role: "user", content: "hello", timestamp: Date.now() }];
		expect(hasCopilotVisionInput(messages)).toBe(false);
	});

	it("returns true when a user message has image content", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "describe this" },
					{ type: "image", data: "abc123", mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		];
		expect(hasCopilotVisionInput(messages)).toBe(true);
	});

	it("returns true when a toolResult has image content", () => {
		const messages: Message[] = [
			{
				role: "toolResult",
				toolCallId: "tc_1",
				toolName: "screenshot",
				content: [{ type: "image", data: "def456", mimeType: "image/jpeg" }],
				isError: false,
				timestamp: Date.now(),
			},
		];
		expect(hasCopilotVisionInput(messages)).toBe(true);
	});

	it("returns false when user message has only text content", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "just text" }],
				timestamp: Date.now(),
			},
		];
		expect(hasCopilotVisionInput(messages)).toBe(false);
	});
});

describe("buildCopilotDynamicHeaders", () => {
	it("sets X-Initiator and Openai-Intent", () => {
		const headers = buildCopilotDynamicHeaders({ messages: [], hasImages: false });
		expect(headers["X-Initiator"]).toBe("user");
		expect(headers["Openai-Intent"]).toBe("conversation-edits");
	});

	it("sets Copilot-Vision-Request when hasImages is true", () => {
		const headers = buildCopilotDynamicHeaders({ messages: [], hasImages: true });
		expect(headers["Copilot-Vision-Request"]).toBe("true");
	});

	it("does not set Copilot-Vision-Request when hasImages is false", () => {
		const headers = buildCopilotDynamicHeaders({ messages: [], hasImages: false });
		expect(headers["Copilot-Vision-Request"]).toBeUndefined();
	});
});
