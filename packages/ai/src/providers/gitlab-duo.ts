import { createGitLab, type GitLabAgenticOptions, type GitLabProvider } from "@gitlab/gitlab-ai-provider";
import { calculateCost } from "../models.js";
import { getEnvApiKey } from "../stream.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { transformMessages } from "./transform-messages.js";

export interface GitLabDuoOptions extends StreamOptions {
	/** Enable thinking/reasoning mode */
	thinking?: {
		enabled: boolean;
	};
	/** GitLab instance URL (defaults to https://gitlab.com) */
	instanceUrl?: string;
	/** The Anthropic model to use via GitLab's proxy */
	anthropicModel?: string;
	/** Feature flags to pass to GitLab API */
	featureFlags?: Record<string, boolean>;
}

// Cache the GitLab provider instance
let cachedProvider: GitLabProvider | null = null;
let cachedInstanceUrl: string | null = null;
let cachedApiKey: string | null = null;

function getGitLabProvider(instanceUrl: string, apiKey: string): GitLabProvider {
	// Return cached provider if settings match
	if (cachedProvider && cachedInstanceUrl === instanceUrl && cachedApiKey === apiKey) {
		return cachedProvider;
	}

	cachedProvider = createGitLab({
		instanceUrl,
		apiKey,
	});
	cachedInstanceUrl = instanceUrl;
	cachedApiKey = apiKey;

	return cachedProvider;
}

/**
 * Convert Pi's Context to Vercel AI SDK prompt format
 */
function convertToAiSdkPrompt(context: Context, model: Model<"gitlab-duo">) {
	const prompt: Array<{
		role: "system" | "user" | "assistant" | "tool";
		content: any;
	}> = [];

	// Add system prompt
	if (context.systemPrompt) {
		prompt.push({
			role: "system",
			content: context.systemPrompt,
		});
	}

	// Transform messages for cross-provider compatibility
	const transformedMessages = transformMessages(context.messages, model);

	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			const content: Array<{ type: "text"; text: string } | { type: "file"; data: string; mimeType: string }> = [];

			if (typeof msg.content === "string") {
				content.push({ type: "text", text: msg.content });
			} else {
				for (const part of msg.content) {
					if (part.type === "text") {
						content.push({ type: "text", text: part.text });
					} else if (part.type === "image") {
						content.push({
							type: "file",
							data: part.data,
							mimeType: part.mimeType,
						});
					}
				}
			}

			prompt.push({ role: "user", content });
		} else if (msg.role === "assistant") {
			const content: Array<
				{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
			> = [];

			for (const part of msg.content) {
				if (part.type === "text") {
					content.push({ type: "text", text: part.text });
				} else if (part.type === "toolCall") {
					content.push({
						type: "tool-call",
						toolCallId: part.id,
						toolName: part.name,
						input: JSON.stringify(part.arguments),
					});
				}
				// Note: thinking blocks are not typically sent back to the model
			}

			if (content.length > 0) {
				prompt.push({ role: "assistant", content });
			}
		} else if (msg.role === "toolResult") {
			const resultContent = msg.content
				.map((c) => (c.type === "text" ? c.text : `[Image: ${c.mimeType}]`))
				.join("\n");

			prompt.push({
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: msg.toolCallId,
						output: msg.isError
							? { type: "error-text", value: resultContent }
							: { type: "text", value: resultContent },
					},
				],
			});
		}
	}

	return prompt;
}

/**
 * Convert Pi's tools to Vercel AI SDK format
 */
function convertTools(tools?: Tool[]): Array<{
	type: "function";
	name: string;
	description: string;
	inputSchema: object;
}> {
	if (!tools || tools.length === 0) {
		return [];
	}

	return tools.map((tool) => ({
		type: "function" as const,
		name: tool.name,
		description: tool.description,
		inputSchema: tool.parameters as object,
	}));
}

/**
 * Convert Vercel AI SDK finish reason to Pi's StopReason
 */
function convertFinishReason(reason: string): StopReason {
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "tool-calls":
			return "toolUse";
		case "error":
			return "error";
		default:
			return "stop";
	}
}

/**
 * Stream messages from GitLab Duo using the official GitLab AI Provider
 */
export const streamGitLabDuo: StreamFunction<"gitlab-duo"> = (
	model: Model<"gitlab-duo">,
	context: Context,
	options?: GitLabDuoOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "gitlab-duo" as Api,
			provider: "gitlab-duo",
			model: model.id,
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
		};

		try {
			const apiKey = options?.apiKey ?? getEnvApiKey("gitlab-duo") ?? "";
			if (!apiKey) {
				throw new Error("GitLab Duo API key not found. Set GITLAB_TOKEN or GITLAB_DUO_TOKEN environment variable.");
			}

			const instanceUrl = options?.instanceUrl || "https://gitlab.com";

			// Get or create the GitLab provider
			const gitlab = getGitLabProvider(instanceUrl, apiKey);

			// Create the agentic model with options
			const agenticOptions: GitLabAgenticOptions = {
				maxTokens: options?.maxTokens || model.maxTokens,
			};

			if (options?.anthropicModel) {
				agenticOptions.anthropicModel = options.anthropicModel;
			}

			if (options?.featureFlags) {
				agenticOptions.featureFlags = options.featureFlags;
			}

			const languageModel = gitlab.agenticChat(model.id, agenticOptions);

			// Convert context to AI SDK format
			const prompt = convertToAiSdkPrompt(context, model);
			const tools = convertTools(context.tools);

			// Start streaming
			stream.push({ type: "start", partial: output });

			// Call doStream on the language model
			const { stream: aiStream } = await languageModel.doStream({
				prompt,
				tools: tools.length > 0 ? tools : undefined,
				temperature: options?.temperature,
				maxOutputTokens: options?.maxTokens || model.maxTokens,
				abortSignal: options?.signal,
			});

			// Track current content blocks
			const textBlocks: Map<string, { index: number; text: string }> = new Map();
			const toolBlocks: Map<string, { index: number; name: string; input: string }> = new Map();
			const reasoningBlocks: Map<string, { index: number; thinking: string }> = new Map();

			// Read from the stream
			const reader = aiStream.getReader();

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const event = value as { type: string; [key: string]: any };

					switch (event.type) {
						case "stream-start":
							// Already emitted start event
							break;

						case "response-metadata":
							// Could use for logging
							break;

						case "text-start": {
							const textBlock: TextContent = { type: "text", text: "" };
							output.content.push(textBlock);
							const contentIndex = output.content.length - 1;
							textBlocks.set(event.id, { index: contentIndex, text: "" });
							stream.push({ type: "text_start", contentIndex, partial: output });
							break;
						}

						case "text-delta": {
							const block = textBlocks.get(event.id);
							if (block) {
								block.text += event.delta;
								const textContent = output.content[block.index] as TextContent;
								textContent.text = block.text;
								stream.push({
									type: "text_delta",
									contentIndex: block.index,
									delta: event.delta,
									partial: output,
								});
							}
							break;
						}

						case "text-end": {
							const block = textBlocks.get(event.id);
							if (block) {
								stream.push({
									type: "text_end",
									contentIndex: block.index,
									content: block.text,
									partial: output,
								});
								textBlocks.delete(event.id);
							}
							break;
						}

						case "reasoning-start": {
							const thinkingBlock: ThinkingContent = { type: "thinking", thinking: "" };
							output.content.push(thinkingBlock);
							const contentIndex = output.content.length - 1;
							reasoningBlocks.set(event.id, { index: contentIndex, thinking: "" });
							stream.push({ type: "thinking_start", contentIndex, partial: output });
							break;
						}

						case "reasoning-delta": {
							const block = reasoningBlocks.get(event.id);
							if (block && "delta" in event) {
								block.thinking += event.delta;
								const thinkingContent = output.content[block.index] as ThinkingContent;
								thinkingContent.thinking = block.thinking;
								stream.push({
									type: "thinking_delta",
									contentIndex: block.index,
									delta: event.delta as string,
									partial: output,
								});
							}
							break;
						}

						case "reasoning-end": {
							const block = reasoningBlocks.get(event.id);
							if (block) {
								stream.push({
									type: "thinking_end",
									contentIndex: block.index,
									content: block.thinking,
									partial: output,
								});
								reasoningBlocks.delete(event.id);
							}
							break;
						}

						case "tool-input-start": {
							const toolCall: ToolCall = {
								type: "toolCall",
								id: event.id,
								name: event.toolName,
								arguments: {},
							};
							output.content.push(toolCall);
							const contentIndex = output.content.length - 1;
							toolBlocks.set(event.id, { index: contentIndex, name: event.toolName, input: "" });
							stream.push({ type: "toolcall_start", contentIndex, partial: output });
							break;
						}

						case "tool-input-delta": {
							const block = toolBlocks.get(event.id);
							if (block) {
								block.input += event.delta;
								stream.push({
									type: "toolcall_delta",
									contentIndex: block.index,
									delta: event.delta,
									partial: output,
								});
							}
							break;
						}

						case "tool-input-end": {
							const block = toolBlocks.get(event.id);
							if (block) {
								// Parse the accumulated input
								try {
									const toolCall = output.content[block.index] as ToolCall;
									toolCall.arguments = JSON.parse(block.input || "{}");
									stream.push({
										type: "toolcall_end",
										contentIndex: block.index,
										toolCall,
										partial: output,
									});
								} catch {
									// If JSON parsing fails, keep empty arguments
									const toolCall = output.content[block.index] as ToolCall;
									stream.push({
										type: "toolcall_end",
										contentIndex: block.index,
										toolCall,
										partial: output,
									});
								}
								toolBlocks.delete(event.id);
							}
							break;
						}

						case "tool-call": {
							// Complete tool call event (non-streaming)
							// Check if we already have this tool call from streaming
							if (!toolBlocks.has(event.toolCallId)) {
								const toolCall: ToolCall = {
									type: "toolCall",
									id: event.toolCallId,
									name: event.toolName,
									arguments: typeof event.input === "string" ? JSON.parse(event.input) : event.input,
								};
								output.content.push(toolCall);
								const contentIndex = output.content.length - 1;
								stream.push({ type: "toolcall_start", contentIndex, partial: output });
								stream.push({
									type: "toolcall_end",
									contentIndex,
									toolCall,
									partial: output,
								});
							}
							break;
						}

						case "finish": {
							output.stopReason = convertFinishReason(event.finishReason);
							if (event.usage) {
								output.usage.input = event.usage.inputTokens || 0;
								output.usage.output = event.usage.outputTokens || 0;
								output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
								calculateCost(model, output.usage);
							}
							break;
						}

						case "error": {
							output.stopReason = "error";
							output.errorMessage = event.error instanceof Error ? event.error.message : String(event.error);

							// Check if this is a token refresh needed error
							if (output.errorMessage === "TOKEN_REFRESH_NEEDED") {
								// The provider handles retry internally, but if we get here it means retry failed
								output.errorMessage = "Authentication failed. Please re-authenticate with GitLab.";
							}

							stream.push({ type: "error", reason: "error", error: output });
							stream.end();
							return;
						}
					}
				}
			} finally {
				reader.releaseLock();
			}

			// Check for abort
			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = "Request was aborted";
				stream.push({ type: "error", reason: "aborted", error: output });
				stream.end();
				return;
			}

			// Emit done event
			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};
