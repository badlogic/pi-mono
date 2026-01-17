import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete, stream } from "../src/stream.js";
import type { Context, ImageContent, Model, Tool, ToolResultMessage } from "../src/types.js";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "../src/utils/typebox-helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Calculator tool definition
const calculatorSchema = Type.Object({
	a: Type.Number({ description: "First number" }),
	b: Type.Number({ description: "Second number" }),
	operation: StringEnum(["add", "subtract", "multiply", "divide"], {
		description: "The operation to perform. One of 'add', 'subtract', 'multiply', 'divide'.",
	}),
});

const calculatorTool: Tool<typeof calculatorSchema> = {
	name: "calculator",
	description: "Perform basic arithmetic operations",
	parameters: calculatorSchema,
};

// Check if Vertex AI is configured for Anthropic models
const hasVertexAnthropicConfig = (): boolean => {
	const hasProject = !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
	return hasProject;
};

// Test helper functions
async function basicTextGeneration(model: Model<"anthropic-messages">, options?: any) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant. Be concise.",
		messages: [{ role: "user", content: "Reply with exactly: 'Hello test successful'", timestamp: Date.now() }],
	};
	const response = await complete(model, context, options);

	expect(response.role).toBe("assistant");
	expect(response.content).toBeTruthy();
	expect(response.errorMessage).toBeFalsy();
	expect(response.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain("Hello test successful");

	context.messages.push(response);
	context.messages.push({ role: "user", content: "Now say 'Goodbye test successful'", timestamp: Date.now() });

	const secondResponse = await complete(model, context, options);

	expect(secondResponse.role).toBe("assistant");
	expect(secondResponse.content).toBeTruthy();
	expect(secondResponse.errorMessage).toBeFalsy();
	expect(secondResponse.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain(
		"Goodbye test successful",
	);
}

async function handleToolCall(model: Model<"anthropic-messages">, options?: any) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that uses tools when asked.",
		messages: [{ role: "user", content: "Calculate 15 + 27 using the calculator tool.", timestamp: Date.now() }],
		tools: [calculatorTool],
	};

	const s = await stream(model, context, options);
	let hasToolStart = false;
	let hasToolEnd = false;

	for await (const event of s) {
		if (event.type === "toolcall_start") hasToolStart = true;
		if (event.type === "toolcall_end") hasToolEnd = true;
	}

	expect(hasToolStart).toBe(true);
	expect(hasToolEnd).toBe(true);

	const response = await s.result();
	expect(response.stopReason).toBe("toolUse");
	expect(response.content.some((b) => b.type === "toolCall")).toBeTruthy();
}

async function handleStreaming(model: Model<"anthropic-messages">, options?: any) {
	let textStarted = false;
	let textChunks = "";
	let textCompleted = false;

	const context: Context = {
		messages: [{ role: "user", content: "Count from 1 to 3", timestamp: Date.now() }],
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "text_start") textStarted = true;
		else if (event.type === "text_delta") textChunks += event.delta;
		else if (event.type === "text_end") textCompleted = true;
	}

	expect(textStarted).toBe(true);
	expect(textChunks.length).toBeGreaterThan(0);
	expect(textCompleted).toBe(true);
}

async function handleThinking(model: Model<"anthropic-messages">, options?: any) {
	let thinkingStarted = false;
	let thinkingCompleted = false;

	const context: Context = {
		messages: [
			{
				role: "user",
				content: `Think about ${(Math.random() * 255) | 0} + 27. Think step by step. Output the result.`,
				timestamp: Date.now(),
			},
		],
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "thinking_start") thinkingStarted = true;
		else if (event.type === "thinking_end") thinkingCompleted = true;
	}

	const response = await s.result();
	expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
	expect(thinkingStarted).toBe(true);
	expect(thinkingCompleted).toBe(true);
	expect(response.content.some((b) => b.type === "thinking")).toBeTruthy();
}

async function handleImage(model: Model<"anthropic-messages">, options?: any) {
	if (!model.input.includes("image")) return;

	const imagePath = join(__dirname, "data", "red-circle.png");
	const imageBuffer = readFileSync(imagePath);
	const base64Image = imageBuffer.toString("base64");

	const imageContent: ImageContent = { type: "image", data: base64Image, mimeType: "image/png" };

	const context: Context = {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Describe the shape and color. Reply in English." },
					imageContent,
				],
				timestamp: Date.now(),
			},
		],
	};

	const response = await complete(model, context, options);
	const textContent = response.content.find((b) => b.type === "text");
	if (textContent && textContent.type === "text") {
		const lowerContent = textContent.text.toLowerCase();
		expect(lowerContent).toContain("red");
		expect(lowerContent).toContain("circle");
	}
}

async function multiTurn(model: Model<"anthropic-messages">, options?: any) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
		messages: [
			{
				role: "user",
				content: "Calculate 42 * 17 and 453 + 434 using the calculator tool.",
				timestamp: Date.now(),
			},
		],
		tools: [calculatorTool],
	};

	let allTextContent = "";
	let hasSeenToolCalls = false;

	for (let turn = 0; turn < 5; turn++) {
		const response = await complete(model, context, options);
		context.messages.push(response);

		const results: ToolResultMessage[] = [];
		for (const block of response.content) {
			if (block.type === "text") allTextContent += block.text;
			else if (block.type === "toolCall") {
				hasSeenToolCalls = true;
				const { a, b, operation } = block.arguments;
				const result = operation === "add" ? a + b : operation === "multiply" ? a * b : 0;
				results.push({
					role: "toolResult",
					toolCallId: block.id,
					toolName: block.name,
					content: [{ type: "text", text: `${result}` }],
					isError: false,
					timestamp: Date.now(),
				});
			}
		}
		context.messages.push(...results);

		if (response.stopReason === "stop") break;
	}

	expect(hasSeenToolCalls).toBe(true);
	expect(allTextContent).toContain("714");
	expect(allTextContent).toContain("887");
}

// Define models and their capabilities
const vertexAnthropicModels = [
	{
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		supportsThinking: true,
	},
	{
		id: "claude-opus-4-5",
		name: "Claude Opus 4.5",
		supportsThinking: true,
	},
	{
		id: "claude-haiku-4-5",
		name: "Claude Haiku 4.5",
		supportsThinking: false,
	},
] as const;

const isVertexConfigured = hasVertexAnthropicConfig();

// Generate tests for each model
for (const modelConfig of vertexAnthropicModels) {
	describe(`Google Vertex Anthropic Provider (${modelConfig.id})`, () => {
		const llm = getModel("google-vertex", modelConfig.id);

		it.skipIf(!isVertexConfigured)("should complete basic text generation", { retry: 3, timeout: 60000 }, async () => {
			await basicTextGeneration(llm);
		});

		it.skipIf(!isVertexConfigured)("should handle tool calling", { retry: 3, timeout: 60000 }, async () => {
			await handleToolCall(llm);
		});

		it.skipIf(!isVertexConfigured)("should handle streaming", { retry: 3, timeout: 60000 }, async () => {
			await handleStreaming(llm);
		});

		if (modelConfig.supportsThinking) {
			it.skipIf(!isVertexConfigured)("should handle thinking", { retry: 3, timeout: 120000 }, async () => {
				await handleThinking(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
			});

			it.skipIf(!isVertexConfigured)(
				"should handle multi-turn with thinking and tools",
				{ retry: 3, timeout: 120000 },
				async () => {
					await multiTurn(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
				},
			);
		}

		it.skipIf(!isVertexConfigured)("should handle image input", { retry: 3, timeout: 60000 }, async () => {
			await handleImage(llm);
		});
	});
}
