import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent/agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentTool, QueuedMessage } from "../src/agent/types.js";
import type { AssistantMessage, Message, Model, UserMessage } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

describe("agentLoop queued message interrupt", () => {
	it("injects queued messages after a tool call and skips remaining tool calls", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed.push(params.value);
				return {
					content: [{ type: "text", text: `ok:${params.value}` }],
					details: { value: params.value },
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const userPrompt: UserMessage = {
			role: "user",
			content: "start",
			timestamp: Date.now(),
		};

		const queuedUserMessage: Message = {
			role: "user",
			content: "interrupt",
			timestamp: Date.now(),
		};
		const queuedMessages: QueuedMessage<Message>[] = [{ original: queuedUserMessage, llm: queuedUserMessage }];

		let queuedDelivered = false;
		let sawInterruptInContext = false;
		let callIndex = 0;

		const streamFn = () => {
			const stream = new AssistantMessageEventStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					const message: AssistantMessage = {
						role: "assistant",
						content: [
							{ type: "toolCall", id: "tool-1", name: "echo", arguments: { value: "first" } },
							{ type: "toolCall", id: "tool-2", name: "echo", arguments: { value: "second" } },
						],
						api: "openai-responses",
						provider: "openai",
						model: "mock",
						usage: createUsage(),
						stopReason: "toolUse",
						timestamp: Date.now(),
					};
					stream.push({ type: "done", reason: "toolUse", message });
				} else {
					const message: AssistantMessage = {
						role: "assistant",
						content: [{ type: "text", text: "done" }],
						api: "openai-responses",
						provider: "openai",
						model: "mock",
						usage: createUsage(),
						stopReason: "stop",
						timestamp: Date.now(),
					};
					stream.push({ type: "done", reason: "stop", message });
				}
				callIndex += 1;
			});
			return stream;
		};

		const getQueuedMessages: AgentLoopConfig["getQueuedMessages"] = async <T>() => {
			if (executed.length === 1 && !queuedDelivered) {
				queuedDelivered = true;
				return queuedMessages as QueuedMessage<T>[];
			}
			return [];
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			getQueuedMessages,
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop(userPrompt, context, config, undefined, (_model, ctx, _options) => {
			if (callIndex === 1) {
				sawInterruptInContext = ctx.messages.some(
					(m) => m.role === "user" && typeof m.content === "string" && m.content === "interrupt",
				);
			}
			return streamFn();
		});

		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toEqual(["first"]);
		const toolEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "tool_execution_end" }> => event.type === "tool_execution_end",
		);
		expect(toolEnds.length).toBe(2);
		expect(toolEnds[1].isError).toBe(true);
		expect(toolEnds[1].result.content[0]?.type).toBe("text");
		if (toolEnds[1].result.content[0]?.type === "text") {
			expect(toolEnds[1].result.content[0].text).toContain("Skipped due to queued user message");
		}

		const firstTurnEndIndex = events.findIndex((event) => event.type === "turn_end");
		const queuedMessageIndex = events.findIndex(
			(event) =>
				event.type === "message_start" &&
				event.message.role === "user" &&
				typeof event.message.content === "string" &&
				event.message.content === "interrupt",
		);
		const nextAssistantIndex = events.findIndex(
			(event, index) =>
				index > queuedMessageIndex && event.type === "message_start" && event.message.role === "assistant",
		);

		expect(queuedMessageIndex).toBeGreaterThan(firstTurnEndIndex);
		expect(queuedMessageIndex).toBeLessThan(nextAssistantIndex);
		expect(sawInterruptInContext).toBe(true);
	});
});
