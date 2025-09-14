import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AssistantMessageEventStream } from "../event-stream.js";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
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
import { validateToolArguments } from "../validation.js";
import { transformMessages } from "./transorm-messages.js";

export interface AnthropicOptions extends StreamOptions {
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

export const streamAnthropic: StreamFunction<"anthropic-messages"> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "anthropic-messages" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
		};

		try {
			const { client, isOAuthToken } = createClient(model, options?.apiKey!);
			const params = buildParams(model, context, isOAuthToken, options);
			const anthropicStream = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
			const blocks = output.content as Block[];

			for await (const event of anthropicStream) {
				if (event.type === "content_block_start") {
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
							block.arguments = JSON.parse(block.partialJson);

							// Validate tool arguments if tool definition is available
							if (context.tools) {
								const tool = context.tools.find((t) => t.name === block.name);
								if (tool) {
									block.arguments = validateToolArguments(tool, block);
								}
							}

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
					output.usage.input += event.usage.input_tokens || 0;
					output.usage.output += event.usage.output_tokens || 0;
					output.usage.cacheRead += event.usage.cache_read_input_tokens || 0;
					output.usage.cacheWrite += event.usage.cache_creation_input_tokens || 0;
					calculateCost(model, output.usage);
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = "error";
			output.error = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", error: output.error, partial: output });
			stream.end();
		}
	})();

	return stream;
};

function createClient(
	model: Model<"anthropic-messages">,
	apiKey: string,
): { client: Anthropic; isOAuthToken: boolean } {
	if (apiKey.includes("sk-ant-oat")) {
		const defaultHeaders = {
			accept: "application/json",
			"anthropic-dangerous-direct-browser-access": "true",
			"anthropic-beta": "oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
		};

		// Clear the env var if we're in Node.js to prevent SDK from using it
		if (typeof process !== "undefined" && process.env) {
			process.env.ANTHROPIC_API_KEY = undefined;
		}

		const client = new Anthropic({
			apiKey: null,
			authToken: apiKey,
			baseURL: model.baseUrl,
			defaultHeaders,
			dangerouslyAllowBrowser: true,
		});

		return { client, isOAuthToken: true };
	} else {
		const defaultHeaders = {
			accept: "application/json",
			"anthropic-dangerous-direct-browser-access": "true",
			"anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
		};

		const client = new Anthropic({
			apiKey,
			baseURL: model.baseUrl,
			dangerouslyAllowBrowser: true,
			defaultHeaders,
		});

		return { client, isOAuthToken: false };
	}
}

function buildParams(
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuthToken: boolean,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages: convertMessages(context.messages, model),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		stream: true,
	};

	// For OAuth tokens, we MUST include Claude Code identity
	if (isOAuthToken) {
		params.system = [
			{
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
				cache_control: {
					type: "ephemeral",
				},
			},
		];
		if (context.systemPrompt) {
			params.system.push({
				type: "text",
				text: context.systemPrompt,
				cache_control: {
					type: "ephemeral",
				},
			});
		}
	} else if (context.systemPrompt) {
		params.system = context.systemPrompt;
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

function convertMessages(messages: Message[], model: Model<"anthropic-messages">): MessageParam[] {
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
						content: msg.content,
					});
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map((item) => {
					if (item.type === "text") {
						return {
							type: "text",
							text: item.text,
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
						text: block.text,
					});
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					blocks.push({
						type: "thinking",
						thinking: block.thinking,
						signature: block.thinkingSignature || "",
					});
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
			// Collect all consecutive toolResult messages, needed for z.ai Anthropic endpoint
			const toolResults: ContentBlockParam[] = [];

			// Add the current tool result
			toolResults.push({
				type: "tool_result",
				tool_use_id: sanitizeToolCallId(msg.toolCallId),
				content: msg.output,
				is_error: msg.isError,
			});

			// Look ahead for consecutive toolResult messages
			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage; // We know it's a toolResult
				toolResults.push({
					type: "tool_result",
					tool_use_id: sanitizeToolCallId(nextMsg.toolCallId),
					content: nextMsg.output,
					is_error: nextMsg.isError,
				});
				j++;
			}

			// Skip the messages we've already processed
			i = j - 1;

			// Add a single user message with all tool results
			params.push({
				role: "user",
				content: toolResults,
			});
		}
	}
	return params;
}

function convertTools(tools: Tool[]): Anthropic.Messages.Tool[] {
	if (!tools) return [];

	return tools.map((tool) => {
		const jsonSchema = zodToJsonSchema(tool.parameters, { $refStrategy: "none" }) as any;

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

function mapStopReason(reason: Anthropic.Messages.StopReason): StopReason {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "safety";
		case "pause_turn": // Stop is good enough -> resubmit
			return "stop";
		case "stop_sequence":
			return "stop"; // We don't supply stop sequences, so this should never happen
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
