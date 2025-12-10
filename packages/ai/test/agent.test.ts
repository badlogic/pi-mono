import { describe, expect, it } from "vitest";
import { agentLoop, agentLoopContinue } from "../src/agent/agent-loop.js";
import { calculateTool } from "../src/agent/tools/calculate.js";
import type { AgentContext, AgentEvent, AgentLoopConfig } from "../src/agent/types.js";
import { getModel } from "../src/models.js";
import type {
	Api,
	AssistantMessage,
	Message,
	Model,
	OptionsForApi,
	ToolResultMessage,
	UserMessage,
} from "../src/types.js";

async function calculateTest<TApi extends Api>(model: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	// Create the agent context with the calculator tool
	const context: AgentContext = {
		systemPrompt:
			"You are a helpful assistant that performs mathematical calculations. When asked to calculate multiple expressions, you can use parallel tool calls if the model supports it. In your final answer, output ONLY the final sum as a single integer number, nothing else.",
		messages: [],
		tools: [calculateTool],
	};

	// Create the prompt config
	const config: AgentLoopConfig = {
		model,
		...options,
	};

	// Create the user prompt asking for multiple calculations
	const userPrompt: UserMessage = {
		role: "user",
		content: `Use the calculator tool to complete the following mulit-step task.
1. Calculate 3485 * 4234 and 88823 * 3482 in parallel
2. Calculate the sum of the two results using the calculator tool
3. Output ONLY the final sum as a single integer number, nothing else.`,
		timestamp: Date.now(),
	};

	// Calculate expected results (using integers)
	const expectedFirst = 3485 * 4234; // = 14755490
	const expectedSecond = 88823 * 3482; // = 309281786
	const expectedSum = expectedFirst + expectedSecond; // = 324037276

	// Track events for verification
	const events: AgentEvent[] = [];
	let turns = 0;
	let toolCallCount = 0;
	const toolResults: number[] = [];
	let finalAnswer: number | undefined;

	// Execute the prompt
	const stream = agentLoop(userPrompt, context, config);

	for await (const event of stream) {
		events.push(event);

		switch (event.type) {
			case "turn_start":
				turns++;
				console.log(`\n=== Turn ${turns} started ===`);
				break;

			case "turn_end":
				console.log(`=== Turn ${turns} ended with ${event.toolResults.length} tool results ===`);
				console.log(event.message);
				break;

			case "tool_execution_end":
				if (!event.isError && typeof event.result === "object" && event.result.content) {
					const textOutput = event.result.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n");
					toolCallCount++;
					// Extract number from output like "expression = result"
					const match = textOutput.match(/=\s*([\d.]+)/);
					if (match) {
						const value = parseFloat(match[1]);
						toolResults.push(value);
						console.log(`Tool ${toolCallCount}: ${textOutput}`);
					}
				}
				break;

			case "message_end":
				// Just track the message end event, don't extract answer here
				break;
		}
	}

	// Get the final messages
	const finalMessages = await stream.result();

	// Verify the results
	expect(finalMessages).toBeDefined();
	expect(finalMessages.length).toBeGreaterThan(0);

	const finalMessage = finalMessages[finalMessages.length - 1];
	expect(finalMessage).toBeDefined();
	expect(finalMessage.role).toBe("assistant");
	if (finalMessage.role !== "assistant") throw new Error("Final message is not from assistant");

	// Extract the final answer from the last assistant message
	const content = finalMessage.content
		.filter((c) => c.type === "text")
		.map((c) => (c.type === "text" ? c.text : ""))
		.join(" ");

	// Look for integers in the response that might be the final answer
	const numbers = content.match(/\b\d+\b/g);
	if (numbers) {
		// Check if any of the numbers matches our expected sum
		for (const num of numbers) {
			const value = parseInt(num, 10);
			if (Math.abs(value - expectedSum) < 10) {
				finalAnswer = value;
				break;
			}
		}
		// If no exact match, take the last large number as likely the answer
		if (finalAnswer === undefined) {
			const largeNumbers = numbers.map((n) => parseInt(n, 10)).filter((n) => n > 1000000);
			if (largeNumbers.length > 0) {
				finalAnswer = largeNumbers[largeNumbers.length - 1];
			}
		}
	}

	// Should have executed at least 3 tool calls: 2 for the initial calculations, 1 for the sum
	// (or possibly 2 if the model calculates the sum itself without a tool)
	expect(toolCallCount).toBeGreaterThanOrEqual(2);

	// Must be at least 3 turns: first to calculate the expressions, then to sum them, then give the answer
	// Could be 3 turns if model does parallel calls, or 4 turns if sequential calculation of expressions
	expect(turns).toBeGreaterThanOrEqual(3);
	expect(turns).toBeLessThanOrEqual(4);

	// Verify the individual calculations are in the results
	const hasFirstCalc = toolResults.some((r) => r === expectedFirst);
	const hasSecondCalc = toolResults.some((r) => r === expectedSecond);
	expect(hasFirstCalc).toBe(true);
	expect(hasSecondCalc).toBe(true);

	// Verify the final sum
	if (finalAnswer !== undefined) {
		expect(finalAnswer).toBe(expectedSum);
		console.log(`Final answer: ${finalAnswer} (expected: ${expectedSum})`);
	} else {
		// If we couldn't extract the final answer from text, check if it's in the tool results
		const hasSum = toolResults.some((r) => r === expectedSum);
		expect(hasSum).toBe(true);
	}

	// Log summary
	console.log(`\nTest completed with ${turns} turns and ${toolCallCount} tool calls`);
	if (turns === 3) {
		console.log("Model used parallel tool calls for initial calculations");
	} else {
		console.log("Model used sequential tool calls");
	}

	return {
		turns,
		toolCallCount,
		toolResults,
		finalAnswer,
		events,
	};
}

async function abortTest<TApi extends Api>(model: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	// Create the agent context with the calculator tool
	const context: AgentContext = {
		systemPrompt:
			"You are a helpful assistant that performs mathematical calculations. Always use the calculator tool for each calculation.",
		messages: [],
		tools: [calculateTool],
	};

	// Create the prompt config
	const config: AgentLoopConfig = {
		model,
		...options,
	};

	// Create a prompt that will require multiple calculations
	const userPrompt: UserMessage = {
		role: "user",
		content: "Calculate 100 * 200, then 300 * 400, then 500 * 600, then sum all three results.",
		timestamp: Date.now(),
	};

	// Create abort controller
	const abortController = new AbortController();

	// Track events for verification
	const events: AgentEvent[] = [];
	let toolCallCount = 0;
	const errorReceived = false;
	let finalMessages: Message[] | undefined;

	// Execute the prompt
	const stream = agentLoop(userPrompt, context, config, abortController.signal);

	// Abort after first tool execution
	const abortPromise = (async () => {
		for await (const event of stream) {
			events.push(event);

			if (event.type === "tool_execution_end" && !event.isError) {
				toolCallCount++;
				// Abort after first successful tool execution
				if (toolCallCount === 1) {
					console.log("Aborting after first tool execution");
					abortController.abort();
				}
			}

			if (event.type === "agent_end") {
				finalMessages = event.messages;
			}
		}
	})();

	finalMessages = await stream.result();

	// Verify abort behavior
	console.log(`\nAbort test completed with ${toolCallCount} tool calls`);
	const assistantMessage = finalMessages[finalMessages.length - 1];
	if (!assistantMessage) throw new Error("No final message received");
	expect(assistantMessage).toBeDefined();
	expect(assistantMessage.role).toBe("assistant");
	if (assistantMessage.role !== "assistant") throw new Error("Final message is not from assistant");

	// Should have executed 1 tool call before abort
	expect(toolCallCount).toBeGreaterThanOrEqual(1);
	expect(assistantMessage.stopReason).toBe("aborted");

	return {
		toolCallCount,
		events,
		errorReceived,
		finalMessages,
	};
}

describe("Agent Calculator Tests", () => {
	describe.skipIf(!process.env.GEMINI_API_KEY)("Google Provider Agent", () => {
		const model = getModel("google", "gemini-2.5-flash");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider Agent", () => {
		const model = getModel("openai", "gpt-4o-mini");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider Agent", () => {
		const model = getModel("openai", "gpt-5-mini");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic Provider Agent", () => {
		const model = getModel("anthropic", "claude-haiku-4-5");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.XAI_API_KEY)("xAI Provider Agent", () => {
		const model = getModel("xai", "grok-3");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.GROQ_API_KEY)("Groq Provider Agent", () => {
		const model = getModel("groq", "openai/gpt-oss-20b");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.CEREBRAS_API_KEY)("Cerebras Provider Agent", () => {
		const model = getModel("cerebras", "gpt-oss-120b");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.ZAI_API_KEY)("zAI Provider Agent", () => {
		const model = getModel("zai", "glm-4.5-air");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});

	describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral Provider Agent", () => {
		const model = getModel("mistral", "devstral-medium-latest");

		it("should calculate multiple expressions and sum the results", async () => {
			const result = await calculateTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(2);
		}, 30000);

		it("should handle abort during tool execution", async () => {
			const result = await abortTest(model);
			expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
		}, 30000);
	});
});

describe("agentLoopContinue", () => {
	describe("validation", () => {
		const model = getModel("anthropic", "claude-haiku-4-5");
		const baseContext: AgentContext = {
			systemPrompt: "You are a helpful assistant.",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = { model };

		it("should throw when context has no messages", () => {
			expect(() => agentLoopContinue(baseContext, config)).toThrow("Cannot continue: no messages in context");
		});

		it("should throw when last message is an assistant message", () => {
			const assistantMessage: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "Hello" }],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-haiku-4-5",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			};
			const context: AgentContext = {
				...baseContext,
				messages: [assistantMessage],
			};
			expect(() => agentLoopContinue(context, config)).toThrow(
				"Cannot continue from message role: assistant. Expected 'user' or 'toolResult'.",
			);
		});

		// Note: "should not throw" tests for valid inputs are covered by the E2E tests below
		// which actually consume the stream and verify the output
	});

	describe.skipIf(!process.env.ANTHROPIC_API_KEY)("continue from user message", () => {
		const model = getModel("anthropic", "claude-haiku-4-5");

		it("should continue and get assistant response when last message is user", async () => {
			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: "Say exactly: HELLO WORLD" }],
				timestamp: Date.now(),
			};

			const context: AgentContext = {
				systemPrompt: "You are a helpful assistant. Follow instructions exactly.",
				messages: [userMessage],
				tools: [],
			};

			const config: AgentLoopConfig = { model };

			const events: AgentEvent[] = [];
			const stream = agentLoopContinue(context, config);

			for await (const event of stream) {
				events.push(event);
			}

			const messages = await stream.result();

			// Should have gotten an assistant response
			expect(messages.length).toBe(1);
			expect(messages[0].role).toBe("assistant");

			// Verify event sequence - no user message events since we're continuing
			const eventTypes = events.map((e) => e.type);
			expect(eventTypes).toContain("agent_start");
			expect(eventTypes).toContain("turn_start");
			expect(eventTypes).toContain("message_start");
			expect(eventTypes).toContain("message_end");
			expect(eventTypes).toContain("turn_end");
			expect(eventTypes).toContain("agent_end");

			// Should NOT have user message events (that's the difference from agentLoop)
			const messageEndEvents = events.filter((e) => e.type === "message_end");
			expect(messageEndEvents.length).toBe(1); // Only assistant message
			expect((messageEndEvents[0] as any).message.role).toBe("assistant");
		}, 30000);
	});

	describe.skipIf(!process.env.ANTHROPIC_API_KEY)("continue from tool result", () => {
		const model = getModel("anthropic", "claude-haiku-4-5");

		it("should continue processing after tool results", async () => {
			// Simulate a conversation where:
			// 1. User asked to calculate something
			// 2. Assistant made a tool call
			// 3. Tool result is ready
			// 4. We continue from here

			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: "What is 5 + 3? Use the calculator." }],
				timestamp: Date.now(),
			};

			const assistantMessage: AssistantMessage = {
				role: "assistant",
				content: [
					{ type: "text", text: "Let me calculate that for you." },
					{ type: "toolCall", id: "calc-1", name: "calculate", arguments: { expression: "5 + 3" } },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-haiku-4-5",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: Date.now(),
			};

			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: "calc-1",
				toolName: "calculate",
				content: [{ type: "text", text: "5 + 3 = 8" }],
				isError: false,
				timestamp: Date.now(),
			};

			const context: AgentContext = {
				systemPrompt: "You are a helpful assistant. After getting a calculation result, state the answer clearly.",
				messages: [userMessage, assistantMessage, toolResult],
				tools: [calculateTool],
			};

			const config: AgentLoopConfig = { model };

			const events: AgentEvent[] = [];
			const stream = agentLoopContinue(context, config);

			for await (const event of stream) {
				events.push(event);
			}

			const messages = await stream.result();

			// Should have gotten an assistant response
			expect(messages.length).toBeGreaterThanOrEqual(1);
			const lastMessage = messages[messages.length - 1];
			expect(lastMessage.role).toBe("assistant");

			// The assistant should mention the result (8)
			if (lastMessage.role === "assistant") {
				const textContent = lastMessage.content
					.filter((c) => c.type === "text")
					.map((c) => (c as any).text)
					.join(" ");
				expect(textContent).toMatch(/8/);
			}
		}, 30000);
	});
});
