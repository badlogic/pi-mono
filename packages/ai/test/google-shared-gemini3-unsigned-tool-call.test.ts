import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/google-shared.js";
import type { Context, Model } from "../src/types.js";

describe("google-shared convertMessages", () => {
	it("uses dummy thought signature for unsigned tool calls on Gemini 3", () => {
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

		// Find the model turn containing the tool call.
		const toolTurn = contents.find((c) => c.role === "model" && c.parts?.some((p) => p.functionCall !== undefined));

		expect(toolTurn).toBeTruthy();

		const fcPart = toolTurn!.parts!.find((p) => p.functionCall !== undefined)!;

		// Tool call is preserved as a native functionCall (NOT downgraded to text).
		expect(fcPart.functionCall).toBeTruthy();
		expect(fcPart.functionCall!.name).toBe("bash");
		expect(fcPart.functionCall!.args).toEqual({ command: "ls -la" });

		// Dummy signature applied so Gemini 3 accepts it.
		expect(fcPart.thoughtSignature).toBe("skip_thought_signature_validator");

		// No text downgrade artifacts.
		const hasHistoricalText = toolTurn!.parts!.some(
			(p) => typeof p.text === "string" && p.text.includes("Historical context"),
		);
		expect(hasHistoricalText).toBe(false);
	});
});
