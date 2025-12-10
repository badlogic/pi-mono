import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete } from "../src/stream.js";
import type { Context, Tool } from "../src/types.js";

const weatherSchema = Type.Object({
	location: Type.String({ description: "City name" }),
});

const weatherTool: Tool<typeof weatherSchema> = {
	name: "get_weather",
	description: "Get weather",
	parameters: weatherSchema,
};

const testToolSchema = Type.Object({});

const testTool: Tool<typeof testToolSchema> = {
	name: "test_tool",
	description: "A test tool",
	parameters: testToolSchema,
};

describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Debug", () => {
	const model = getModel("openai", "gpt-4o-mini");

	it("tool call + result + follow-up user", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Check weather", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [
						{ type: "toolCall", id: "call_abc123", name: "get_weather", arguments: { location: "Tokyo" } },
					],
					provider: "openai",
					model: "gpt-4o-mini",
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
				},
				{
					role: "toolResult",
					toolCallId: "call_abc123",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Tokyo: 18°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				{ role: "user", content: "What was the temperature?", timestamp: Date.now() },
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});
});

describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral Debug", () => {
	const model = getModel("mistral", "devstral-medium-latest");

	it("two subsequent user messages", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Hello", timestamp: Date.now() },
				{ role: "user", content: "How are you?", timestamp: Date.now() },
			],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("aborted assistant then user message", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Hello", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [],
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
				{ role: "user", content: "How are you?", timestamp: Date.now() },
			],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("three consecutive user messages (simulating aborted assistant skipped)", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Hello", timestamp: Date.now() },
				{ role: "user", content: "Ran some command", timestamp: Date.now() },
				{ role: "user", content: "How are you?", timestamp: Date.now() },
			],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("reproduce 502 from session fixture", async () => {
		const fs = await import("fs");
		const path = await import("path");
		const fixtureData = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/mistral.json"), "utf-8"));
		// Filter out bashExecution and convert to user message like messageTransformer does
		const messages = fixtureData.map((m: any) => {
			if (m.role === "bashExecution") {
				let text = `Ran \`${m.command}\`\n`;
				if (m.output) {
					text += "```\n" + m.output + "\n```";
				} else {
					text += "(no output)";
				}
				return { role: "user", content: [{ type: "text", text }], timestamp: m.timestamp };
			}
			return m;
		});
		const context: Context = {
			messages,
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5d. two tool calls + results, no follow-up user", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Check weather in Tokyo and Paris", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [
						{ type: "toolCall", id: "T7TcP5RVB", name: "get_weather", arguments: { location: "Tokyo" } },
						{ type: "toolCall", id: "X8UdQ6SWC", name: "get_weather", arguments: { location: "Paris" } },
					],
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
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "T7TcP5RVB",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Tokyo: 18°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "X8UdQ6SWC",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Paris: 22°C" }],
					isError: false,
					timestamp: Date.now(),
				},
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5e. two tool calls + results + user follow-up", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Check weather in Tokyo and Paris", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [
						{ type: "toolCall", id: "T7TcP5RVB", name: "get_weather", arguments: { location: "Tokyo" } },
						{ type: "toolCall", id: "X8UdQ6SWC", name: "get_weather", arguments: { location: "Paris" } },
					],
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
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "T7TcP5RVB",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Tokyo: 18°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "X8UdQ6SWC",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Paris: 22°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				{ role: "user", content: "Which is warmer?", timestamp: Date.now() },
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5f. workaround: convert tool results to assistant text before user follow-up", async () => {
		// Mistral doesn't allow user after tool_result
		// Workaround: merge tool results into an assistant message
		const context: Context = {
			messages: [
				{ role: "user", content: "Check weather in Tokyo and Paris", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [
						{ type: "toolCall", id: "T7TcP5RVB", name: "get_weather", arguments: { location: "Tokyo" } },
						{ type: "toolCall", id: "X8UdQ6SWC", name: "get_weather", arguments: { location: "Paris" } },
					],
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
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "T7TcP5RVB",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Tokyo: 18°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "X8UdQ6SWC",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Paris: 22°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				// Add an assistant message BEFORE the user follow-up
				{
					role: "assistant",
					api: "openai-completions",
					content: [{ type: "text", text: "I found the weather for both cities." }],
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
					stopReason: "stop",
					timestamp: Date.now(),
				},
				{ role: "user", content: "Which is warmer?", timestamp: Date.now() },
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5h. emoji in tool result", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Use the test tool", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [{ type: "toolCall", id: "test_1", name: "test_tool", arguments: {} }],
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
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "test_1",
					toolName: "test_tool",
					content: [{ type: "text", text: "Result without emoji: hello world" }],
					isError: false,
					timestamp: Date.now(),
				},
				{ role: "user", content: "What did the tool return?", timestamp: Date.now() },
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5g. thinking block from another provider", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "What is 2+2?", timestamp: Date.now() },
				{
					role: "assistant",
					api: "anthropic-messages",
					content: [
						{ type: "thinking", thinking: "Let me calculate 2+2. That equals 4.", thinkingSignature: "sig_abc" },
						{ type: "text", text: "The answer is 4." },
					],
					provider: "anthropic",
					model: "claude-3-5-haiku",
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
				},
				{ role: "user", content: "What about 3+3?", timestamp: Date.now() },
			],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5a. tool call + result, no follow-up user message", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Check weather in Tokyo", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [{ type: "toolCall", id: "T7TcP5RVB", name: "get_weather", arguments: { location: "Tokyo" } }],
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
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "T7TcP5RVB",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Tokyo: 18°C" }],
					isError: false,
					timestamp: Date.now(),
				},
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5b. tool call + result (no text in assistant)", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Check weather", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [{ type: "toolCall", id: "T7TcP5RVB", name: "get_weather", arguments: { location: "Tokyo" } }],
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
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "T7TcP5RVB",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Tokyo: 18°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				{ role: "user", content: "What was the temperature?", timestamp: Date.now() },
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});

	it("5c. tool call + result (WITH text in assistant)", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Check weather", timestamp: Date.now() },
				{
					role: "assistant",
					api: "openai-completions",
					content: [
						{ type: "text", text: "Let me check the weather." },
						{ type: "toolCall", id: "T7TcP5RVB", name: "get_weather", arguments: { location: "Tokyo" } },
					],
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
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "T7TcP5RVB",
					toolName: "get_weather",
					content: [{ type: "text", text: "Weather in Tokyo: 18°C" }],
					isError: false,
					timestamp: Date.now(),
				},
				{ role: "user", content: "What was the temperature?", timestamp: Date.now() },
			],
			tools: [weatherTool],
		};
		const response = await complete(model, context);
		console.log("Response:", response.stopReason, response.errorMessage);
		expect(response.stopReason).not.toBe("error");
	});
});
