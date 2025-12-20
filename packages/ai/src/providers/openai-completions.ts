import OpenAI from "openai";
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionChunk,
	ChatCompletionContentPart,
	ChatCompletionContentPartImage,
	ChatCompletionContentPartText,
	ChatCompletionMessageParam,
	ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	OpenAICompat,
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
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { transformMessages } from "./transorm-messages.js";

/**
 * Normalize tool call ID for Mistral.
 * Mistral requires tool IDs to be exactly 9 alphanumeric characters (a-z, A-Z, 0-9).
 */
function normalizeMistralToolId(id: string, isMistral: boolean): string {
	if (!isMistral) return id;
	// Remove non-alphanumeric characters
	let normalized = id.replace(/[^a-zA-Z0-9]/g, "");
	// Mistral requires exactly 9 characters
	if (normalized.length < 9) {
		// Pad with deterministic characters based on original ID to ensure matching
		const padding = "ABCDEFGHI";
		normalized = normalized + padding.slice(0, 9 - normalized.length);
	} else if (normalized.length > 9) {
		normalized = normalized.slice(0, 9);
	}
	return normalized;
}

/**
 * Check if conversation messages contain tool calls or tool results.
 * This is needed because Anthropic (via proxy) requires the tools param
 * to be present when messages include tool_calls or tool role messages.
 */
function hasToolHistory(messages: Message[]): boolean {
	for (const msg of messages) {
		if (msg.role === "toolResult") {
			return true;
		}
		if (msg.role === "assistant") {
			if (msg.content.some((block) => block.type === "toolCall")) {
				return true;
			}
		}
	}
	return false;
}

export interface OpenAICompletionsOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
}

export const streamOpenAICompletions: StreamFunction<"openai-completions"> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
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
			const client = createClient(model, context, options?.apiKey);
			const params = buildParams(model, context, options);
			const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			let currentBlock: TextContent | ThinkingContent | (ToolCall & { partialArgs?: string }) | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			const finishCurrentBlock = (block?: typeof currentBlock) => {
				if (block) {
					if (block.type === "text") {
						stream.push({
							type: "text_end",
							contentIndex: blockIndex(),
							content: block.text,
							partial: output,
						});
					} else if (block.type === "thinking") {
						stream.push({
							type: "thinking_end",
							contentIndex: blockIndex(),
							content: block.thinking,
							partial: output,
						});
					} else if (block.type === "toolCall") {
						block.arguments = JSON.parse(block.partialArgs || "{}");
						delete block.partialArgs;
						stream.push({
							type: "toolcall_end",
							contentIndex: blockIndex(),
							toolCall: block,
							partial: output,
						});
					}
				}
			};

			for await (const chunk of openaiStream) {
				if (chunk.usage) {
					const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
					const reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens || 0;
					const input = (chunk.usage.prompt_tokens || 0) - cachedTokens;
					const outputTokens = (chunk.usage.completion_tokens || 0) + reasoningTokens;
					output.usage = {
						// OpenAI includes cached tokens in prompt_tokens, so subtract to get non-cached input
						input,
						output: outputTokens,
						cacheRead: cachedTokens,
						cacheWrite: 0,
						// Compute totalTokens ourselves since we add reasoning_tokens to output
						// and some providers (e.g., Groq) don't include them in total_tokens
						totalTokens: input + outputTokens + cachedTokens,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					};
					calculateCost(model, output.usage);
				}

				const choice = chunk.choices[0];
				if (!choice) continue;

				if (choice.finish_reason) {
					output.stopReason = mapStopReason(choice.finish_reason);
				}

				if (choice.delta) {
					if (
						choice.delta.content !== null &&
						choice.delta.content !== undefined &&
						choice.delta.content.length > 0
					) {
						if (!currentBlock || currentBlock.type !== "text") {
							finishCurrentBlock(currentBlock);
							currentBlock = { type: "text", text: "" };
							output.content.push(currentBlock);
							stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
						}

						if (currentBlock.type === "text") {
							currentBlock.text += choice.delta.content;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: choice.delta.content,
								partial: output,
							});
						}
					}

					// Some endpoints return reasoning in reasoning_content (llama.cpp),
					// or reasoning (other openai compatible endpoints)
					const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];
					for (const field of reasoningFields) {
						if (
							(choice.delta as any)[field] !== null &&
							(choice.delta as any)[field] !== undefined &&
							(choice.delta as any)[field].length > 0
						) {
							if (!currentBlock || currentBlock.type !== "thinking") {
								finishCurrentBlock(currentBlock);
								currentBlock = {
									type: "thinking",
									thinking: "",
									thinkingSignature: field,
								};
								output.content.push(currentBlock);
								stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
							}

							if (currentBlock.type === "thinking") {
								const delta = (choice.delta as any)[field];
								currentBlock.thinking += delta;
								stream.push({
									type: "thinking_delta",
									contentIndex: blockIndex(),
									delta,
									partial: output,
								});
							}
						}
					}

					if (choice?.delta?.tool_calls) {
						for (const toolCall of choice.delta.tool_calls) {
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
								let delta = "";
								if (toolCall.function?.arguments) {
									delta = toolCall.function.arguments;
									currentBlock.partialArgs += toolCall.function.arguments;
									currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs);
								}
								stream.push({
									type: "toolcall_delta",
									contentIndex: blockIndex(),
									delta,
									partial: output,
								});
							}
						}
					}

					const reasoningDetails = (choice.delta as any).reasoning_details;
					if (reasoningDetails && Array.isArray(reasoningDetails)) {
						for (const detail of reasoningDetails) {
							if (detail.type === "reasoning.encrypted" && detail.id && detail.data) {
								const matchingToolCall = output.content.find(
									(b) => b.type === "toolCall" && b.id === detail.id,
								) as ToolCall | undefined;
								if (matchingToolCall) {
									matchingToolCall.thoughtSignature = JSON.stringify(detail);
								}
							}
						}
					}
				}
			}

			finishCurrentBlock(currentBlock);

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unkown error ocurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function createClient(model: Model<"openai-completions">, context: Context, apiKey?: string) {
	if (!apiKey) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = process.env.OPENAI_API_KEY;
	}

	const headers = { ...model.headers };
	if (model.provider === "github-copilot") {
		// Copilot expects X-Initiator to indicate whether the request is user-initiated
		// or agent-initiated (e.g. follow-up after assistant/tool messages). If there is
		// no prior message, default to user-initiated.
		const messages = context.messages || [];
		const lastMessage = messages[messages.length - 1];
		const isAgentCall = lastMessage ? lastMessage.role !== "user" : false;
		headers["X-Initiator"] = isAgentCall ? "agent" : "user";
		headers["Openai-Intent"] = "conversation-edits";

		// Copilot requires this header when sending images
		const hasImages = messages.some((msg) => {
			if (msg.role === "user" && Array.isArray(msg.content)) {
				return msg.content.some((c) => c.type === "image");
			}
			if (msg.role === "toolResult" && Array.isArray(msg.content)) {
				return msg.content.some((c) => c.type === "image");
			}
			return false;
		});
		if (hasImages) {
			headers["Copilot-Vision-Request"] = "true";
		}
	}

	return new OpenAI({
		apiKey,
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
	});
}

function buildParams(model: Model<"openai-completions">, context: Context, options?: OpenAICompletionsOptions) {
	const compat = getCompat(model);
	const messages = convertMessages(model, context, compat);

	const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: model.id,
		messages,
		stream: true,
		stream_options: { include_usage: true },
	};

	if (compat.supportsStore) {
		params.store = false;
	}

	if (options?.maxTokens) {
		if (compat.maxTokensField === "max_tokens") {
			(params as any).max_tokens = options.maxTokens;
		} else {
			params.max_completion_tokens = options.maxTokens;
		}
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	} else if (hasToolHistory(context.messages)) {
		// Anthropic (via LiteLLM/proxy) requires tools param when conversation has tool_calls/tool_results
		params.tools = [];
	}

	if (options?.toolChoice) {
		params.tool_choice = options.toolChoice;
	}

	if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
		params.reasoning_effort = options.reasoningEffort;
	}

	return params;
}

function convertMessages(
	model: Model<"openai-completions">,
	context: Context,
	compat: Required<OpenAICompat>,
): ChatCompletionMessageParam[] {
	const params: ChatCompletionMessageParam[] = [];

	const transformedMessages = transformMessages(context.messages, model);

	if (context.systemPrompt) {
		const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
		const role = useDeveloperRole ? "developer" : "system";
		params.push({ role: role, content: sanitizeSurrogates(context.systemPrompt) });
	}

	let lastRole: string | null = null;

	for (const msg of transformedMessages) {
		// Some providers (e.g. Mistral/Devstral) don't allow user messages directly after tool results
		// Insert a synthetic assistant message to bridge the gap
		if (compat.requiresAssistantAfterToolResult && lastRole === "toolResult" && msg.role === "user") {
			params.push({
				role: "assistant",
				content: "I have processed the tool results.",
			});
		}

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				params.push({
					role: "user",
					content: sanitizeSurrogates(msg.content),
				});
			} else {
				const content: ChatCompletionContentPart[] = msg.content.map((item): ChatCompletionContentPart => {
					if (item.type === "text") {
						return {
							type: "text",
							text: sanitizeSurrogates(item.text),
						} satisfies ChatCompletionContentPartText;
					} else {
						return {
							type: "image_url",
							image_url: {
								url: `data:${item.mimeType};base64,${item.data}`,
							},
						} satisfies ChatCompletionContentPartImage;
					}
				});
				const filteredContent = !model.input.includes("image")
					? content.filter((c) => c.type !== "image_url")
					: content;
				if (filteredContent.length === 0) continue;
				params.push({
					role: "user",
					content: filteredContent,
				});
			}
		} else if (msg.role === "assistant") {
			// Some providers (e.g. Mistral) don't accept null content, use empty string instead
			const assistantMsg: ChatCompletionAssistantMessageParam = {
				role: "assistant",
				content: compat.requiresAssistantAfterToolResult ? "" : null,
			};

			const textBlocks = msg.content.filter((b) => b.type === "text") as TextContent[];
			if (textBlocks.length > 0) {
				// GitHub Copilot requires assistant content as a string, not an array.
				// Sending as array causes Claude models to re-answer all previous prompts.
				if (model.provider === "github-copilot") {
					assistantMsg.content = textBlocks.map((b) => sanitizeSurrogates(b.text)).join("");
				} else {
					assistantMsg.content = textBlocks.map((b) => {
						return { type: "text", text: sanitizeSurrogates(b.text) };
					});
				}
			}

			// Handle thinking blocks
			const thinkingBlocks = msg.content.filter((b) => b.type === "thinking") as ThinkingContent[];
			if (thinkingBlocks.length > 0) {
				if (compat.requiresThinkingAsText) {
					// Convert thinking blocks to text with <thinking> delimiters
					const thinkingText = thinkingBlocks.map((b) => `<thinking>\n${b.thinking}\n</thinking>`).join("\n");
					const textContent = assistantMsg.content as Array<{ type: "text"; text: string }> | null;
					if (textContent) {
						textContent.unshift({ type: "text", text: thinkingText });
					} else {
						assistantMsg.content = [{ type: "text", text: thinkingText }];
					}
				} else {
					// Use the signature from the first thinking block if available (for llama.cpp server + gpt-oss)
					const signature = thinkingBlocks[0].thinkingSignature;
					if (signature && signature.length > 0) {
						(assistantMsg as any)[signature] = thinkingBlocks.map((b) => b.thinking).join("\n");
					}
				}
			}

			const toolCalls = msg.content.filter((b) => b.type === "toolCall") as ToolCall[];
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls.map((tc) => ({
					id: normalizeMistralToolId(tc.id, compat.requiresMistralToolIds),
					type: "function" as const,
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				}));
				const reasoningDetails = toolCalls
					.filter((tc) => tc.thoughtSignature)
					.map((tc) => {
						try {
							return JSON.parse(tc.thoughtSignature!);
						} catch {
							return null;
						}
					})
					.filter(Boolean);
				if (reasoningDetails.length > 0) {
					(assistantMsg as any).reasoning_details = reasoningDetails;
				}
			}
			// Skip assistant messages that have no content and no tool calls.
			// Mistral explicitly requires "either content or tool_calls, but not none".
			// Other providers also don't accept empty assistant messages.
			// This handles aborted assistant responses that got no content.
			const content = assistantMsg.content;
			const hasContent =
				content !== null &&
				content !== undefined &&
				(typeof content === "string" ? content.length > 0 : content.length > 0);
			if (!hasContent && !assistantMsg.tool_calls) {
				continue;
			}
			params.push(assistantMsg);
		} else if (msg.role === "toolResult") {
			// Extract text and image content
			const textResult = msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as any).text)
				.join("\n");
			const hasImages = msg.content.some((c) => c.type === "image");

			// Always send tool result with text (or placeholder if only images)
			const hasText = textResult.length > 0;
			// Some providers (e.g. Mistral) require the 'name' field in tool results
			const toolResultMsg: ChatCompletionToolMessageParam = {
				role: "tool",
				content: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
				tool_call_id: normalizeMistralToolId(msg.toolCallId, compat.requiresMistralToolIds),
			};
			if (compat.requiresToolResultName && msg.toolName) {
				(toolResultMsg as any).name = msg.toolName;
			}
			params.push(toolResultMsg);

			// If there are images and model supports them, send a follow-up user message with images
			if (hasImages && model.input.includes("image")) {
				const contentBlocks: Array<
					{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
				> = [];

				// Add text prefix
				contentBlocks.push({
					type: "text",
					text: "Attached image(s) from tool result:",
				});

				// Add images
				for (const block of msg.content) {
					if (block.type === "image") {
						contentBlocks.push({
							type: "image_url",
							image_url: {
								url: `data:${(block as any).mimeType};base64,${(block as any).data}`,
							},
						});
					}
				}

				params.push({
					role: "user",
					content: contentBlocks,
				});
			}
		}

		lastRole = msg.role;
	}

	return params;
}

function convertTools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters as any, // TypeBox already generates JSON Schema
		},
	}));
}

function mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"]): StopReason {
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
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}

/**
 * Detect compatibility settings from baseUrl for known providers.
 * Returns a fully resolved OpenAICompat object with all fields set.
 */
function detectCompatFromUrl(baseUrl: string): Required<OpenAICompat> {
	const isNonStandard =
		baseUrl.includes("cerebras.ai") ||
		baseUrl.includes("api.x.ai") ||
		baseUrl.includes("mistral.ai") ||
		baseUrl.includes("chutes.ai");

	const useMaxTokens = baseUrl.includes("mistral.ai") || baseUrl.includes("chutes.ai");

	const isGrok = baseUrl.includes("api.x.ai");

	const isMistral = baseUrl.includes("mistral.ai");

	return {
		supportsStore: !isNonStandard,
		supportsDeveloperRole: !isNonStandard,
		supportsReasoningEffort: !isGrok,
		maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
		requiresToolResultName: isMistral,
		requiresAssistantAfterToolResult: false, // Mistral no longer requires this as of Dec 2024
		requiresThinkingAsText: isMistral,
		requiresMistralToolIds: isMistral,
	};
}

/**
 * Get resolved compatibility settings for a model.
 * Uses explicit model.compat if provided, otherwise auto-detects from URL.
 */
function getCompat(model: Model<"openai-completions">): Required<OpenAICompat> {
	const detected = detectCompatFromUrl(model.baseUrl);
	if (!model.compat) return detected;

	return {
		supportsStore: model.compat.supportsStore ?? detected.supportsStore,
		supportsDeveloperRole: model.compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
		supportsReasoningEffort: model.compat.supportsReasoningEffort ?? detected.supportsReasoningEffort,
		maxTokensField: model.compat.maxTokensField ?? detected.maxTokensField,
		requiresToolResultName: model.compat.requiresToolResultName ?? detected.requiresToolResultName,
		requiresAssistantAfterToolResult:
			model.compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
		requiresThinkingAsText: model.compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
		requiresMistralToolIds: model.compat.requiresMistralToolIds ?? detected.requiresMistralToolIds,
	};
}
