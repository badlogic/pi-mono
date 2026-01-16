import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/google-shared.js";
import type { Context, Model } from "../src/types.js";

describe("google-shared convertMessages", () => {
	it("skips unsigned tool calls for Gemini 3 to prevent mimicry", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};

		const now = Date.now();
		const context: Context = {
			messages: [
				{ role: "user", content: "Hi", timestamp: now },
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "bash",
							arguments: { command: "ls -la" },
							// No thoughtSignature: simulates Claude via Antigravity.
						},
					],
					api: "google-gemini-cli",
					provider: "google-antigravity",
					model: "claude-sonnet-4-20250514",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: now,
				},
			],
		};

		const contents = convertMessages(model, context);

		// The assistant message with only an unsigned tool call should be completely skipped
		// (parts.length === 0 causes the message to be omitted)
		const modelTurns = contents.filter((c) => c.role === "model");
		expect(modelTurns.length).toBe(0);
	});

	it("skips tool results for skipped unsigned tool calls", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};

		const now = Date.now();
		const context: Context = {
			messages: [
				{ role: "user", content: "Hi", timestamp: now },
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "bash",
							arguments: { command: "ls -la" },
							// No thoughtSignature
						},
					],
					api: "google-gemini-cli",
					provider: "google-antigravity",
					model: "claude-sonnet-4-20250514",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: now,
				},
				{
					role: "toolResult",
					toolCallId: "call_1",
					toolName: "bash",
					content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
					isError: false,
					timestamp: now,
				},
			],
		};

		const contents = convertMessages(model, context);

		// Both the tool call and its result should be skipped
		const modelTurns = contents.filter((c) => c.role === "model");
		const functionResponses = contents.filter((c) => c.parts?.some((p) => p.functionResponse !== undefined));

		expect(modelTurns.length).toBe(0);
		expect(functionResponses.length).toBe(0);
	});

	it("preserves signed tool calls for Gemini 3", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};

		const now = Date.now();
		// Valid base64 signature (at least looks valid)
		const validSignature = "AAAA";
		const context: Context = {
			messages: [
				{ role: "user", content: "Hi", timestamp: now },
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "bash",
							arguments: { command: "ls -la" },
							thoughtSignature: validSignature,
						},
					],
					api: "google-generative-ai",
					provider: "google",
					model: "gemini-3-pro-preview",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: now,
				},
			],
		};

		const contents = convertMessages(model, context);

		const modelTurns = contents.filter((c) => c.role === "model");
		expect(modelTurns.length).toBe(1);

		const functionCall = modelTurns[0]?.parts?.find((p) => p.functionCall !== undefined);
		expect(functionCall).toBeTruthy();
		expect(functionCall?.functionCall?.name).toBe("bash");
		expect(functionCall?.thoughtSignature).toBe(validSignature);
	});
});
