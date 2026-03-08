import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "../src/types.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

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

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	);
}

describe("agentLoop tool result durations", () => {
	it("persists tool execution duration in tool result details", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [
				{
					name: "echo",
					label: "echo",
					description: "Echo text",
					parameters: Type.Object({ text: Type.String() }),
					async execute(_toolCallId: string, params: { text: string }) {
						await new Promise((resolve) => setTimeout(resolve, 15));
						return {
							content: [{ type: "text" as const, text: params.text }],
							details: { echoed: true },
						};
					},
				},
			],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message =
					callIndex++ === 0
						? createAssistantMessage(
								[{ type: "toolCall", id: "tool-1", name: "echo", arguments: { text: "hi" } }],
								"toolUse",
							)
						: createAssistantMessage([{ type: "text", text: "done" }]);
				stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([createUserMessage("hello")], context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}

		const toolExecutionEnd = events.find((event) => event.type === "tool_execution_end");
		expect(toolExecutionEnd).toBeDefined();
		if (!toolExecutionEnd || toolExecutionEnd.type !== "tool_execution_end") {
			throw new Error("Expected tool_execution_end event");
		}
		expect(toolExecutionEnd.result.details).toMatchObject({ echoed: true });
		expect(toolExecutionEnd.result.details).toHaveProperty("durationMs");
		expect(typeof (toolExecutionEnd.result.details as { durationMs?: unknown }).durationMs).toBe("number");
		expect((toolExecutionEnd.result.details as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(10);

		const messages = await stream.result();
		const toolResult = messages.find((message) => message.role === "toolResult");
		expect(toolResult).toBeDefined();
		if (!toolResult || toolResult.role !== "toolResult") {
			throw new Error("Expected toolResult message");
		}
		expect(toolResult.details).toMatchObject({ echoed: true });
		expect((toolResult.details as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(10);
	});
});
