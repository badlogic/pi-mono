import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.js";
import { streamOpenAIResponses } from "../src/providers/openai-responses.js";
import type { Context, Model } from "../src/types.js";

interface OpenAIConstructorConfig {
	defaultHeaders?: Record<string, string>;
}

let lastOpenAIConfig: OpenAIConstructorConfig | undefined;

// Mock OpenAI
vi.mock("openai", () => {
	class MockOpenAI {
		public chat: {
			completions: {
				create: (
					_body: unknown,
					_options?: unknown,
				) => AsyncGenerator<{ choices: Array<{ delta: { content?: string }; finish_reason: string | null }> }>;
			};
		};

		public responses: {
			create: (
				_body: unknown,
				_options?: unknown,
			) => AsyncGenerator<{
				type: "response.completed";
				response: {
					status: "completed";
					usage: {
						input_tokens: number;
						output_tokens: number;
						total_tokens: number;
						input_tokens_details?: { cached_tokens?: number };
					};
				};
			}>;
		};

		constructor(config: OpenAIConstructorConfig) {
			lastOpenAIConfig = config;

			this.chat = {
				completions: {
					create: async function* () {
						yield {
							choices: [
								{
									delta: { content: "Hello" },
									finish_reason: null,
								},
							],
						};
						yield {
							choices: [
								{
									delta: { content: " world" },
									finish_reason: "stop",
								},
							],
						};
					},
				},
			};

			this.responses = {
				create: async function* () {
					yield {
						type: "response.completed",
						response: {
							status: "completed",
							usage: {
								input_tokens: 0,
								output_tokens: 0,
								total_tokens: 0,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					};
				},
			};
		}
	}

	return { default: MockOpenAI };
});

async function consumeStream(stream: AsyncIterable<unknown>): Promise<void> {
	for await (const _ of stream) {
		// consume
	}
}

describe("GitHub Copilot X-Initiator Header", () => {
	beforeEach(() => {
		lastOpenAIConfig = undefined;
	});

	const copilotCompletionsModel: Model<"openai-completions"> = {
		id: "gpt-4",
		name: "GPT-4",
		api: "openai-completions",
		provider: "github-copilot",
		baseUrl: "https://api.individual.githubcopilot.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 4096,
		headers: { Authorization: "Bearer token" },
	};

	const otherCompletionsModel: Model<"openai-completions"> = {
		...copilotCompletionsModel,
		provider: "openai",
	};

	const copilotResponsesModel: Model<"openai-responses"> = {
		id: "gpt-5.1-codex",
		name: "GPT-5.1-Codex",
		api: "openai-responses",
		provider: "github-copilot",
		baseUrl: "https://api.individual.githubcopilot.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 128000,
		headers: { Authorization: "Bearer token" },
	};

	const otherResponsesModel: Model<"openai-responses"> = {
		...copilotResponsesModel,
		provider: "openai",
	};

	it("completions: sets X-Initiator: user when last message is from user (Copilot)", async () => {
		const context: Context = {
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
		};

		const stream = streamOpenAICompletions(copilotCompletionsModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("user");
	});

	it("completions: sets X-Initiator: agent when last message is from assistant (Copilot)", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Hello", timestamp: Date.now() },
				{
					role: "assistant",
					content: [],
					api: "openai-completions",
					provider: "github-copilot",
					model: "gpt-4",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				},
			],
		};

		const stream = streamOpenAICompletions(copilotCompletionsModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("agent");
	});

	it("completions: sets X-Initiator: agent when last message is from toolResult (Copilot)", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Hello", timestamp: Date.now() },
				{
					role: "toolResult",
					content: [],
					toolCallId: "1",
					toolName: "test",
					isError: false,
					timestamp: Date.now(),
				},
			],
		};

		const stream = streamOpenAICompletions(copilotCompletionsModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("agent");
	});

	it("completions: defaults to X-Initiator: user when there are no messages (Copilot)", async () => {
		const context: Context = {
			messages: [],
		};

		const stream = streamOpenAICompletions(copilotCompletionsModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("user");
	});

	it("completions: does NOT set X-Initiator for non-Copilot providers", async () => {
		const context: Context = {
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
		};

		const stream = streamOpenAICompletions(otherCompletionsModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBeUndefined();
	});

	it("responses: sets X-Initiator: user when last message is from user (Copilot)", async () => {
		const context: Context = {
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
		};

		const stream = streamOpenAIResponses(copilotResponsesModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("user");
	});

	it("responses: sets X-Initiator: agent when last message is from assistant (Copilot)", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Hello", timestamp: Date.now() },
				{
					role: "assistant",
					content: [],
					api: "openai-responses",
					provider: "github-copilot",
					model: "gpt-5.1-codex",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				},
			],
		};

		const stream = streamOpenAIResponses(copilotResponsesModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("agent");
	});

	it("responses: sets X-Initiator: agent when last message is from toolResult (Copilot)", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "Hello", timestamp: Date.now() },
				{
					role: "toolResult",
					content: [],
					toolCallId: "1",
					toolName: "test",
					isError: false,
					timestamp: Date.now(),
				},
			],
		};

		const stream = streamOpenAIResponses(copilotResponsesModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("agent");
	});

	it("responses: defaults to X-Initiator: user when there are no messages (Copilot)", async () => {
		const context: Context = {
			messages: [],
		};

		const stream = streamOpenAIResponses(copilotResponsesModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBe("user");
	});

	it("responses: does NOT set X-Initiator for non-Copilot providers", async () => {
		const context: Context = {
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
		};

		const stream = streamOpenAIResponses(otherResponsesModel, context, { apiKey: "test-key" });
		await consumeStream(stream);

		expect(lastOpenAIConfig?.defaultHeaders?.["X-Initiator"]).toBeUndefined();
	});
});
