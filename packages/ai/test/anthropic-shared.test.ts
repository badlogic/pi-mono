import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
	convertAnthropicMessages,
	convertAnthropicTools,
	mapAnthropicStopReason,
	sanitizeToolCallId,
} from "../src/providers/anthropic-shared.js";
import type { Message, Model, Tool } from "../src/types.js";

const baseModel: Model<"anthropic-messages"> = {
	id: "claude-test",
	name: "Claude Test",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 1000,
};

describe("anthropic-shared", () => {
	it("sanitizes tool call ids", () => {
		expect(sanitizeToolCallId("tool:call/1")).toBe("tool_call_1");
	});

	it("prefixes tool names", () => {
		const schema = Type.Object({ a: Type.Number() });
		const tools: Tool<typeof schema>[] = [{ name: "calculator", description: "calc", parameters: schema }];
		const converted = convertAnthropicTools(tools, { toolNamePrefix: "pi_" });
		expect(converted[0]?.name).toBe("pi_calculator");
	});

	it("adds cache_control to last user block by default", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
				timestamp: Date.now(),
			},
		];
		const converted = convertAnthropicMessages(messages, baseModel);
		const last = converted[converted.length - 1];
		if (!last || last.role !== "user" || typeof last.content === "string") {
			throw new Error("Expected user content blocks");
		}
		const lastBlock = last.content[last.content.length - 1];
		if (!lastBlock || !("cache_control" in lastBlock)) {
			throw new Error("Expected cache_control on last user block");
		}
		expect(lastBlock.cache_control?.type).toBe("ephemeral");
	});

	it("skips cache_control when disabled", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
				timestamp: Date.now(),
			},
		];
		const converted = convertAnthropicMessages(messages, baseModel, { addCacheControl: false });
		const last = converted[converted.length - 1];
		if (!last || last.role !== "user" || typeof last.content === "string") {
			throw new Error("Expected user content blocks");
		}
		const lastBlock = last.content[last.content.length - 1];
		expect(lastBlock && "cache_control" in lastBlock).toBe(false);
	});

	it("filters image blocks when model does not support images", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "describe" },
					{ type: "image", data: "abc", mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		];
		const converted = convertAnthropicMessages(messages, baseModel);
		const user = converted[0];
		if (!user || user.role !== "user" || typeof user.content === "string") {
			throw new Error("Expected user content blocks");
		}
		expect(user.content.every((block) => block.type === "text")).toBe(true);
	});

	it("converts thinking blocks without signatures to text", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "thoughts" },
					{ type: "text", text: "final" },
				],
				timestamp: Date.now(),
				api: "anthropic-messages",
				provider: "anthropic",
				model: baseModel.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
			},
		];
		const converted = convertAnthropicMessages(messages, baseModel);
		const assistant = converted[0];
		if (!assistant || assistant.role !== "assistant" || typeof assistant.content === "string") {
			throw new Error("Expected assistant content blocks");
		}
		expect(assistant.content.some((block) => block.type === "thinking")).toBe(false);
		expect(assistant.content.some((block) => block.type === "text" && block.text === "thoughts")).toBe(true);
	});

	it("maps stop reasons", () => {
		expect(mapAnthropicStopReason("end_turn")).toBe("stop");
		expect(mapAnthropicStopReason("max_tokens")).toBe("length");
		expect(mapAnthropicStopReason("tool_use")).toBe("toolUse");
		expect(mapAnthropicStopReason("refusal")).toBe("error");
	});
});
