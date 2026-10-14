import { describe, expect, it } from "vitest";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import { normalizeContext } from "../src/compat.ts";
import type { Model } from "../src/types.ts";

function videoModel(overrides?: {
	videoPartFormat?: "input_video" | "video_url";
	input?: ("image" | "text" | "video")[];
}): Model<"openai-responses"> {
	return {
		id: "strata-video",
		name: "Strata video",
		api: "openai-responses",
		provider: "strata-remote",
		baseUrl: "http://192.168.10.147:8080/v1",
		reasoning: false,
		input: overrides?.input ?? ["text", "image", "video"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262144,
		maxTokens: 8192,
		compat: overrides?.videoPartFormat ? { videoPartFormat: overrides.videoPartFormat } : undefined,
	};
}

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function videoUserContext(): ReturnType<typeof normalizeContext> {
	return normalizeContext({
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "What is printed on the sign?" },
					{ type: "video", data: "AAAAIGZ0eXBpc29t", mimeType: "video/mp4" },
				],
				timestamp: Date.now(),
			},
		],
	});
}

describe("openai-responses video input", () => {
	it("serializes user videos as input_video by default (the llama.cpp spelling, as the chat-completions serializer)", () => {
		const model = videoModel();
		const input = convertResponsesMessages(model, videoUserContext(), new Set());
		expect(input).toHaveLength(1);
		const message = input[0] as { role: string; content: unknown[] };
		expect(message.content).toEqual([
			{ type: "input_text", text: "What is printed on the sign?" },
			{ type: "input_video", input_video: { data: "AAAAIGZ0eXBpc29t", mime_type: "video/mp4" } },
		]);
	});

	it("serializes user videos as video_url data URLs when compat.videoPartFormat is video_url", () => {
		const model = videoModel({ videoPartFormat: "video_url" });
		const input = convertResponsesMessages(model, videoUserContext(), new Set());
		const message = input[0] as { content: unknown[] };
		expect(message.content).toEqual([
			{ type: "input_text", text: "What is printed on the sign?" },
			{ type: "video_url", video_url: { url: "data:video/mp4;base64,AAAAIGZ0eXBpc29t" } },
		]);
	});

	it("serializes videos returned by the read tool", () => {
		const model = videoModel();
		const now = Date.now();
		const context = normalizeContext({
			messages: [
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "clip.mp4" } }],
					api: "openai-responses",
					provider: "strata-remote",
					model: "strata-video",
					stopReason: "toolUse",
					timestamp: now - 1,
					usage,
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
					timestamp: now,
				},
			],
		});
		const input = convertResponsesMessages(model, context, new Set());
		const output = input.find((item) => (item as { type: string }).type === "function_call_output") as {
			output: unknown;
		};
		expect(output.output).toEqual([
			{ type: "input_text", text: "Read video file [video/mp4]" },
			{ type: "input_video", input_video: { data: "BBBB-tool-video", mime_type: "video/mp4" } },
		]);
	});

	it("notes videos that are dropped for a model without video input (the upstream transform downgrades them)", () => {
		const model = videoModel({ input: ["text"] });
		const now = Date.now();
		const context = normalizeContext({
			messages: [
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "clip.mp4" } }],
					api: "openai-responses",
					provider: "strata-remote",
					model: "strata-video",
					stopReason: "toolUse",
					timestamp: now - 1,
					usage,
				},
				{
					role: "toolResult",
					toolCallId: "read-1",
					toolName: "read",
					content: [{ type: "video", data: "BBBB-tool-video", mimeType: "video/mp4" }],
					isError: false,
					timestamp: now,
				},
			],
		});
		const input = convertResponsesMessages(model, context, new Set());
		const output = input.find((item) => (item as { type: string }).type === "function_call_output") as {
			output: unknown;
		};
		expect(output.output).toBe("(tool video omitted: model does not support videos)");
	});
});
