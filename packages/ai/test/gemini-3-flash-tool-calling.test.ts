import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete } from "../src/stream.js";
import type { Context, Tool, ToolResultMessage } from "../src/types.js";
import { StringEnum } from "../src/utils/typebox-helpers.js";

/**
 * Test for Gemini 3 Flash Preview tool calling compatibility.
 *
 * Issue #213: The model works and tool calling works, but the problem is how pi-ai
 * formats the tool result message when sending it back to Gemini 3 Flash Preview.
 *
 * The SDK documentation states:
 * "Use 'output' key to specify function output and 'error' key to specify error details"
 *
 * But the code was using `result` and `isError` keys, which Gemini 3 Flash Preview
 * rejects (older models were more lenient).
 */

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

describe("Gemini 3 Flash Preview Tool Calling", () => {
	it("should handle tool calls and tool results with correct format", async () => {
		if (!process.env.GEMINI_API_KEY) {
			console.log("Skipping test - GEMINI_API_KEY not set");
			return;
		}

		const model = getModel("google", "gemini-3-flash-preview");

		const context: Context = {
			systemPrompt: "You are a helpful assistant that uses tools when asked.",
			messages: [
				{
					role: "user",
					content: "Calculate 15 + 27 using the calculator tool.",
					timestamp: Date.now(),
				},
			],
			tools: [calculatorTool],
		};

		// First call - model should request tool call
		const firstResponse = await complete(model, context);

		expect(firstResponse.role).toBe("assistant");
		expect(firstResponse.stopReason).toBe("toolUse");
		expect(firstResponse.errorMessage).toBeFalsy();

		const toolCall = firstResponse.content.find((b) => b.type === "toolCall");
		expect(toolCall).toBeTruthy();
		expect(toolCall?.type).toBe("toolCall");

		if (toolCall?.type === "toolCall") {
			expect(toolCall.name).toBe("calculator");
			expect(toolCall.id).toBeTruthy();
			expect(toolCall.arguments).toBeTruthy();

			const { a, b, operation } = toolCall.arguments;
			expect(a).toBe(15);
			expect(b).toBe(27);
			expect(operation).toBe("add");

			// Execute the tool
			const result = 15 + 27;

			// Add tool result to context - this is where the bug was
			// The SDK expects { output: value } for success, not { result: value, isError: false }
			context.messages.push(firstResponse);
			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: `${result}` }],
				isError: false,
				timestamp: Date.now(),
			};
			context.messages.push(toolResult);

			// Second call - model should process the tool result and respond
			// This is where Gemini 3 Flash Preview would fail with the old format
			const secondResponse = await complete(model, context);

			expect(secondResponse.role).toBe("assistant");
			expect(secondResponse.stopReason).toBe("stop");
			expect(secondResponse.errorMessage).toBeFalsy();

			const textContent = secondResponse.content
				.filter((b) => b.type === "text")
				.map((b) => (b.type === "text" ? b.text : ""))
				.join("");

			expect(textContent).toBeTruthy();
			// Should mention the result 42
			expect(textContent.toLowerCase()).toMatch(/42/);
		}
	}, 30000); // 30 second timeout

	it("should handle tool errors with correct format", async () => {
		if (!process.env.GEMINI_API_KEY) {
			console.log("Skipping test - GEMINI_API_KEY not set");
			return;
		}

		const model = getModel("google", "gemini-3-flash-preview");

		const context: Context = {
			systemPrompt: "You are a helpful assistant that uses tools when asked.",
			messages: [
				{
					role: "user",
					content: "Calculate 10 divided by 0 using the calculator tool.",
					timestamp: Date.now(),
				},
			],
			tools: [calculatorTool],
		};

		const firstResponse = await complete(model, context);
		expect(firstResponse.stopReason).toBe("toolUse");

		const toolCall = firstResponse.content.find((b) => b.type === "toolCall");
		if (toolCall?.type === "toolCall") {
			// Add error result - should use { error: message } format
			context.messages.push(firstResponse);
			const errorResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: "Error: Division by zero" }],
				isError: true,
				timestamp: Date.now(),
			};
			context.messages.push(errorResult);

			// Model should handle the error response
			const secondResponse = await complete(model, context);

			expect(secondResponse.role).toBe("assistant");
			expect(secondResponse.errorMessage).toBeFalsy();

			const textContent = secondResponse.content
				.filter((b) => b.type === "text")
				.map((b) => (b.type === "text" ? b.text : ""))
				.join("");

			expect(textContent).toBeTruthy();
			// Should acknowledge the error
			expect(textContent.toLowerCase()).toMatch(/error|cannot|division|zero/);
		}
	}, 30000);
});
