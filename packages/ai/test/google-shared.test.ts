import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/google-shared.js";
import type { AssistantMessage, Context, Model } from "../src/types.js";

const mockModel: Model<"google-generative-ai"> = {
	id: "gemini-2.0-flash",
	name: "Gemini 2.0 Flash",
	api: "google-generative-ai",
	provider: "google",
	baseUrl: "",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000000,
	maxTokens: 8192,
};

describe("convertMessages", () => {
	it("should merge consecutive user turns", () => {
		const context: Context = {
			messages: [
				{
					role: "user",
					content: "Hello",
					timestamp: 1,
				},
				{
					role: "user",
					content: "Are you there?",
					timestamp: 2,
				},
			],
		};

		const result = convertMessages(mockModel, context);

		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		expect(result[0].parts).toHaveLength(2);
		expect(result[0].parts?.[0].text).toBe("Hello");
		expect(result[0].parts?.[1].text).toBe("Are you there?");
	});

	it("should strip thoughtSignature from mismatched models", () => {
		const context: Context = {
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "test_tool",
							arguments: {},
							thoughtSignature: "opaque_signature",
						},
					],
					api: "anthropic-messages",
					provider: "anthropic",
					model: "claude-3-5-sonnet",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 1,
				} as AssistantMessage,
			],
		};

		const result = convertMessages(mockModel, context);

		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("model");
		const part = result[0].parts?.[0];
		expect(part).toBeDefined();
		// @ts-expect-error
		expect(part.thoughtSignature).toBeUndefined();
	});

	it("should keep thoughtSignature for matching models", () => {
		const context: Context = {
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "test_tool",
							arguments: {},
							thoughtSignature: "opaque_signature",
						},
					],
					api: "google-generative-ai",
					provider: "google",
					model: "gemini-2.0-flash", // Matches mockModel.id
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 1,
				} as AssistantMessage,
			],
		};

		const result = convertMessages(mockModel, context);

		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("model");
		const part = result[0].parts?.[0];
		expect(part).toBeDefined();
		// @ts-expect-error
		expect(part.thoughtSignature).toBe("opaque_signature");
	});
});
