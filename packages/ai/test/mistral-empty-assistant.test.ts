import { Mistral } from "@mistralai/mistralai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { streamSimple } from "../src/stream.js";
import type { AssistantMessage, Context, ToolCall, ToolResultMessage, UserMessage } from "../src/types.js";

describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral Empty Assistant Message", () => {
	it("verifies SDK rejects empty assistant messages", async () => {
		// Verify the raw SDK behavior - empty assistant messages fail
		const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

		// This should fail - empty assistant message
		try {
			await client.chat.complete({
				model: "devstral-medium-latest",
				messages: [
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "" }, // Empty - should fail
					{ role: "user", content: "Are you there?" },
				],
			});
			expect.fail("Should have thrown an error");
		} catch (error: any) {
			expect(error.message).toContain("Assistant message must have either content or tool_calls");
		}
	});

	it("skips empty assistant messages to avoid 400 errors", async () => {
		const model = getModel("mistral", "devstral-medium-latest");
		if (!model) throw new Error("Model not found");

		// Build a context with an aborted assistant message
		const messages: (UserMessage | AssistantMessage | ToolResultMessage)[] = [
			{
				role: "user",
				content: "Hello, read a file for me",
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "test12345",
						name: "read",
						arguments: { path: "/test.txt" },
					} as ToolCall,
				],
				api: "openai-completions",
				provider: "mistral",
				model: "devstral-medium-latest",
				usage: {
					input: 100,
					output: 20,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 120,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
			{
				role: "toolResult",
				toolCallId: "test12345",
				toolName: "read",
				content: [{ type: "text", text: "File content here..." }],
				isError: false,
				timestamp: Date.now(),
			},
			// This is the aborted assistant message - empty content, no tool calls
			{
				role: "assistant",
				content: [], // Empty - simulates aborted
				api: "openai-completions",
				provider: "mistral",
				model: "devstral-medium-latest",
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
				errorMessage: "Request was aborted.",
			},
			{
				role: "user",
				content: "Are you still there?",
				timestamp: Date.now(),
			},
		];

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages,
			tools: [
				{
					name: "read",
					description: "Read file contents",
					parameters: Type.Object({
						path: Type.String(),
					}),
				},
			],
		};

		// This should NOT fail with 400 after our fix
		const response = await streamSimple(model, context);
		const result = await response.result();

		console.log("Result:", JSON.stringify(result, null, 2));

		expect(result.stopReason).not.toBe("error");
		expect(result.errorMessage).toBeUndefined();

		// Verify the assistant can respond
		const textContent = result.content.find((c) => c.type === "text");
		expect(textContent).toBeDefined();

		console.log("Test passed - pi-ai provider handled aborted message correctly");
	}, 60000);
});
