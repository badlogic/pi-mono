import { type Static, Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete } from "../src/stream.js";
import type { Context, Tool } from "../src/types.js";

// Simple read tool
const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read" }),
});

type ReadParams = Static<typeof readSchema>;

const readTool: Tool = {
	name: "read",
	description: "Read contents of a file",
	parameters: readSchema,
};

describe("Google Thought Signature Tests", () => {
	describe.skipIf(!process.env.GEMINI_API_KEY)("Gemini 3 Pro - Text + Tool Call", () => {
		const model = getModel("google", "gemini-3-pro-preview");

		it("should handle text + tool call in same response and preserve thoughtSignature on subsequent requests", async () => {
			// Create a prompt that encourages the model to generate text/thoughts AND a tool call
			const context: Context = {
				systemPrompt: "You are a helpful assistant. Think through your actions before using tools.",
				messages: [],
				tools: [readTool],
			};

			// Ask something that should trigger both explanation text and a tool call
			context.messages.push({
				role: "user",
				content:
					"I need you to read the file packages/coding-agent/CHANGELOG.md. First explain what you're going to do, then use the read tool.",
				timestamp: Date.now(),
			});

			// Get first response - should contain text + tool call
			const firstResponse = await complete(model, context);
			console.log("First response:", JSON.stringify(firstResponse, null, 2));

			// Verify it has both text and tool call
			const hasText = firstResponse.content.some((b) => b.type === "text");
			const hasToolCall = firstResponse.content.some((b) => b.type === "toolCall");

			// If model didn't generate both, skip the test (model behavior varies)
			if (!hasText || !hasToolCall) {
				console.log("Model did not generate text + tool call in same response, skipping test");
				return;
			}

			// Check if thoughtSignature was captured
			const toolCall = firstResponse.content.find((b) => b.type === "toolCall");
			if (toolCall && toolCall.type === "toolCall") {
				console.log("Tool call thoughtSignature:", toolCall.thoughtSignature);
			}

			context.messages.push(firstResponse);

			// Provide tool result
			const toolCallBlock = firstResponse.content.find((b) => b.type === "toolCall");
			if (!toolCallBlock || toolCallBlock.type !== "toolCall") {
				throw new Error("Expected tool call");
			}

			context.messages.push({
				role: "toolResult",
				toolCallId: toolCallBlock.id,
				toolName: toolCallBlock.name,
				content: [{ type: "text", text: "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Some fix" }],
				isError: false,
				timestamp: Date.now(),
			});

			// Send follow-up message - this will convert the assistant message (with text + tool call)
			// back to Google's format. If thoughtSignature is missing, Google will error.
			context.messages.push({
				role: "user",
				content: "Great, now tell me what version is unreleased?",
				timestamp: Date.now(),
			});

			// This is where the error would occur if thoughtSignature is not preserved
			const secondResponse = await complete(model, context);
			console.log("Second response:", JSON.stringify(secondResponse, null, 2));

			// The request should succeed
			expect(secondResponse.stopReason).not.toBe("error");
			expect(secondResponse.errorMessage).toBeUndefined();
			expect(secondResponse.content.length).toBeGreaterThan(0);
		}, 30000);
	});
});
