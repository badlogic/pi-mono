import { describe, expect, it } from "vitest";
import { convertMessages as convertGoogleMessages } from "../src/api/google-shared.ts";
import { convertMessages as convertCompletionsMessages } from "../src/api/openai-completions.ts";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import { getModel } from "../src/compat.ts";
import type {
	AssistantMessage,
	Context,
	Model,
	OpenAICompletionsCompat,
	ToolResultMessage,
	Usage,
} from "../src/types.ts";

// Regression tests for #8720: whitespace-only tool output permanently bricks the session.
// Providers reject whitespace-only content with HTTP 400, so it must fall back to the
// "(no tool output)" placeholder, same as the already-handled empty-string case.

const emptyUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const compat: Omit<
	Required<OpenAICompletionsCompat>,
	"deferredToolsMode" | "thinkingTokenBudgetField" | "vllmPriority"
> & {
	deferredToolsMode?: OpenAICompletionsCompat["deferredToolsMode"];
	thinkingTokenBudgetField?: OpenAICompletionsCompat["thinkingTokenBudgetField"];
} = {
	supportsStore: true,
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	supportsFinishReason: true,
	maxTokensField: "max_completion_tokens",
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: false,
	requiresReasoningContentOnAssistantMessages: false,
	thinkingFormat: "openai",
	openRouterRouting: {},
	vercelGatewayRouting: {},
	chatTemplateKwargs: {},
	chatTemplateArgs: {},
	zaiToolStream: false,
	supportsThinkingTokenBudget: false,
	thinkingTokenBudgetField: undefined,
	supportsStrictMode: true,
	supportsOpenAIGrammarTools: false,
	cacheControlFormat: "anthropic",
	sendSessionAffinityHeaders: false,
	sessionAffinityFormat: "openai",
	supportsLongCacheRetention: true,
};

function buildWhitespaceToolResult(toolCallId: string, text: string, timestamp: number): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "bash",
		content: [{ type: "text", text }],
		isError: false,
		timestamp,
	};
}

const whitespaceVariants = [
	{ label: "\\r\\n", value: "\r\n" },
	{ label: "spaces", value: "   " },
	{ label: "\\n\\t", value: "\n\t" },
	{ label: "single newline", value: "\n" },
];

// #8720
describe("openai-completions: whitespace-only tool result uses placeholder", () => {
	for (const { label, value } of whitespaceVariants) {
		it(`falls back to "(no tool output)" for ${label}`, () => {
			const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
			const model: Model<"openai-completions"> = {
				...baseModel,
				api: "openai-completions",
				input: ["text"],
			};

			const now = Date.now();
			const assistant: AssistantMessage = {
				role: "assistant",
				content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "echo" } }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: emptyUsage,
				stopReason: "toolUse",
				timestamp: now,
			};

			const context: Context = {
				messages: [
					{ role: "user", content: "run it", timestamp: now - 1 },
					assistant,
					buildWhitespaceToolResult("tool-1", value, now + 1),
				],
			};

			const messages = convertCompletionsMessages(model, context, compat);
			const toolMessage = messages.find((m) => m.role === "tool") as { role: "tool"; content: string } | undefined;
			expect(toolMessage).toBeTruthy();
			expect(toolMessage?.content).toBe("(no tool output)");
		});
	}
});

// #8720
describe("openai-responses: whitespace-only tool result uses placeholder", () => {
	for (const { label, value } of whitespaceVariants) {
		it(`falls back to "(no tool output)" for ${label}`, () => {
			const model = getModel("openai", "gpt-4o-mini");
			const now = Date.now();
			const assistant: AssistantMessage = {
				role: "assistant",
				content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "echo" } }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: emptyUsage,
				stopReason: "toolUse",
				timestamp: now,
			};

			const context: Context = {
				messages: [
					{ role: "user", content: "run it", timestamp: now - 1 },
					assistant,
					buildWhitespaceToolResult("tool-1", value, now + 1),
				],
			};

			const input = convertResponsesMessages(model, context, new Set(["openai", "openai-codex", "opencode"]));
			const functionCallOutput = input.find((item) => item.type === "function_call_output") as
				| { type: "function_call_output"; output: string }
				| undefined;
			expect(functionCallOutput).toBeTruthy();
			expect(functionCallOutput?.output).toBe("(no tool output)");
		});
	}
});

// #8720
describe("google-shared: whitespace-only tool result uses empty string fallback", () => {
	for (const { label, value } of whitespaceVariants) {
		it(`falls back to empty string for ${label}`, () => {
			const model: Model<"google-generative-ai"> = {
				id: "gemini-2.5-flash",
				name: "gemini-2.5-flash",
				api: "google-generative-ai",
				provider: "google",
				baseUrl: "https://example.com",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			};

			const now = Date.now();
			const context: Context = {
				messages: [
					{ role: "user", content: "run it", timestamp: now },
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "echo" } }],
						api: model.api,
						provider: model.provider,
						model: model.id,
						usage: emptyUsage,
						stopReason: "toolUse",
						timestamp: now,
					},
					buildWhitespaceToolResult("call_1", value, now + 1),
				],
			};

			const contents = convertGoogleMessages(model, context);
			// The tool result should be in a model turn followed by a user turn with functionResponse
			const functionResponseTurn = contents.find(
				(c) => c.role === "user" && c.parts?.some((p: { functionResponse?: unknown }) => p.functionResponse),
			);
			expect(functionResponseTurn).toBeTruthy();
			const frPart = functionResponseTurn!.parts!.find(
				(p: { functionResponse?: unknown }) => p.functionResponse,
			) as { functionResponse: { response: { output?: string } } };
			// Google path uses empty string as the fallback for no-text tool results
			expect(frPart.functionResponse.response.output).toBe("");
		});
	}
});
