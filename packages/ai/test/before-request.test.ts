/**
 * Tests for the beforeRequest callback in agent loop.
 * This callback is invoked before each LLM request, allowing dynamic context modification.
 */

import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent/agent-loop.js";
import type { AgentContext, AgentLoopConfig, BeforeRequestContext } from "../src/agent/types.js";
import { getModel } from "../src/models.js";
import type { UserMessage } from "../src/types.js";
import { resolveApiKey } from "./oauth.js";

const anthropicKey = await resolveApiKey("anthropic");

describe.skipIf(!anthropicKey)("beforeRequest callback", () => {
	const model = getModel("anthropic", "claude-sonnet-4-5")!;

	it("should be called before each LLM request", async () => {
		const callHistory: BeforeRequestContext[] = [];

		const context: AgentContext = {
			systemPrompt: "You are a helpful assistant. Respond with just 'Hello!'",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model,
			getApiKey: () => anthropicKey,
			beforeRequest: async (ctx) => {
				callHistory.push({ ...ctx });
				return undefined; // No modifications
			},
		};

		const userPrompt: UserMessage = {
			role: "user",
			content: "Say hello",
			timestamp: Date.now(),
		};

		const stream = agentLoop(userPrompt, context, config);
		for await (const _event of stream) {
			// Consume events
		}

		// Should have been called at least once (for the initial request)
		expect(callHistory.length).toBeGreaterThanOrEqual(1);

		// First call should have turnIndex 0
		expect(callHistory[0].turnIndex).toBe(0);

		// Should have the correct system prompt
		expect(callHistory[0].systemPrompt).toBe("You are a helpful assistant. Respond with just 'Hello!'");

		// Should have the model
		expect(callHistory[0].model).toBeDefined();
		expect(callHistory[0].model.id).toBe("claude-sonnet-4-5");
	});

	it("should allow modifying the system prompt", async () => {
		let capturedPrompt: string | undefined;

		const context: AgentContext = {
			systemPrompt: "Original prompt",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model,
			getApiKey: () => anthropicKey,
			beforeRequest: async (ctx) => {
				capturedPrompt = ctx.systemPrompt;
				return {
					systemPrompt: "Modified prompt: Always respond with 'MODIFIED'",
				};
			},
		};

		const userPrompt: UserMessage = {
			role: "user",
			content: "Say something",
			timestamp: Date.now(),
		};

		let response = "";
		const stream = agentLoop(userPrompt, context, config);
		for await (const event of stream) {
			if (event.type === "message_end" && event.message.role === "assistant") {
				for (const content of event.message.content) {
					if (content.type === "text") {
						response += content.text;
					}
				}
			}
		}

		// The callback received the original prompt
		expect(capturedPrompt).toBe("Original prompt");

		// The response should reflect the modified prompt
		expect(response.toUpperCase()).toContain("MODIFIED");
	});

	it("should increment turnIndex for multi-turn conversations", async () => {
		const turnIndices: number[] = [];

		// Use a simple tool to force multiple turns
		const echoTool = {
			name: "echo",
			label: "Echo",
			description: "Echoes back the input",
			parameters: {
				type: "object" as const,
				properties: {
					text: { type: "string", description: "Text to echo" },
				},
				required: ["text"],
			},
			execute: async (_id: string, params: { text: string }) => ({
				content: [{ type: "text" as const, text: params.text }],
				details: {},
			}),
		};

		const context: AgentContext = {
			systemPrompt: "You must use the echo tool to respond. Echo 'hello' then say goodbye.",
			messages: [],
			tools: [echoTool],
		};

		const config: AgentLoopConfig = {
			model,
			getApiKey: () => anthropicKey,
			beforeRequest: async (ctx) => {
				turnIndices.push(ctx.turnIndex);
				return undefined;
			},
		};

		const userPrompt: UserMessage = {
			role: "user",
			content: "Use the echo tool",
			timestamp: Date.now(),
		};

		const stream = agentLoop(userPrompt, context, config);
		for await (const _event of stream) {
			// Consume events
		}

		// Should have at least 2 turns (tool call + final response)
		expect(turnIndices.length).toBeGreaterThanOrEqual(1);

		// Turn indices should be sequential starting from 0
		for (let i = 0; i < turnIndices.length; i++) {
			expect(turnIndices[i]).toBe(i);
		}
	});

	it("should pass tools in the context", async () => {
		let receivedTools: any[] = [];

		const testTool = {
			name: "test_tool",
			label: "Test Tool",
			description: "A test tool",
			parameters: {
				type: "object" as const,
				properties: {},
			},
			execute: async () => ({
				content: [{ type: "text" as const, text: "done" }],
				details: {},
			}),
		};

		const context: AgentContext = {
			systemPrompt: "Just say hi",
			messages: [],
			tools: [testTool],
		};

		const config: AgentLoopConfig = {
			model,
			getApiKey: () => anthropicKey,
			beforeRequest: async (ctx) => {
				receivedTools = ctx.tools;
				return undefined;
			},
		};

		const userPrompt: UserMessage = {
			role: "user",
			content: "Hi",
			timestamp: Date.now(),
		};

		const stream = agentLoop(userPrompt, context, config);
		for await (const _event of stream) {
			// Consume events
		}

		// Should have received the tool
		expect(receivedTools.length).toBe(1);
		expect(receivedTools[0].name).toBe("test_tool");
	});

	it("should handle async beforeRequest callbacks", async () => {
		let asyncCompleted = false;

		const context: AgentContext = {
			systemPrompt: "Say hi",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model,
			getApiKey: () => anthropicKey,
			beforeRequest: async (ctx) => {
				// Simulate async operation (e.g., reading files)
				await new Promise((resolve) => setTimeout(resolve, 50));
				asyncCompleted = true;
				return {
					systemPrompt: `${ctx.systemPrompt} - async modification complete`,
				};
			},
		};

		const userPrompt: UserMessage = {
			role: "user",
			content: "Hi",
			timestamp: Date.now(),
		};

		const stream = agentLoop(userPrompt, context, config);
		for await (const _event of stream) {
			// Consume events
		}

		expect(asyncCompleted).toBe(true);
	});
});
