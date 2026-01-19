import { describe, expect, it } from "vitest";
import { streamOpenAIResponses } from "../src/providers/openai-responses.js";
import type { AssistantMessage, Context, Model } from "../src/types.js";

describe("openai-responses reasoning replay", () => {
	it("skips reasoning-only assistant history", async () => {
		const model: Model<"openai-responses"> = {
			id: "gpt-5",
			name: "gpt-5",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			contextWindow: 128_000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "internal",
					thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_test", summary: [] }),
				},
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "aborted",
			timestamp: Date.now(),
		};

		const context: Context = {
			systemPrompt: "system",
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }, assistant],
		};

		let capturedPayload: unknown;
		const stream = streamOpenAIResponses(model, context, {
			apiKey: "test",
			onPayload: (payload) => {
				capturedPayload = payload;
				throw new Error("intentional stop");
			},
		});

		await stream.result();

		const input = (capturedPayload as { input?: unknown } | undefined)?.input;
		const types = Array.isArray(input)
			? input
					.map((item) => (item && typeof item === "object" ? (item as { type?: unknown }).type : undefined))
					.filter((item): item is string => typeof item === "string")
			: [];

		expect(capturedPayload).toBeTruthy();
		expect(types).not.toContain("reasoning");
	});
});
