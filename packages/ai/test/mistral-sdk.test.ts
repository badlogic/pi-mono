import { Mistral } from "@mistralai/mistralai";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral SDK Direct", () => {
	const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

	it("tool call + result + user follow-up", async () => {
		const response = await client.chat.complete({
			model: "devstral-medium-latest",
			messages: [
				{ role: "user", content: "Check the weather" },
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "T7TcP5RVB",
							type: "function",
							function: {
								name: "get_weather",
								arguments: JSON.stringify({ location: "Tokyo" }),
							},
						},
					],
				},
				{
					role: "tool",
					name: "get_weather",
					content: "Weather in Tokyo: 18°C",
					toolCallId: "T7TcP5RVB",
				},
				{ role: "user", content: "What was the temperature?" },
			],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get weather for a location",
						parameters: {
							type: "object",
							properties: {
								location: { type: "string" },
							},
						},
					},
				},
			],
		});

		console.log("Response:", JSON.stringify(response, null, 2));
		expect(response.choices?.[0]?.finishReason).not.toBe("error");
	});

	it("emoji in tool result (no user follow-up)", async () => {
		const response = await client.chat.complete({
			model: "devstral-medium-latest",
			messages: [
				{ role: "user", content: "Use the test tool" },
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "T7TcP5RVB",
							type: "function",
							function: {
								name: "test_tool",
								arguments: "{}",
							},
						},
					],
				},
				{
					role: "tool",
					name: "test_tool",
					content: `Test with emoji 🙈 and other characters:
- Monkey emoji: 🙈
- Thumbs up: 👍
- Heart: ❤️
- Thinking face: 🤔
- Rocket: 🚀
- Mixed text: Mario Zechner wann? Wo? Bin grad äußersr eventuninformiert 🙈
- Japanese: こんにちは
- Chinese: 你好
- Mathematical symbols: ∑∫∂√
- Special quotes: "curly" 'quotes'`,
					toolCallId: "T7TcP5RVB",
				},
			],
			tools: [
				{
					type: "function",
					function: {
						name: "test_tool",
						description: "A test tool",
						parameters: {
							type: "object",
							properties: {},
						},
					},
				},
			],
		});

		console.log("Response:", JSON.stringify(response, null, 2));
		// Model might make another tool call or stop - either is fine, we're testing emoji handling
		expect(response.choices?.[0]?.finishReason).toMatch(/stop|tool_calls/);
	});

	it("emoji in tool result WITH assistant bridge + user follow-up", async () => {
		const response = await client.chat.complete({
			model: "devstral-medium-latest",
			messages: [
				{ role: "user", content: "Use the test tool" },
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "T7TcP5RVB",
							type: "function",
							function: {
								name: "test_tool",
								arguments: "{}",
							},
						},
					],
				},
				{
					role: "tool",
					name: "test_tool",
					content: "Result with emoji: 🙈👍❤️",
					toolCallId: "T7TcP5RVB",
				},
				{ role: "assistant", content: "I have processed the tool results." },
				{ role: "user", content: "Summarize the tool result" },
			],
			tools: [
				{
					type: "function",
					function: {
						name: "test_tool",
						description: "A test tool",
						parameters: {
							type: "object",
							properties: {},
						},
					},
				},
			],
		});

		console.log("Response:", JSON.stringify(response, null, 2));
		expect(response.choices?.[0]?.finishReason).toMatch(/stop|tool_calls/);
	});

	it("exact payload from unicode test", async () => {
		const response = await client.chat.complete({
			model: "devstral-medium-latest",
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Use the test tool" },
				{
					role: "assistant",
					content: "",
					toolCalls: [
						{
							id: "test1",
							type: "function",
							function: {
								name: "test_tool",
								arguments: "{}",
							},
						},
					],
				},
				{
					role: "tool",
					name: "test_tool",
					content: `Test with emoji 🙈 and other characters:
- Monkey emoji: 🙈
- Thumbs up: 👍
- Heart: ❤️
- Thinking face: 🤔
- Rocket: 🚀
- Mixed text: Mario Zechner wann? Wo? Bin grad äußersr eventuninformiert 🙈
- Japanese: こんにちは
- Chinese: 你好
- Mathematical symbols: ∑∫∂√
- Special quotes: "curly" 'quotes'`,
					toolCallId: "test1",
				},
				{ role: "assistant", content: "I have processed the tool results." },
				{ role: "user", content: "Summarize the tool result briefly." },
			],
			tools: [
				{
					type: "function",
					function: {
						name: "test_tool",
						description: "A test tool",
						parameters: {
							type: "object",
							properties: {},
						},
					},
				},
			],
		});

		console.log("Response:", JSON.stringify(response, null, 2));
		expect(response.choices?.[0]?.finishReason).toMatch(/stop|tool_calls/);
	});
});
