import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete, getEnvApiKey } from "../src/stream.js";
import type { AssistantMessage, Context, Message, ThinkingContent, Tool, ToolCall } from "../src/types.js";

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

	it("drops orphaned tool calls when reasoning signature is missing", { retry: 2 }, async () => {
		// This tests the scenario where:
		// 1. A completed turn has reasoning + function_call
		// 2. The thinking signature gets lost (e.g., cross-provider handoff, isSameModel=false filtering)
		// 3. The toolCall remains but reasoning is gone
		// 4. Without the fix: Azure/OpenAI returns 400 "function_call without required reasoning item"
		// 5. With the fix: orphaned toolCalls are dropped, conversation continues

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

		// Get a real response with reasoning + tool call
		const assistantResponse = await complete(
			model,
			{
				systemPrompt: "You are a helpful assistant. Always use the tool when asked.",
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
		) as ThinkingContent | undefined;
		const toolCallBlock = assistantResponse.content.find((block) => block.type === "toolCall") as
			| ToolCall
			| undefined;

		if (!thinkingBlock) {
			throw new Error("Missing thinking block from OpenAI Responses");
		}
		if (!toolCallBlock) {
			throw new Error("Missing tool call from OpenAI Responses - model did not use the tool");
		}

		// Simulate corruption: keep toolCall but strip thinkingSignature
		// This mimics what happens when isSameModel=false and thinking text is empty
		const corruptedThinking: ThinkingContent = {
			type: "thinking",
			thinking: thinkingBlock.thinking,
			// thinkingSignature intentionally omitted - simulates it being lost
		};

		const corruptedAssistant: AssistantMessage = {
			...assistantResponse,
			content: [corruptedThinking, toolCallBlock],
			stopReason: "toolUse", // Completed successfully, not aborted
		};

		// Provide a tool result to continue the conversation
		const toolResult: Message = {
			role: "toolResult",
			toolCallId: toolCallBlock.id,
			toolName: toolCallBlock.name,
			content: [{ type: "text", text: "42" }],
			isError: false,
			timestamp: Date.now(),
		};

		const followUp: Message = {
			role: "user",
			content: "What was the result?",
			timestamp: Date.now(),
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [userMessage, corruptedAssistant, toolResult, followUp],
			tools: [testTool],
		};

		const response = await complete(model, context, {
			apiKey,
			reasoningEffort: "high",
		});

		// The key assertion: no 400 error from orphaned function_call
		// Error would be: "function_call was provided without its required reasoning item"
		expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
		expect(response.errorMessage).toBeFalsy();
		expect(response.content.length).toBeGreaterThan(0);
	});
});
