/**
 * Tests for Anthropic Vertex AI provider.
 *
 * These tests require GCP credentials configured via Application Default Credentials
 * and the following environment variables:
 * - GOOGLE_CLOUD_PROJECT: GCP project ID
 * - GOOGLE_CLOUD_LOCATION: Vertex AI location (e.g., "us-east5")
 */

import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete, stream } from "../src/stream.js";
import type { Context, Tool } from "../src/types.js";
import { StringEnum } from "../src/utils/typebox-helpers.js";

// Check if Vertex AI is configured
const vertexProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const vertexLocation = process.env.GOOGLE_CLOUD_LOCATION || process.env.CLOUD_ML_REGION;
const isVertexConfigured = Boolean(vertexProject && vertexLocation);

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

describe("Anthropic Vertex Provider", () => {
	// Test with Claude Opus 4.5 (the model enabled on Vertex)
	const llm = getModel("anthropic-vertex", "claude-opus-4-5@20251101");
	const vertexOptions = { project: vertexProject, location: vertexLocation } as const;

	it.skipIf(!isVertexConfigured)(
		"should complete basic text generation",
		{ retry: 3, timeout: 30000 },
		async () => {
			const context: Context = {
				systemPrompt: "You are a helpful assistant. Be concise.",
				messages: [
					{
						role: "user",
						content: "Reply with exactly: 'Hello test successful'",
						timestamp: Date.now(),
					},
				],
			};

			const response = await complete(llm, context, vertexOptions);

			expect(response.role).toBe("assistant");
			expect(response.content).toBeTruthy();
			expect(response.usage.input).toBeGreaterThan(0);
			expect(response.usage.output).toBeGreaterThan(0);
			expect(response.errorMessage).toBeFalsy();

			const text = response.content
				.map((b) => (b.type === "text" ? b.text : ""))
				.join("");
			expect(text).toContain("Hello test successful");
		},
	);

	it.skipIf(!isVertexConfigured)(
		"should handle tool calling",
		{ retry: 3, timeout: 30000 },
		async () => {
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

			const s = await stream(llm, context, vertexOptions);
			let hasToolStart = false;
			let hasToolEnd = false;

			for await (const event of s) {
				if (event.type === "toolcall_start") {
					hasToolStart = true;
					const toolCall = event.partial.content[event.contentIndex];
					expect(toolCall.type).toBe("toolCall");
				}
				if (event.type === "toolcall_end") {
					hasToolEnd = true;
					expect(event.toolCall.name).toBe("calculator");
					expect(event.toolCall.arguments).toMatchObject({
						a: 15,
						b: 27,
						operation: "add",
					});
				}
			}

			expect(hasToolStart).toBe(true);
			expect(hasToolEnd).toBe(true);
		},
	);

	it.skipIf(!isVertexConfigured)(
		"should handle streaming",
		{ retry: 3, timeout: 30000 },
		async () => {
			const context: Context = {
				systemPrompt: "You are a helpful assistant.",
				messages: [
					{
						role: "user",
						content: "Count from 1 to 5.",
						timestamp: Date.now(),
					},
				],
			};

			const s = await stream(llm, context, vertexOptions);
			let hasStart = false;
			let hasTextDelta = false;
			let hasDone = false;
			let collectedText = "";

			for await (const event of s) {
				if (event.type === "start") hasStart = true;
				if (event.type === "text_delta") {
					hasTextDelta = true;
					collectedText += event.delta;
				}
				if (event.type === "done") hasDone = true;
			}

			expect(hasStart).toBe(true);
			expect(hasTextDelta).toBe(true);
			expect(hasDone).toBe(true);
			expect(collectedText).toContain("1");
			expect(collectedText).toContain("5");
		},
	);

	it.skipIf(!isVertexConfigured)(
		"should handle multi-turn conversation",
		{ retry: 3, timeout: 60000 },
		async () => {
			const context: Context = {
				systemPrompt: "You are a helpful assistant. Be concise.",
				messages: [
					{
						role: "user",
						content: "My name is Alice.",
						timestamp: Date.now(),
					},
				],
			};

			// First turn
			const response1 = await complete(llm, context, vertexOptions);
			expect(response1.errorMessage).toBeFalsy();

			// Add response and follow-up
			context.messages.push(response1);
			context.messages.push({
				role: "user",
				content: "What is my name?",
				timestamp: Date.now(),
			});

			// Second turn
			const response2 = await complete(llm, context, vertexOptions);
			expect(response2.errorMessage).toBeFalsy();

			const text = response2.content
				.map((b) => (b.type === "text" ? b.text : ""))
				.join("");
			expect(text.toLowerCase()).toContain("alice");
		},
	);

	it.skipIf(!isVertexConfigured)(
		"should report token usage",
		{ retry: 3, timeout: 30000 },
		async () => {
			const context: Context = {
				messages: [
					{
						role: "user",
						content: "Say hello.",
						timestamp: Date.now(),
					},
				],
			};

			const response = await complete(llm, context, vertexOptions);

			expect(response.usage.input).toBeGreaterThan(0);
			expect(response.usage.output).toBeGreaterThan(0);
			expect(response.usage.totalTokens).toBeGreaterThan(0);
			expect(response.usage.totalTokens).toBe(
				response.usage.input +
					response.usage.output +
					response.usage.cacheRead +
					response.usage.cacheWrite,
			);
		},
	);
});

describe("Anthropic Vertex Provider - Thinking (Opus 4.5)", () => {
	// Use Opus 4.5 which supports thinking/extended reasoning
	const llm = getModel("anthropic-vertex", "claude-opus-4-5@20251101");
	const vertexOptions = {
		project: vertexProject,
		location: vertexLocation,
		thinkingEnabled: true,
		thinkingBudgetTokens: 2048,
	} as const;

	it.skipIf(!isVertexConfigured)(
		"should handle thinking blocks",
		{ retry: 3, timeout: 120000 },
		async () => {
			const context: Context = {
				systemPrompt: "You are a helpful assistant. Think step by step.",
				messages: [
					{
						role: "user",
						content: "What is 17 * 23? Think through this carefully.",
						timestamp: Date.now(),
					},
				],
			};

			const s = await stream(llm, context, vertexOptions);
			let hasThinkingStart = false;
			let hasThinkingDelta = false;
			let hasThinkingEnd = false;
			let thinkingContent = "";

			for await (const event of s) {
				if (event.type === "thinking_start") hasThinkingStart = true;
				if (event.type === "thinking_delta") {
					hasThinkingDelta = true;
					thinkingContent += event.delta;
				}
				if (event.type === "thinking_end") hasThinkingEnd = true;
			}

			// Opus 4.5 with thinkingEnabled should produce thinking blocks
			expect(hasThinkingStart).toBe(true);
			expect(hasThinkingDelta).toBe(true);
			expect(hasThinkingEnd).toBe(true);
			expect(thinkingContent.length).toBeGreaterThan(0);
		},
	);
});
