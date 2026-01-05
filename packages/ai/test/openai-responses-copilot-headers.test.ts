import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAIResponses } from "../src/providers/openai-responses.js";
import type { Context, ImageContent, Model, ToolResultMessage, UserMessage } from "../src/types.js";

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

function createModel(): Model<"openai-responses"> {
	return {
		id: "gpt-test",
		name: "gpt-test",
		api: "openai-responses",
		provider: "github-copilot",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

async function* minimalCompletionEvents(): AsyncGenerator<{ type: string; response?: unknown }> {
	yield {
		type: "response.completed",
		response: {
			status: "completed",
			usage: {
				input_tokens: 1,
				output_tokens: 1,
				total_tokens: 2,
				input_tokens_details: { cached_tokens: 0 },
			},
		},
	};
}

describe("openai-responses copilot headers", () => {
	it("sets X-Initiator=user when last message is user", async () => {
		responsesCreateMock.mockResolvedValue(minimalCompletionEvents());

		const userMessage: UserMessage = {
			role: "user",
			content: "Hello",
			timestamp: Date.now(),
		};
		const context: Context = { messages: [userMessage] };

		const stream = streamOpenAIResponses(createModel(), context, { apiKey: "token" });
		await stream.result();

		expect(OpenAIConstructor).toHaveBeenCalledTimes(1);
		const config = OpenAIConstructor.mock.calls[0]?.[0] as { defaultHeaders?: Record<string, string> };
		expect(config.defaultHeaders?.["X-Initiator"]).toBe("user");
		expect(config.defaultHeaders?.["Openai-Intent"]).toBe("conversation-edits");
	});

	it("sets X-Initiator=agent when last message is not user", async () => {
		responsesCreateMock.mockResolvedValue(minimalCompletionEvents());

		const toolMessage: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call|id",
			toolName: "tool",
			content: [{ type: "text", text: "result" }],
			isError: false,
			timestamp: Date.now(),
		};

		const context: Context = {
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }, toolMessage],
		};

		const stream = streamOpenAIResponses(createModel(), context, { apiKey: "token" });
		await stream.result();

		expect(OpenAIConstructor).toHaveBeenCalledTimes(1);
		const config = OpenAIConstructor.mock.calls[0]?.[0] as { defaultHeaders?: Record<string, string> };
		expect(config.defaultHeaders?.["X-Initiator"]).toBe("agent");
		expect(config.defaultHeaders?.["Openai-Intent"]).toBe("conversation-edits");
	});

	it("sets Copilot-Vision-Request=true when any user message has an image", async () => {
		responsesCreateMock.mockResolvedValue(minimalCompletionEvents());

		const image: ImageContent = {
			type: "image",
			mimeType: "image/png",
			data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
		};

		const context: Context = {
			messages: [
				{
					role: "user",
					content: [image, { type: "text", text: "Here" }],
					timestamp: Date.now(),
				},
			],
		};

		const stream = streamOpenAIResponses(createModel(), context, { apiKey: "token" });
		await stream.result();

		expect(OpenAIConstructor).toHaveBeenCalledTimes(1);
		const config = OpenAIConstructor.mock.calls[0]?.[0] as { defaultHeaders?: Record<string, string> };
		expect(config.defaultHeaders?.["Copilot-Vision-Request"]).toBe("true");
	});

	it("sets Copilot-Vision-Request=true when any toolResult message has an image", async () => {
		responsesCreateMock.mockResolvedValue(minimalCompletionEvents());

		const image: ImageContent = {
			type: "image",
			mimeType: "image/png",
			data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
		};

		const toolMessage: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call|id",
			toolName: "tool",
			content: [image],
			isError: false,
			timestamp: Date.now(),
		};

		const context: Context = {
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }, toolMessage],
		};

		const stream = streamOpenAIResponses(createModel(), context, { apiKey: "token" });
		await stream.result();

		expect(OpenAIConstructor).toHaveBeenCalledTimes(1);
		const config = OpenAIConstructor.mock.calls[0]?.[0] as { defaultHeaders?: Record<string, string> };
		expect(config.defaultHeaders?.["Copilot-Vision-Request"]).toBe("true");
	});
});
