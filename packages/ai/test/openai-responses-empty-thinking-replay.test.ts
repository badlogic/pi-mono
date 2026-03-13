import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { convertResponsesMessages } from "../src/providers/openai-responses-shared.js";
import type { AssistantMessage, Context, Message } from "../src/types.js";

describe("OpenAI Responses empty-thinking replay", () => {
	it("drops fc_* function_call item id when thinking block has no replayable signature", () => {
		const model = getModel("openai", "gpt-5-mini");

		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "" },
				{ type: "toolCall", id: "call_abc|fc_123", name: "read", arguments: { path: "README.md" } },
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5-mini",
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

		const context: Context = {
			messages: [
				{ role: "user", content: "check file", timestamp: Date.now() - 1000 } as Message,
				assistant,
			],
		};

		const input = convertResponsesMessages(model, context, new Set(["openai"]));
		const functionCall = input.find((item) => item.type === "function_call");

		expect(functionCall).toBeDefined();
		expect(functionCall?.type).toBe("function_call");
		if (functionCall?.type === "function_call") {
			expect(functionCall.call_id).toBe("call_abc");
			expect(functionCall.id).toBeUndefined();
		}
	});
});
