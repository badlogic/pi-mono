import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/google-shared.js";
import type { Context, Model } from "../src/types.js";

describe("google-shared convertMessages", () => {
	it("adds skip_thought_signature_validator for unsigned tool calls in Gemini 3", () => {
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

		let toolTurn: (typeof contents)[number] | undefined;
		for (let i = contents.length - 1; i >= 0; i -= 1) {
			if (contents[i]?.role === "model") {
				toolTurn = contents[i];
				break;
			}
		}

		expect(toolTurn).toBeTruthy();
		const functionCallPart = toolTurn?.parts?.find((p) => p.functionCall !== undefined);
		expect(functionCallPart).toBeDefined();
		expect(functionCallPart?.functionCall?.name).toBe("bash");
		expect(functionCallPart?.thoughtSignature).toBe("skip_thought_signature_validator");
	});
});
