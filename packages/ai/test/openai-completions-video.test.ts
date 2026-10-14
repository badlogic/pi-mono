import { describe, expect, it, vi } from "vitest";
import { normalizeContext } from "../src/compat.ts";
import type { Model, OpenAICompletionsCompat } from "../src/types.ts";

vi.mock("../src/models.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/models.ts")>();
	return {
		...actual,
		calculateCost: vi.fn(),
		clampThinkingLevel: vi.fn((_: unknown, level: unknown) => level),
	};
});

import { convertMessages } from "../src/api/openai-completions.ts";

const compat: Omit<Required<OpenAICompletionsCompat>, "thinkingTokenBudgetField" | "vllmPriority"> & {
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
	supportsMidConvoSystemMessages: false,
	supportsMidConvoToolAdditions: false,
	cacheControlFormat: "anthropic",
	sendSessionAffinityHeaders: false,
	sessionAffinityFormat: "openai",
	supportsLongCacheRetention: true,
	videoPartFormat: "input_video",
};

const model: Model<"openai-completions"> = {
	id: "local-qwen",
	name: "Local Qwen",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://127.0.0.1:8080/v1",
	reasoning: false,
	input: ["text", "video"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262144,
	maxTokens: 8192,
};

describe("openai-completions video input", () => {
	it("serializes user videos using llama.cpp input_video content", () => {
		const context = normalizeContext({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe this video" },
						{ type: "video", data: "AAAAIGZ0eXBpc29t", mimeType: "video/mp4" },
					],
					timestamp: Date.now(),
				},
			],
		});

		const messages = convertMessages(model, context, compat);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "Describe this video" },
				{ type: "input_video", input_video: { data: "AAAAIGZ0eXBpc29t" } },
			],
		});
	});

	it("serializes videos returned by the read tool", () => {
		const context = normalizeContext({
			messages: [
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "clip.mp4" } }],
					api: "openai-completions",
					provider: "local",
					model: "local-qwen",
					stopReason: "toolUse",
					timestamp: 1,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				},
				{
					role: "toolResult",
					toolCallId: "read-1",
					toolName: "read",
					content: [
						{ type: "text", text: "Read video file [video/mp4]" },
						{ type: "video", data: "BBBB-tool-video", mimeType: "video/mp4" },
					],
					isError: false,
					timestamp: 2,
				},
			],
		});

		const messages = convertMessages(model, context, compat);
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "Attached media from tool result:" },
				{ type: "input_video", input_video: { data: "BBBB-tool-video" } },
			],
		});
	});

	it("sends vLLM's video_url data part when compat.videoPartFormat is video_url", () => {
		// vLLM's multimodal server validates content parts and answers
		// 400 {"error":"Unexpected item type in content."} to input_video, while it takes
		// video_url when launched with --limit-mm-per-prompt '{"image":64,"video":64}'.
		const vllmModel: Model<"openai-completions"> = {
			...model,
			baseUrl: "http://192.168.10.147:8001/v1",
			input: ["text", "image", "video"],
		};
		const context = normalizeContext({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Transcribe the text in this clip" },
						{ type: "video", data: "AAAAIGZ0eXBpc29t", mimeType: "video/mp4" },
					],
					timestamp: Date.now(),
				},
			],
		});

		const messages = convertMessages(vllmModel, context, { ...compat, videoPartFormat: "video_url" });
		expect(messages).toHaveLength(1);
		expect(messages[0]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "Transcribe the text in this clip" },
				{ type: "video_url", video_url: { url: "data:video/mp4;base64,AAAAIGZ0eXBpc29t" } },
			],
		});
	});

	it("keeps video_url for tool-result videos when the format is video_url", () => {
		const context = normalizeContext({
			messages: [
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "read-9", name: "read", arguments: { path: "clip.mp4" } }],
					api: "openai-completions",
					provider: "local",
					model: "local-qwen",
					stopReason: "toolUse",
					timestamp: 1,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				},
				{
					role: "toolResult",
					toolCallId: "read-9",
					toolName: "read",
					content: [
						{ type: "text", text: "Read video file [video/mp4]" },
						{ type: "video", data: "CCCC-tool-vllm", mimeType: "video/mp4" },
					],
					isError: false,
					timestamp: 2,
				},
			],
		});

		const messages = convertMessages(model, context, { ...compat, videoPartFormat: "video_url" });
		expect(messages.at(-1)).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "Attached media from tool result:" },
				{ type: "video_url", video_url: { url: "data:video/mp4;base64,CCCC-tool-vllm" } },
			],
		});
	});
});
