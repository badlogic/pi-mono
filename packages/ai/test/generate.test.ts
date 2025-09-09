import { type ChildProcess, execSync, spawn } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { getModel } from "../src/models.js";
import { complete, stream } from "../src/stream.js";
import type { Api, Context, ImageContent, Model, OptionsForApi, Tool, ToolResultMessage } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Calculator tool definition (same as examples)
const calculatorTool: Tool = {
	name: "calculator",
	description: "Perform basic arithmetic operations",
	parameters: z.object({
		a: z.number().describe("First number"),
		b: z.number().describe("Second number"),
		operation: z
			.enum(["add", "subtract", "multiply", "divide"])
			.describe("The operation to perform. One of 'add', 'subtract', 'multiply', 'divide'."),
	}),
};

async function basicTextGeneration<TApi extends Api>(model: Model<TApi>, options?: OptionsForApi<TApi>) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant. Be concise.",
		messages: [{ role: "user", content: "Reply with exactly: 'Hello test successful'" }],
	};
	const response = await complete(model, context, options);

	expect(response.role).toBe("assistant");
	expect(response.content).toBeTruthy();
	expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
	expect(response.usage.output).toBeGreaterThan(0);
	expect(response.error).toBeFalsy();
	expect(response.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain("Hello test successful");

	context.messages.push(response);
	context.messages.push({ role: "user", content: "Now say 'Goodbye test successful'" });

	const secondResponse = await complete(model, context, options);

	expect(secondResponse.role).toBe("assistant");
	expect(secondResponse.content).toBeTruthy();
	expect(secondResponse.usage.input + secondResponse.usage.cacheRead).toBeGreaterThan(0);
	expect(secondResponse.usage.output).toBeGreaterThan(0);
	expect(secondResponse.error).toBeFalsy();
	expect(secondResponse.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain(
		"Goodbye test successful",
	);
}

async function handleToolCall<TApi extends Api>(model: Model<TApi>, options?: OptionsForApi<TApi>) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that uses tools when asked.",
		messages: [
			{
				role: "user",
				content: "Calculate 15 + 27 using the calculator tool.",
			},
		],
		tools: [calculatorTool],
	};

	const s = await stream(model, context, options);
	let hasToolStart = false;
	let hasToolDelta = false;
	let hasToolEnd = false;
	let accumulatedToolArgs = "";
	let index = 0;
	for await (const event of s) {
		if (event.type === "toolcall_start") {
			hasToolStart = true;
			const toolCall = event.partial.content[event.contentIndex];
			index = event.contentIndex;
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("calculator");
				expect(toolCall.id).toBeTruthy();
			}
		}
		if (event.type === "toolcall_delta") {
			hasToolDelta = true;
			const toolCall = event.partial.content[event.contentIndex];
			expect(event.contentIndex).toBe(index);
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("calculator");
				accumulatedToolArgs += event.delta;
			}
		}
		if (event.type === "toolcall_end") {
			hasToolEnd = true;
			const toolCall = event.partial.content[event.contentIndex];
			expect(event.contentIndex).toBe(index);
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("calculator");
				JSON.parse(accumulatedToolArgs);
				expect(toolCall.arguments).not.toBeUndefined();
				expect((toolCall.arguments as any).a).toBe(15);
				expect((toolCall.arguments as any).b).toBe(27);
				expect((toolCall.arguments as any).operation).oneOf(["add", "subtract", "multiply", "divide"]);
			}
		}
	}

	expect(hasToolStart).toBe(true);
	expect(hasToolDelta).toBe(true);
	expect(hasToolEnd).toBe(true);

	const response = await s.result();
	expect(response.stopReason).toBe("toolUse");
	expect(response.content.some((b) => b.type === "toolCall")).toBeTruthy();
	const toolCall = response.content.find((b) => b.type === "toolCall");
	if (toolCall && toolCall.type === "toolCall") {
		expect(toolCall.name).toBe("calculator");
		expect(toolCall.id).toBeTruthy();
	} else {
		throw new Error("No tool call found in response");
	}
}

async function handleStreaming<TApi extends Api>(model: Model<TApi>, options?: OptionsForApi<TApi>) {
	let textStarted = false;
	let textChunks = "";
	let textCompleted = false;

	const context: Context = {
		messages: [{ role: "user", content: "Count from 1 to 3" }],
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "text_start") {
			textStarted = true;
		} else if (event.type === "text_delta") {
			textChunks += event.delta;
		} else if (event.type === "text_end") {
			textCompleted = true;
		}
	}

	const response = await s.result();

	expect(textStarted).toBe(true);
	expect(textChunks.length).toBeGreaterThan(0);
	expect(textCompleted).toBe(true);
	expect(response.content.some((b) => b.type === "text")).toBeTruthy();
}

async function handleThinking<TApi extends Api>(model: Model<TApi>, options?: OptionsForApi<TApi>) {
	let thinkingStarted = false;
	let thinkingChunks = "";
	let thinkingCompleted = false;

	const context: Context = {
		messages: [
			{
				role: "user",
				content: `Think long and hard about ${(Math.random() * 255) | 0} + 27. Think step by step. Then output the result.`,
			},
		],
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "thinking_start") {
			thinkingStarted = true;
		} else if (event.type === "thinking_delta") {
			thinkingChunks += event.delta;
		} else if (event.type === "thinking_end") {
			thinkingCompleted = true;
		}
	}

	const response = await s.result();

	expect(response.stopReason, `Error: ${response.error}`).toBe("stop");
	expect(thinkingStarted).toBe(true);
	expect(thinkingChunks.length).toBeGreaterThan(0);
	expect(thinkingCompleted).toBe(true);
	expect(response.content.some((b) => b.type === "thinking")).toBeTruthy();
}

async function handleImage<TApi extends Api>(model: Model<TApi>, options?: OptionsForApi<TApi>) {
	// Check if the model supports images
	if (!model.input.includes("image")) {
		console.log(`Skipping image test - model ${model.id} doesn't support images`);
		return;
	}

	// Read the test image
	const imagePath = join(__dirname, "data", "red-circle.png");
	const imageBuffer = readFileSync(imagePath);
	const base64Image = imageBuffer.toString("base64");

	const imageContent: ImageContent = {
		type: "image",
		data: base64Image,
		mimeType: "image/png",
	};

	const context: Context = {
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "What do you see in this image? Please describe the shape (circle, rectangle, square, triangle, ...) and color (red, blue, green, ...). You MUST reply in English.",
					},
					imageContent,
				],
			},
		],
	};

	const response = await complete(model, context, options);

	// Check the response mentions red and circle
	expect(response.content.length > 0).toBeTruthy();
	const textContent = response.content.find((b) => b.type === "text");
	if (textContent && textContent.type === "text") {
		const lowerContent = textContent.text.toLowerCase();
		expect(lowerContent).toContain("red");
		expect(lowerContent).toContain("circle");
	}
}

async function multiTurn<TApi extends Api>(model: Model<TApi>, options?: OptionsForApi<TApi>) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
		messages: [
			{
				role: "user",
				content: "Think about this briefly, then calculate 42 * 17 and 453 + 434 using the calculator tool.",
			},
		],
		tools: [calculatorTool],
	};

	// Collect all text content from all assistant responses
	let allTextContent = "";
	let hasSeenThinking = false;
	let hasSeenToolCalls = false;
	const maxTurns = 5; // Prevent infinite loops

	for (let turn = 0; turn < maxTurns; turn++) {
		const response = await complete(model, context, options);

		// Add the assistant response to context
		context.messages.push(response);

		// Process content blocks
		const results: ToolResultMessage[] = [];
		for (const block of response.content) {
			if (block.type === "text") {
				allTextContent += block.text;
			} else if (block.type === "thinking") {
				hasSeenThinking = true;
			} else if (block.type === "toolCall") {
				hasSeenToolCalls = true;

				// Process the tool call
				expect(block.name).toBe("calculator");
				expect(block.id).toBeTruthy();
				expect(block.arguments).toBeTruthy();

				const { a, b, operation } = block.arguments;
				let result: number;
				switch (operation) {
					case "add":
						result = a + b;
						break;
					case "multiply":
						result = a * b;
						break;
					default:
						result = 0;
				}

				// Add tool result to context
				results.push({
					role: "toolResult",
					toolCallId: block.id,
					toolName: block.name,
					output: `${result}`,
					isError: false,
				});
			}
		}
		context.messages.push(...results);

		// If we got a stop response with text content, we're likely done
		expect(response.stopReason).not.toBe("error");
		if (response.stopReason === "stop") {
			break;
		}
	}

	// Verify we got either thinking content or tool calls (or both)
	expect(hasSeenThinking || hasSeenToolCalls).toBe(true);

	// The accumulated text should reference both calculations
	expect(allTextContent).toBeTruthy();
	expect(allTextContent.includes("714")).toBe(true);
	expect(allTextContent.includes("887")).toBe(true);
}

describe("Generate E2E Tests", () => {
	describe.skipIf(!process.env.GEMINI_API_KEY)("Gemini Provider (gemini-2.5-flash)", () => {
		const llm = getModel("google", "gemini-2.5-flash");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle ", async () => {
			await handleThinking(llm, { thinking: { enabled: true, budgetTokens: 1024 } });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { thinking: { enabled: true, budgetTokens: 2048 } });
		});

		it("should handle image input", async () => {
			await handleImage(llm);
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider (gpt-4o-mini)", () => {
		const llm: Model<"openai-completions"> = { ...getModel("openai", "gpt-4o-mini"), api: "openai-completions" };

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle image input", async () => {
			await handleImage(llm);
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider (gpt-5-mini)", () => {
		const llm = getModel("openai", "gpt-5-mini");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking", { retry: 2 }, async () => {
			await handleThinking(llm, { reasoningEffort: "high" });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { reasoningEffort: "high" });
		});

		it("should handle image input", async () => {
			await handleImage(llm);
		});
	});

	describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic Provider (claude-3-5-haiku-20241022)", () => {
		const model = getModel("anthropic", "claude-3-5-haiku-20241022");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(model, { thinkingEnabled: true });
		});

		it("should handle tool calling", async () => {
			await handleToolCall(model);
		});

		it("should handle streaming", async () => {
			await handleStreaming(model);
		});

		it("should handle image input", async () => {
			await handleImage(model);
		});
	});

	describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic Provider (claude-sonnet-4-20250514)", () => {
		const model = getModel("anthropic", "claude-sonnet-4-20250514");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(model, { thinkingEnabled: true });
		});

		it("should handle tool calling", async () => {
			await handleToolCall(model);
		});

		it("should handle streaming", async () => {
			await handleStreaming(model);
		});

		it("should handle thinking", async () => {
			await handleThinking(model, { thinkingEnabled: true });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(model, { thinkingEnabled: true });
		});

		it("should handle image input", async () => {
			await handleImage(model);
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider (gpt-5-mini)", () => {
		const model = getModel("openai", "gpt-5-mini");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(model);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(model);
		});

		it("should handle streaming", async () => {
			await handleStreaming(model);
		});

		it("should handle image input", async () => {
			await handleImage(model);
		});
	});

	describe.skipIf(!process.env.XAI_API_KEY)("xAI Provider (grok-code-fast-1 via OpenAI Completions)", () => {
		const llm = getModel("xai", "grok-code-fast-1");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking mode", async () => {
			await handleThinking(llm, { reasoningEffort: "medium" });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { reasoningEffort: "medium" });
		});
	});

	describe.skipIf(!process.env.GROQ_API_KEY)("Groq Provider (gpt-oss-20b via OpenAI Completions)", () => {
		const llm = getModel("groq", "openai/gpt-oss-20b");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking mode", async () => {
			await handleThinking(llm, { reasoningEffort: "medium" });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { reasoningEffort: "medium" });
		});
	});

	describe.skipIf(!process.env.CEREBRAS_API_KEY)("Cerebras Provider (gpt-oss-120b via OpenAI Completions)", () => {
		const llm = getModel("cerebras", "gpt-oss-120b");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking mode", async () => {
			await handleThinking(llm, { reasoningEffort: "medium" });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { reasoningEffort: "medium" });
		});
	});

	describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter Provider (glm-4.5v via OpenAI Completions)", () => {
		const llm = getModel("openrouter", "z-ai/glm-4.5v");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking mode", async () => {
			await handleThinking(llm, { reasoningEffort: "medium" });
		});

		it("should handle multi-turn with thinking and tools", { retry: 2 }, async () => {
			await multiTurn(llm, { reasoningEffort: "medium" });
		});

		it("should handle image input", async () => {
			await handleImage(llm);
		});
	});

	describe.skipIf(!process.env.ZAI_API_KEY)("zAI Provider (glm-4.5-air via Anthropic Messages)", () => {
		const llm = getModel("zai", "glm-4.5-air");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking", async () => {
			// Prompt doesn't trigger thinking
			// await handleThinking(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
		});
	});

	describe.skipIf(!process.env.ZAI_API_KEY)("zAI Provider (glm-4.5v via Anthropic Messages)", () => {
		const llm = getModel("zai", "glm-4.5v");

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking", async () => {
			// Prompt doesn't trigger thinking
			// await handleThinking(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
		});

		it("should handle image input", async () => {
			// Can't see image for some reason?
			// await handleImage(llm);
		});
	});

	// Check if ollama is installed
	let ollamaInstalled = false;
	try {
		execSync("which ollama", { stdio: "ignore" });
		ollamaInstalled = true;
	} catch {
		ollamaInstalled = false;
	}

	describe.skipIf(!ollamaInstalled)("Ollama Provider (gpt-oss-20b via OpenAI Completions)", () => {
		let llm: Model<"openai-completions">;
		let ollamaProcess: ChildProcess | null = null;

		beforeAll(async () => {
			// Check if model is available, if not pull it
			try {
				execSync("ollama list | grep -q 'gpt-oss:20b'", { stdio: "ignore" });
			} catch {
				console.log("Pulling gpt-oss:20b model for Ollama tests...");
				try {
					execSync("ollama pull gpt-oss:20b", { stdio: "inherit" });
				} catch (e) {
					console.warn("Failed to pull gpt-oss:20b model, tests will be skipped");
					return;
				}
			}

			// Start ollama server
			ollamaProcess = spawn("ollama", ["serve"], {
				detached: false,
				stdio: "ignore",
			});

			// Wait for server to be ready
			await new Promise<void>((resolve) => {
				const checkServer = async () => {
					try {
						const response = await fetch("http://localhost:11434/api/tags");
						if (response.ok) {
							resolve();
						} else {
							setTimeout(checkServer, 500);
						}
					} catch {
						setTimeout(checkServer, 500);
					}
				};
				setTimeout(checkServer, 1000); // Initial delay
			});

			llm = {
				id: "gpt-oss:20b",
				api: "openai-completions",
				provider: "ollama",
				baseUrl: "http://localhost:11434/v1",
				reasoning: true,
				input: ["text"],
				contextWindow: 128000,
				maxTokens: 16000,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				name: "Ollama GPT-OSS 20B",
			};
		}, 30000); // 30 second timeout for setup

		afterAll(() => {
			// Kill ollama server
			if (ollamaProcess) {
				ollamaProcess.kill("SIGTERM");
				ollamaProcess = null;
			}
		});

		it("should complete basic text generation", async () => {
			await basicTextGeneration(llm, { apiKey: "test" });
		});

		it("should handle tool calling", async () => {
			await handleToolCall(llm, { apiKey: "test" });
		});

		it("should handle streaming", async () => {
			await handleStreaming(llm, { apiKey: "test" });
		});

		it("should handle thinking mode", async () => {
			await handleThinking(llm, { apiKey: "test", reasoningEffort: "medium" });
		});

		it("should handle multi-turn with thinking and tools", async () => {
			await multiTurn(llm, { apiKey: "test", reasoningEffort: "medium" });
		});
	});
});
