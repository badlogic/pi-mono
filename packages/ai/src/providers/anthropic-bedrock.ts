import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type {
	BetaStopReason,
	MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { calculateCost } from "../models.js";
import { getEnvApiKey } from "../stream.js";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";

import { transformMessages } from "./transform-messages.js";

/**
 * Convert content blocks to Anthropic API format
 */
function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	// If only text blocks, return as concatenated string for simplicity
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	// If we have images, convert to content block array
	const blocks = content.map((block) => {
		if (block.type === "text") {
			return {
				type: "text" as const,
				text: sanitizeSurrogates(block.text),
			};
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	// If only images (no text), add placeholder text block
	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

export interface AnthropicBedrockOptions extends StreamOptions {
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	interleavedThinking?: boolean;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	/** AWS region for Bedrock. Defaults to AWS_REGION env var or us-east-1 */
	awsRegion?: string;
}

export const streamAnthropicBedrock: StreamFunction<"anthropic-bedrock"> = (
	model: Model<"anthropic-bedrock">,
	context: Context,
	options?: AnthropicBedrockOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "anthropic-bedrock" as Api,
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
			const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";
			const client = createClient(model, apiKey, options);
			const params = buildParams(model, context, options);
			const anthropicStream = client.beta.messages.stream({ ...params, stream: true }, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
			const blocks = output.content as Block[];

			for await (const event of anthropicStream) {
				if (event.type === "message_start") {
					// Bedrock does not consistently support token usage reporting.
					// Be defensive in case the stream is aborted early.
					const usage = (
						event.message as unknown as {
							usage?: {
								input_tokens?: number;
								output_tokens?: number;
								cache_read_input_tokens?: number;
								cache_creation_input_tokens?: number;
							};
						}
					).usage;

					output.usage.input = usage?.input_tokens ?? 0;
					output.usage.output = usage?.output_tokens ?? 0;
					output.usage.cacheRead = usage?.cache_read_input_tokens ?? 0;
					output.usage.cacheWrite = usage?.cache_creation_input_tokens ?? 0;
					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				} else if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						const block: Block = {
							type: "text",
							text: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "thinking") {
						const block: Block = {
							type: "thinking",
							thinking: "",
							thinkingSignature: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "tool_use") {
						const block: Block = {
							type: "toolCall",
							id: event.content_block.id,
							name: event.content_block.name,
							arguments: event.content_block.input as Record<string, any>,
							partialJson: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}
				} else if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "text") {
							block.text += event.delta.text;
							stream.push({
								type: "text_delta",
								contentIndex: index,
								delta: event.delta.text,
								partial: output,
							});
						}
					} else if (event.delta.type === "thinking_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinking += event.delta.thinking;
							stream.push({
								type: "thinking_delta",
								contentIndex: index,
								delta: event.delta.thinking,
								partial: output,
							});
						}
					} else if (event.delta.type === "input_json_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "toolCall") {
							block.partialJson += event.delta.partial_json;
							block.arguments = parseStreamingJson(block.partialJson);
							stream.push({
								type: "toolcall_delta",
								contentIndex: index,
								delta: event.delta.partial_json,
								partial: output,
							});
						}
					} else if (event.delta.type === "signature_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinkingSignature = block.thinkingSignature || "";
							block.thinkingSignature += event.delta.signature;
						}
					}
				} else if (event.type === "content_block_stop") {
					const index = blocks.findIndex((b) => b.index === event.index);
					const block = blocks[index];
					if (block) {
						delete (block as any).index;
						if (block.type === "text") {
							stream.push({
								type: "text_end",
								contentIndex: index,
								content: block.text,
								partial: output,
							});
						} else if (block.type === "thinking") {
							stream.push({
								type: "thinking_end",
								contentIndex: index,
								content: block.thinking,
								partial: output,
							});
						} else if (block.type === "toolCall") {
							block.arguments = parseStreamingJson(block.partialJson);
							delete (block as any).partialJson;
							stream.push({
								type: "toolcall_end",
								contentIndex: index,
								toolCall: block,
								partial: output,
							});
						}
					}
				} else if (event.type === "message_delta") {
					if (event.delta.stop_reason) {
						output.stopReason = mapStopReason(event.delta.stop_reason);
					}

					const usage = (
						event as unknown as {
							usage?: {
								input_tokens?: number;
								output_tokens?: number;
								cache_read_input_tokens?: number;
								cache_creation_input_tokens?: number;
							};
						}
					).usage;

					if (usage?.input_tokens !== undefined) output.usage.input = usage.input_tokens;
					if (usage?.output_tokens !== undefined) output.usage.output = usage.output_tokens;
					if (usage?.cache_read_input_tokens !== undefined) output.usage.cacheRead = usage.cache_read_input_tokens;
					if (usage?.cache_creation_input_tokens !== undefined)
						output.usage.cacheWrite = usage.cache_creation_input_tokens;

					output.usage.totalTokens =
						output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
					calculateCost(model, output.usage);
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
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

/**
 * Parse AWS credentials from API key string.
 * Supports formats:
 * - Empty/undefined: Use default AWS credential chain
 * - "accessKey:secretKey": Basic credentials
 * - "accessKey:secretKey:sessionToken": Temporary credentials
 */
function parseAwsCredentials(apiKey: string | undefined): {
	awsAccessKey?: string;
	awsSecretKey?: string;
	awsSessionToken?: string;
} {
	if (!apiKey || apiKey.trim() === "") {
		// Use default credential chain
		return {};
	}

	const parts = apiKey.split(":");
	if (parts.length === 2) {
		return {
			awsAccessKey: parts[0],
			awsSecretKey: parts[1],
		};
	}
	if (parts.length >= 3) {
		return {
			awsAccessKey: parts[0],
			awsSecretKey: parts[1],
			awsSessionToken: parts.slice(2).join(":"),
		};
	}

	// Single value, treat as empty and use default chain
	return {};
}

function createClient(
	model: Model<"anthropic-bedrock">,
	apiKey: string | undefined,
	options?: AnthropicBedrockOptions,
): AnthropicBedrock {
	const credentials = parseAwsCredentials(apiKey);
	const awsRegion = options?.awsRegion || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

	const baseUrl = model.baseUrl.includes("{region}")
		? model.baseUrl.replace("{region}", awsRegion)
		: model.baseUrl || undefined;

	const defaultHeaders = {
		accept: "application/json",
		"anthropic-dangerous-direct-browser-access": "true",
		...(model.headers || {}),
	};

	const client = new AnthropicBedrock({
		awsAccessKey: credentials.awsAccessKey,
		awsSecretKey: credentials.awsSecretKey,
		awsSessionToken: credentials.awsSessionToken,
		awsRegion,
		baseURL: baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders,
	});

	return client;
}

function buildParams(
	model: Model<"anthropic-bedrock">,
	context: Context,
	options?: AnthropicBedrockOptions,
): MessageCreateParamsStreaming {
	const betaFeatures = ["fine-grained-tool-streaming-2025-05-14"];
	if (options?.interleavedThinking !== false) {
		betaFeatures.push("interleaved-thinking-2025-05-14");
	}

	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages: convertMessages(context.messages, model),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		betas: betaFeatures,
		stream: true,
	};

	if (context.systemPrompt) {
		params.system = [
			{
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				cache_control: {
					type: "ephemeral",
				},
			},
		];
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	}

	if (options?.thinkingEnabled && model.reasoning) {
		params.thinking = {
			type: "enabled",
			budget_tokens: options.thinkingBudgetTokens || 1024,
		};
	}

	if (options?.toolChoice) {
		if (typeof options.toolChoice === "string") {
			params.tool_choice = { type: options.toolChoice };
		} else {
			params.tool_choice = options.toolChoice;
		}
	}

	return params;
}

// Sanitize tool call IDs to match Anthropic's required pattern: ^[a-zA-Z0-9_-]+$
function sanitizeToolCallId(id: string): string {
	// Replace any character that isn't alphanumeric, underscore, or hyphen with underscore
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function convertMessages(messages: Message[], model: Model<"anthropic-bedrock">): MessageParam[] {
	const params: MessageParam[] = [];

	// Transform messages for cross-provider compatibility
	const transformedMessages = transformMessages(messages, model);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({
						role: "user",
						content: sanitizeSurrogates(msg.content),
					});
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map((item) => {
					if (item.type === "text") {
						return {
							type: "text",
							text: sanitizeSurrogates(item.text),
						};
					} else {
						return {
							type: "image",
							source: {
								type: "base64",
								media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
								data: item.data,
							},
						};
					}
				});
				let filteredBlocks = !model?.input.includes("image") ? blocks.filter((b) => b.type !== "image") : blocks;
				filteredBlocks = filteredBlocks.filter((b) => {
					if (b.type === "text") {
						return b.text.trim().length > 0;
					}
					return true;
				});
				if (filteredBlocks.length === 0) continue;
				params.push({
					role: "user",
					content: filteredBlocks,
				});
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({
						type: "text",
						text: sanitizeSurrogates(block.text),
					});
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					// If thinking signature is missing/empty (e.g., from aborted stream),
					// convert to plain text block without <thinking> tags to avoid API rejection
					// and prevent Claude from mimicking the tags in responses
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push({
							type: "text",
							text: sanitizeSurrogates(block.thinking),
						});
					} else {
						blocks.push({
							type: "thinking",
							thinking: sanitizeSurrogates(block.thinking),
							signature: block.thinkingSignature,
						});
					}
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: sanitizeToolCallId(block.id),
						name: block.name,
						input: block.arguments,
					});
				}
			}
			if (blocks.length === 0) continue;
			params.push({
				role: "assistant",
				content: blocks,
			});
		} else if (msg.role === "toolResult") {
			// Collect all consecutive toolResult messages
			const toolResults: ContentBlockParam[] = [];

			toolResults.push({
				type: "tool_result",
				tool_use_id: sanitizeToolCallId(msg.toolCallId),
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});

			// Look ahead for consecutive toolResult messages
			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage;
				toolResults.push({
					type: "tool_result",
					tool_use_id: sanitizeToolCallId(nextMsg.toolCallId),
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}

			// Skip the messages we've already processed
			i = j - 1;

			params.push({
				role: "user",
				content: toolResults,
			});
		}
	}

	// Add cache_control to the last user message to cache conversation history
	if (params.length > 0) {
		const lastMessage = params[params.length - 1];
		if (lastMessage.role === "user") {
			// Add cache control to the last content block
			if (Array.isArray(lastMessage.content)) {
				const lastBlock = lastMessage.content[lastMessage.content.length - 1];
				if (
					lastBlock &&
					(lastBlock.type === "text" || lastBlock.type === "image" || lastBlock.type === "tool_result")
				) {
					(lastBlock as any).cache_control = { type: "ephemeral" };
				}
			}
		}
	}

	return params;
}

function convertTools(tools: Tool[]): Anthropic.Messages.Tool[] {
	if (!tools) return [];

	return tools.map((tool) => {
		const jsonSchema = tool.parameters as any;

		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object" as const,
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

function mapStopReason(reason: Anthropic.Messages.StopReason | BetaStopReason): StopReason {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "error";
		case "pause_turn":
			return "stop";
		case "stop_sequence":
			return "stop";
		case "model_context_window_exceeded":
			return "error";
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
