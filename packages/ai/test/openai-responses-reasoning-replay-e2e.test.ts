import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete, getEnvApiKey } from "../src/stream.js";
import type { AssistantMessage, Context, Message, Tool } from "../src/types.js";

const testToolSchema = Type.Object({
	value: Type.Number({ description: "A number to double" }),
});

const testTool: Tool<typeof testToolSchema> = {
	name: "double_number",
	description: "Doubles a number and returns the result",
	parameters: testToolSchema,
};

describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses reasoning replay e2e", () => {
	it("skips reasoning-only history after an aborted turn", { retry: 2 }, async () => {
		const model = getModel("openai", "gpt-5-mini");

		const apiKey = getEnvApiKey("openai");
		if (!apiKey) {
			throw new Error("Missing OPENAI_API_KEY");
		}

		const userMessage: Message = {
			role: "user",
			content: "Use the double_number tool to double 21.",
			timestamp: Date.now(),
		};

		const assistantResponse = await complete(
			model,
			{
				systemPrompt: "You are a helpful assistant. Use the tool.",
				messages: [userMessage],
				tools: [testTool],
			},
			{
				apiKey,
				reasoningEffort: "high",
			},
		);

		const thinkingBlock = assistantResponse.content.find(
			(block) => block.type === "thinking" && block.thinkingSignature,
		);
		if (!thinkingBlock || thinkingBlock.type !== "thinking") {
			throw new Error("Missing thinking signature from OpenAI Responses");
		}

		const corruptedAssistant: AssistantMessage = {
			...assistantResponse,
			content: [thinkingBlock],
			stopReason: "aborted",
		};

		const followUp: Message = {
			role: "user",
			content: "Say hello to confirm you can continue.",
			timestamp: Date.now(),
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [userMessage, corruptedAssistant, followUp],
			tools: [testTool],
		};

		const response = await complete(model, context, {
			apiKey,
			reasoningEffort: "high",
		});

		// The key assertion: no 400 error from orphaned reasoning item
		expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
		expect(response.errorMessage).toBeFalsy();
		// Model should respond (text or tool call)
		expect(response.content.length).toBeGreaterThan(0);
	});
});
