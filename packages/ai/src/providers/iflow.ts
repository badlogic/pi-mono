/**
 * iFlow provider - OpenAI-compatible API with iFlow-specific headers and extensions.
 */

import * as crypto from "crypto";
import { getEnvApiKey } from "../env-api-keys.js";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	Model,
	OpenAICompletionsCompat,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { convertMessages } from "./openai-completions.js";
import { buildBaseOptions, clampReasoning } from "./simple-options.js";

const IFLOW_USER_AGENT = "iFlow-Cli";

const IFLOW_COMPAT: Required<OpenAICompletionsCompat> = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	maxTokensField: "max_tokens",
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: false,
	requiresMistralToolIds: false,
	thinkingFormat: "openai",
	openRouterRouting: {},
	vercelGatewayRouting: {},
	supportsStrictMode: true,
};

interface IflowReasoningThinkingEnabled {
	type: "enabled";
}

interface IflowReasoningThinkingDisabled {
	type: "disabled";
}

interface IflowReasoningThinkingConfig {
	enabled: boolean;
	max_tokens?: number;
	reasoning_level?: "low" | "medium" | "high";
}

export interface IflowOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	/** iFlow extension field. If omitted, maxTokens is mirrored into max_new_tokens. */
	maxNewTokens?: number;
	/** iFlow extension fields for thinking/reasoning compatibility. */
	thinking?: IflowReasoningThinkingEnabled | IflowReasoningThinkingDisabled | IflowReasoningThinkingConfig;
	enableThinking?: boolean;
	thinkingMode?: boolean;
	reasoning?: boolean;
	chatTemplateKwargs?: Record<string, unknown>;
	extendFields?: Record<string, unknown>;
	/** Optional iFlow conversation ID. Defaults to a generated UUID v4. */
	conversationId?: string;
}

interface IflowChatCompletionChunk {
	choices: Array<{
		finish_reason: string | null;
		delta: {
			content?: string | null;
			reasoning_content?: string;
			reasoning?: string;
			reasoning_text?: string;
			tool_calls?: Array<{
				id?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		prompt_tokens_details?: {
			cached_tokens?: number;
		};
		completion_tokens_details?: {
			reasoning_tokens?: number;
		};
	};
}

type StreamingBlock = TextContent | ThinkingContent | (ToolCall & { partialArgs?: string });

/** Generate iFlow signature: HMAC_SHA256_HEX(apiKey, `${userAgent}:${sessionId}:${timestampMs}`) */
function generateSignature(userAgent: string, sessionId: string, timestampMs: number, apiKey: string): string {
	const stringToSign = `${userAgent}:${sessionId}:${timestampMs}`;
	return crypto.createHmac("sha256", apiKey).update(stringToSign, "utf8").digest("hex");
}

/** Generate a session ID in iFlow format: session-{uuid} */
function generateSessionId(): string {
	return `session-${crypto.randomUUID()}`;
}

function toOpenAIModel(model: Model<"iflow-completions">): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions",
		compat: IFLOW_COMPAT,
	};
}

function convertTools(tools: Tool[]): Array<Record<string, unknown>> {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			strict: false,
		},
	}));
}

/** Determine if thinking/reasoning is enabled based on options */
function isThinkingEnabled(options: IflowOptions | undefined, model: Model<"iflow-completions">): boolean {
	// If model has reasoning capability and user didn't explicitly disable it
	if (model.reasoning) {
		// Check explicit options
		if (options?.thinking !== undefined) {
			if (typeof options.thinking === "object" && "type" in options.thinking) {
				return options.thinking.type === "enabled";
			}
			return Boolean(options.thinking);
		}
		if (options?.enableThinking !== undefined) {
			return options.enableThinking;
		}
		if (options?.thinkingMode !== undefined) {
			return options.thinkingMode;
		}
		if (options?.reasoning !== undefined) {
			return options.reasoning;
		}
		// Default to enabled for reasoning models
		return true;
	}
	return false;
}

/**
 * Apply model-specific parameters based on iFlow documentation.
 * Section 9: 9 models' chat/completions parameter Schema
 */
function applyModelSpecificParams(
	model: Model<"iflow-completions">,
	options: IflowOptions | undefined,
	context: Context,
): Record<string, unknown> {
	const thinkingEnabled = isThinkingEnabled(options, model);
	const params: Record<string, unknown> = {};
	const hasTools = context.tools && context.tools.length > 0;

	switch (model.id) {
		// 1) GLM-4.7
		case "glm-4.7": {
			params.temperature = 1;
			params.top_p = 0.95;
			params.chat_template_kwargs = { enable_thinking: thinkingEnabled };
			params.max_new_tokens = 32000;
			break;
		}

		// 2) iFlow-ROME-30BA3B
		case "iFlow-ROME-30BA3B": {
			params.temperature = 0.7;
			params.top_p = 0.8;
			params.top_k = 20;
			params.max_new_tokens = 64000;
			break;
		}

		// 3) DeepSeek-V3.2
		case "deepseek-v3.2": {
			// When thinking is enabled, model is rewritten to deepseek-v3.2-reasoner
			if (thinkingEnabled) {
				params.model = "deepseek-v3.2-reasoner";
			}
			// Only set max_tokens when model is NOT deepseek-v3.2-reasoner
			if (params.model !== "deepseek-v3.2-reasoner") {
				params.max_tokens = 64000;
			}
			params.max_new_tokens = 64000;
			break;
		}

		// 4) GLM-5
		case "glm-5": {
			params.temperature = 1;
			params.top_p = 0.95;
			if (thinkingEnabled) {
				params.chat_template_kwargs = { enable_thinking: true };
				params.enable_thinking = true;
				params.thinking = { type: "enabled" };
			} else {
				params.chat_template_kwargs = { enable_thinking: false };
				params.enable_thinking = false;
				params.thinking = { type: "disabled" };
			}
			params.max_new_tokens = 32000;
			break;
		}

		// 5) Qwen3-Coder-Plus
		case "qwen3-coder-plus": {
			params.max_new_tokens = 64000;
			break;
		}

		// 6) Kimi-K2-Thinking
		case "kimi-k2-thinking": {
			if (thinkingEnabled) {
				params.thinking_mode = true;
			}
			params.max_new_tokens = 32000;
			break;
		}

		// 7) MiniMax-M2.5
		case "minimax-m2.5": {
			params.max_new_tokens = 64000;
			break;
		}

		// 8) Kimi-K2.5 (special case - most forced parameters)
		case "kimi-k2.5": {
			params.top_p = 0.95;
			params.n = 1;
			params.presence_penalty = 0;
			params.frequency_penalty = 0;
			params.max_tokens = 32768;
			params.max_new_tokens = 32768;
			// temperature is cleared (not sent)
			if (thinkingEnabled) {
				params.thinking = { type: "enabled" };
			}
			// When tools are present and tool_choice is not provided, add "auto"
			if (hasTools && !options?.toolChoice) {
				params.tool_choice = "auto";
			}
			break;
		}

		// 9) Kimi-K2-0905
		case "kimi-k2-0905": {
			params.max_new_tokens = 32000;
			break;
		}

		default:
			break;
	}

	return params;
}

function buildParams(
	model: Model<"iflow-completions">,
	context: Context,
	options: IflowOptions | undefined,
	sessionId: string,
): Record<string, unknown> {
	const openAIModel = toOpenAIModel(model);
	const params: Record<string, unknown> = {
		model: model.id,
		messages: convertMessages(openAIModel, context, IFLOW_COMPAT),
		stream: true,
		stream_options: { include_usage: true },
	};

	if (options?.maxTokens) {
		params.max_tokens = options.maxTokens;
		params.max_new_tokens = options.maxNewTokens ?? options.maxTokens;
	} else if (options?.maxNewTokens) {
		params.max_new_tokens = options.maxNewTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools && context.tools.length > 0) {
		params.tools = convertTools(context.tools);
	}

	if (options?.toolChoice) {
		params.tool_choice = options.toolChoice;
	}

	if (model.reasoning) {
		const hasExplicitThinkingFields =
			options?.thinking !== undefined ||
			options?.enableThinking !== undefined ||
			options?.thinkingMode !== undefined ||
			options?.reasoning !== undefined ||
			options?.chatTemplateKwargs !== undefined;

		if (options?.reasoningEffort) {
			params.reasoning_effort = options.reasoningEffort;
		}

		if (options?.thinking !== undefined) {
			params.thinking = options.thinking;
		}

		if (options?.enableThinking !== undefined) {
			params.enable_thinking = options.enableThinking;
		}

		if (options?.thinkingMode !== undefined) {
			params.thinking_mode = options.thinkingMode;
		}

		if (options?.reasoning !== undefined) {
			params.reasoning = options.reasoning;
		}

		if (options?.chatTemplateKwargs) {
			params.chat_template_kwargs = options.chatTemplateKwargs;
		}

		// Default extension mapping when only reasoningEffort is provided.
		if (options?.reasoningEffort && !hasExplicitThinkingFields) {
			params.thinking = { type: "enabled" };
			params.enable_thinking = true;
			params.reasoning = true;
			params.chat_template_kwargs = { enable_thinking: true };
		}
	}

	const extendFields: Record<string, unknown> = {
		...(options?.extendFields ?? {}),
	};
	if (!("sessionId" in extendFields)) {
		extendFields.sessionId = sessionId;
	}
	if (Object.keys(extendFields).length > 0) {
		params.extend_fields = extendFields;
	}

	// Apply model-specific parameters (Section 9 of iFlow documentation)
	// These set forced defaults and model-specific configurations
	const modelSpecificParams = applyModelSpecificParams(model, options, context);
	Object.assign(params, modelSpecificParams);

	// Handle special case: Kimi-K2.5 clears temperature (doesn't send it)
	if (model.id === "kimi-k2.5") {
		delete params.temperature;
	}

	return params;
}

function mapStopReason(reason: string | null): StopReason {
	if (reason === null) return "stop";
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "function_call":
		case "tool_calls":
			return "toolUse";
		case "content_filter":
			return "error";
		default:
			return "stop";
	}
}

function getReasoningDelta(
	delta: IflowChatCompletionChunk["choices"][number]["delta"],
): { field: "reasoning_content" | "reasoning" | "reasoning_text"; value: string } | null {
	if (delta.reasoning_content && delta.reasoning_content.length > 0) {
		return { field: "reasoning_content", value: delta.reasoning_content };
	}
	if (delta.reasoning && delta.reasoning.length > 0) {
		return { field: "reasoning", value: delta.reasoning };
	}
	if (delta.reasoning_text && delta.reasoning_text.length > 0) {
		return { field: "reasoning_text", value: delta.reasoning_text };
	}
	return null;
}

function extractSseDataEvents(buffer: string): { events: string[]; remaining: string } {
	const events: string[] = [];
	const chunks = buffer.split(/\r?\n\r?\n/);
	const remaining = chunks.pop() ?? "";

	for (const chunk of chunks) {
		const dataLines = chunk
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart());

		if (dataLines.length > 0) {
			events.push(dataLines.join("\n"));
		}
	}

	return { events, remaining };
}

export const streamIflow: StreamFunction<"iflow-completions", IflowOptions> = (
	model: Model<"iflow-completions">,
	context: Context,
	options?: IflowOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
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
			const apiKey = options?.apiKey || getEnvApiKey(model.provider);
			if (!apiKey) {
				throw new Error("iFlow API key is required. Set IFLOW_API_KEY environment variable or pass apiKey.");
			}

			const sessionId = options?.sessionId || generateSessionId();
			const conversationId = options?.conversationId || crypto.randomUUID();
			const timestampMs = Date.now();
			const signature = generateSignature(IFLOW_USER_AGENT, sessionId, timestampMs, apiKey);
			const params = buildParams(model, context, options, sessionId);
			options?.onPayload?.(params);

			const response = await fetch(`${model.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					...model.headers,
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					"user-agent": IFLOW_USER_AGENT,
					"session-id": sessionId,
					"conversation-id": conversationId,
					"x-iflow-signature": signature,
					"x-iflow-timestamp": String(timestampMs),
					...options?.headers,
				},
				body: JSON.stringify(params),
				signal: options?.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(`iFlow API error: ${response.status} ${response.statusText} ${errorBody}`.trim());
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body");
			}

			stream.push({ type: "start", partial: output });

			let currentBlock: StreamingBlock | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			const finishCurrentBlock = (block: StreamingBlock | null) => {
				if (!block) return;

				if (block.type === "text") {
					stream.push({
						type: "text_end",
						contentIndex: blockIndex(),
						content: block.text,
						partial: output,
					});
					return;
				}

				if (block.type === "thinking") {
					stream.push({
						type: "thinking_end",
						contentIndex: blockIndex(),
						content: block.thinking,
						partial: output,
					});
					return;
				}

				const finalizedToolCall: ToolCall = {
					type: "toolCall",
					id: block.id,
					name: block.name,
					arguments: parseStreamingJson<Record<string, unknown>>(block.partialArgs),
				};
				if (block.thoughtSignature) {
					finalizedToolCall.thoughtSignature = block.thoughtSignature;
				}
				blocks[blockIndex()] = finalizedToolCall;
				stream.push({
					type: "toolcall_end",
					contentIndex: blockIndex(),
					toolCall: finalizedToolCall,
					partial: output,
				});
			};

			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
				const { events, remaining } = extractSseDataEvents(buffer);
				buffer = remaining;

				for (const eventData of events) {
					if (eventData === "[DONE]") continue;

					let chunk: IflowChatCompletionChunk;
					try {
						chunk = JSON.parse(eventData) as IflowChatCompletionChunk;
					} catch {
						continue;
					}

					if (chunk.usage) {
						const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
						const reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens || 0;
						const promptTokens = chunk.usage.prompt_tokens || 0;
						const completionTokens = chunk.usage.completion_tokens || 0;
						const input = promptTokens - cachedTokens;
						const outputTokens = completionTokens + reasoningTokens;
						output.usage = {
							input,
							output: outputTokens,
							cacheRead: cachedTokens,
							cacheWrite: 0,
							totalTokens: input + outputTokens + cachedTokens,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
						calculateCost(model, output.usage);
					}

					const choice = chunk.choices[0];
					if (!choice) continue;

					if (choice.finish_reason) {
						output.stopReason = mapStopReason(choice.finish_reason);
					}

					const { delta } = choice;
					if (!delta) continue;

					if (delta.content !== null && delta.content !== undefined && delta.content.length > 0) {
						if (!currentBlock || currentBlock.type !== "text") {
							finishCurrentBlock(currentBlock);
							currentBlock = { type: "text", text: "" };
							output.content.push(currentBlock);
							stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
						}

						if (currentBlock.type === "text") {
							currentBlock.text += delta.content;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: delta.content,
								partial: output,
							});
						}
					}

					const reasoningDelta = getReasoningDelta(delta);
					if (reasoningDelta) {
						if (!currentBlock || currentBlock.type !== "thinking") {
							finishCurrentBlock(currentBlock);
							currentBlock = {
								type: "thinking",
								thinking: "",
								thinkingSignature: reasoningDelta.field,
							};
							output.content.push(currentBlock);
							stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
						}

						if (currentBlock.type === "thinking") {
							currentBlock.thinking += reasoningDelta.value;
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: reasoningDelta.value,
								partial: output,
							});
						}
					}

					if (delta.tool_calls) {
						for (const toolCall of delta.tool_calls) {
							if (
								!currentBlock ||
								currentBlock.type !== "toolCall" ||
								(toolCall.id && currentBlock.id !== toolCall.id)
							) {
								finishCurrentBlock(currentBlock);
								currentBlock = {
									type: "toolCall",
									id: toolCall.id || "",
									name: toolCall.function?.name || "",
									arguments: {},
									partialArgs: "",
								};
								output.content.push(currentBlock);
								stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							}

							if (currentBlock.type === "toolCall") {
								if (toolCall.id) currentBlock.id = toolCall.id;
								if (toolCall.function?.name) currentBlock.name = toolCall.function.name;

								let argsDelta = "";
								if (toolCall.function?.arguments) {
									argsDelta = toolCall.function.arguments;
									currentBlock.partialArgs = `${currentBlock.partialArgs ?? ""}${argsDelta}`;
									currentBlock.arguments = parseStreamingJson<Record<string, unknown>>(
										currentBlock.partialArgs,
									);
								}

								stream.push({
									type: "toolcall_delta",
									contentIndex: blockIndex(),
									delta: argsDelta,
									partial: output,
								});
							}
						}
					}
				}

				if (done) break;
			}

			finishCurrentBlock(currentBlock);

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleIflow: StreamFunction<"iflow-completions", SimpleStreamOptions> = (
	model: Model<"iflow-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	const reasoningEffort = options?.reasoning ? clampReasoning(options.reasoning) : undefined;
	const toolChoice = (options as IflowOptions | undefined)?.toolChoice;

	return streamIflow(model, context, {
		...base,
		reasoningEffort,
		toolChoice,
	} as unknown as IflowOptions);
};
