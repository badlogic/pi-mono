import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAIResponses } from "../src/providers/openai-responses.js";
import type { Context, Model, ToolCall, Usage } from "../src/types.js";

const { OpenAIConstructor, responsesCreateMock } = vi.hoisted(() => {
	const responsesCreateMock = vi.fn();
	const OpenAIConstructor = vi.fn().mockImplementation(() => ({
		responses: {
			create: responsesCreateMock,
		},
	}));
	return { OpenAIConstructor, responsesCreateMock };
});

vi.mock("openai", () => ({
	default: OpenAIConstructor,
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe("openai-responses streaming", () => {
	it("streams OpenAI Responses events into AssistantMessageEventStream", async () => {
		const events = [
			{
				type: "response.output_item.added",
				item: {
					type: "reasoning",
					id: "reason_1",
					summary: [],
				},
			},
			{
				type: "response.reasoning_summary_part.added",
				part: { type: "summary_text", text: "" },
			},
			{
				type: "response.reasoning_summary_text.delta",
				delta: "Thinking...",
			},
			{
				type: "response.reasoning_summary_part.done",
			},
			{
				type: "response.output_item.done",
				item: {
					type: "reasoning",
					id: "reason_1",
					summary: [{ type: "summary_text", text: "Thinking...\n\n" }],
				},
			},
			{
				type: "response.output_item.added",
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "in_progress",
					content: [],
				},
			},
			{
				type: "response.content_part.added",
				part: { type: "output_text", text: "" },
			},
			{
				type: "response.output_text.delta",
				delta: "Hello",
			},
			{
				type: "response.output_item.done",
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "Hello" }],
				},
			},
			{
				type: "response.output_item.added",
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "calculate",
					arguments: "",
				},
			},
			{
				type: "response.function_call_arguments.delta",
				delta: '{"expression":"25 *',
			},
			{
				type: "response.function_call_arguments.delta",
				delta: ' 18"}',
			},
			{
				type: "response.output_item.done",
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "calculate",
					arguments: '{"expression":"25 * 18"}',
				},
			},
			{
				type: "response.completed",
				response: {
					status: "completed",
					usage: {
						input_tokens: 10,
						output_tokens: 5,
						total_tokens: 15,
						input_tokens_details: { cached_tokens: 2 },
					},
				},
			},
		] as const;

		async function* eventStream(): AsyncGenerator<(typeof events)[number]> {
			for (const event of events) {
				yield event;
			}
		}

		responsesCreateMock.mockResolvedValue(eventStream());

		const model: Model<"openai-responses"> = {
			id: "gpt-test",
			name: "gpt-test",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const stream = streamOpenAIResponses(model, context, { apiKey: "sk-test" });

		const seenTypes: string[] = [];
		let sawThinkingStart = false;
		let sawThinkingDelta = false;
		let sawThinkingEnd = false;
		let sawTextStart = false;
		let sawTextDelta = false;
		let sawTextEnd = false;
		let sawToolStart = false;
		let sawToolDelta = false;
		let sawToolEnd = false;
		let sawDone = false;

		let firstToolDeltaPartial: ToolCall | null = null;
		let finalUsage: Usage | null = null;

		for await (const event of stream) {
			seenTypes.push(event.type);

			if (event.type === "thinking_start") {
				sawThinkingStart = true;
				expect(event.contentIndex).toBe(0);
			}
			if (event.type === "thinking_delta") {
				sawThinkingDelta = true;
			}
			if (event.type === "thinking_end") {
				sawThinkingEnd = true;
				expect(event.content).toBe("Thinking...\n\n");
			}

			if (event.type === "text_start") {
				sawTextStart = true;
				expect(event.contentIndex).toBe(1);
			}
			if (event.type === "text_delta") {
				sawTextDelta = true;
			}
			if (event.type === "text_end") {
				sawTextEnd = true;
				expect(event.content).toBe("Hello");
			}

			if (event.type === "toolcall_start") {
				sawToolStart = true;
				expect(event.contentIndex).toBe(2);
			}
			if (event.type === "toolcall_delta") {
				sawToolDelta = true;
				if (!firstToolDeltaPartial) {
					const block = event.partial.content[event.contentIndex];
					expect(block.type).toBe("toolCall");
					firstToolDeltaPartial = block as ToolCall;
				}
			}
			if (event.type === "toolcall_end") {
				sawToolEnd = true;
				expect(event.toolCall.name).toBe("calculate");
				expect(event.toolCall.arguments).toEqual({ expression: "25 * 18" });
			}

			if (event.type === "done") {
				sawDone = true;
				expect(event.message.stopReason).toBe("toolUse");
				finalUsage = event.message.usage;
			}
		}

		expect(sawThinkingStart).toBe(true);
		expect(sawThinkingDelta).toBe(true);
		expect(sawThinkingEnd).toBe(true);
		expect(sawTextStart).toBe(true);
		expect(sawTextDelta).toBe(true);
		expect(sawTextEnd).toBe(true);
		expect(sawToolStart).toBe(true);
		expect(sawToolDelta).toBe(true);
		expect(sawToolEnd).toBe(true);
		expect(sawDone).toBe(true);

		expect(seenTypes.indexOf("thinking_start")).toBeLessThan(seenTypes.indexOf("thinking_end"));
		expect(seenTypes.indexOf("text_start")).toBeLessThan(seenTypes.indexOf("text_end"));
		expect(seenTypes.indexOf("toolcall_start")).toBeLessThan(seenTypes.indexOf("toolcall_end"));

		expect(firstToolDeltaPartial).not.toBeNull();
		const firstArgs = firstToolDeltaPartial!.arguments as Record<string, unknown>;
		const expr = firstArgs.expression;
		expect(typeof expr).toBe("string");
		expect(expr).toContain("25");

		expect(finalUsage).toMatchObject({ input: 8, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 15 });
	});
});
