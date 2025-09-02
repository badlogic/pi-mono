import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
	Tool,
} from "@anthropic-ai/sdk/resources/messages.js";
import { QueuedGenerateStream } from "../generate.js";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	GenerateFunction,
	GenerateOptions,
	GenerateStream,
	Message,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../types.js";
import { transformMessages } from "./utils.js";

// Anthropic-specific options
export interface AnthropicOptions extends GenerateOptions {
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
	};
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

/**
 * Generate function for Anthropic API
 */
export const generateAnthropic: GenerateFunction<AnthropicOptions> = (
	model: Model,
	context: Context,
	options: AnthropicOptions,
): GenerateStream => {
	const stream = new QueuedGenerateStream();

	// Start async processing
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
			// Create Anthropic client
			const client = createAnthropicClient(model, options.apiKey!);

			// Convert messages
			const messages = convertMessages(context.messages, model, "anthropic-messages");

			// Build params
			const params = buildAnthropicParams(model, context, options, messages, client.isOAuthToken);

			// Create Anthropic stream
			const anthropicStream = client.client.messages.stream(
				{
					...params,
					stream: true,
				},
				{
					signal: options.signal,
				},
			);

			// Emit start event
			stream.push({
				type: "start",
				partial: output,
			});

			// Process Anthropic events
			let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;

			for await (const event of anthropicStream) {
				if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						currentBlock = {
							type: "text",
							text: "",
						};
						output.content.push(currentBlock);
						stream.push({ type: "text_start", partial: output });
					} else if (event.content_block.type === "thinking") {
						currentBlock = {
							type: "thinking",
							thinking: "",
							thinkingSignature: "",
						};
						output.content.push(currentBlock);
						stream.push({ type: "thinking_start", partial: output });
					} else if (event.content_block.type === "tool_use") {
						// We wait for the full tool use to be streamed
						currentBlock = {
							type: "toolCall",
							id: event.content_block.id,
							name: event.content_block.name,
							arguments: event.content_block.input as Record<string, any>,
							partialJson: "",
						};
					}
				} else if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						if (currentBlock && currentBlock.type === "text") {
							currentBlock.text += event.delta.text;
							stream.push({
								type: "text_delta",
								delta: event.delta.text,
								partial: output,
							});
						}
					} else if (event.delta.type === "thinking_delta") {
						if (currentBlock && currentBlock.type === "thinking") {
							currentBlock.thinking += event.delta.thinking;
							stream.push({
								type: "thinking_delta",
								delta: event.delta.thinking,
								partial: output,
							});
						}
					} else if (event.delta.type === "input_json_delta") {
						if (currentBlock && currentBlock.type === "toolCall") {
							currentBlock.partialJson += event.delta.partial_json;
						}
					} else if (event.delta.type === "signature_delta") {
						if (currentBlock && currentBlock.type === "thinking") {
							currentBlock.thinkingSignature = currentBlock.thinkingSignature || "";
							currentBlock.thinkingSignature += event.delta.signature;
						}
					}
				} else if (event.type === "content_block_stop") {
					if (currentBlock) {
						if (currentBlock.type === "text") {
							stream.push({ type: "text_end", content: currentBlock.text, partial: output });
						} else if (currentBlock.type === "thinking") {
							stream.push({ type: "thinking_end", content: currentBlock.thinking, partial: output });
						} else if (currentBlock.type === "toolCall") {
							const finalToolCall: ToolCall = {
								type: "toolCall",
								id: currentBlock.id,
								name: currentBlock.name,
								arguments: JSON.parse(currentBlock.partialJson),
							};
							output.content.push(finalToolCall);
							stream.push({ type: "toolCall", toolCall: finalToolCall, partial: output });
						}
						currentBlock = null;
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

			// Emit done event with final message
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = "error";
			output.error = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", error: output.error, partial: output });
			stream.end();
		}
	})();

	return stream;
};

// Helper to create Anthropic client
interface AnthropicClientWrapper {
	client: Anthropic;
	isOAuthToken: boolean;
}

function createAnthropicClient(model: Model, apiKey: string): AnthropicClientWrapper {
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

// Build Anthropic API params
function buildAnthropicParams(
	model: Model,
	context: Context,
	options: AnthropicOptions,
	messages: MessageParam[],
	isOAuthToken: boolean,
): MessageCreateParamsStreaming {
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages,
		max_tokens: options.maxTokens || model.maxTokens,
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

	if (options.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	}

	// Only enable thinking if the model supports it
	if (options.thinking?.enabled && model.reasoning) {
		params.thinking = {
			type: "enabled",
			budget_tokens: options.thinking.budgetTokens || 1024,
		};
	}

	if (options.toolChoice) {
		if (typeof options.toolChoice === "string") {
			params.tool_choice = { type: options.toolChoice };
		} else {
			params.tool_choice = options.toolChoice;
		}
	}

	return params;
}

// Convert messages to Anthropic format
function convertMessages(messages: Message[], model: Model, api: Api): MessageParam[] {
	const params: MessageParam[] = [];

	// Transform messages for cross-provider compatibility
	const transformedMessages = transformMessages(messages, model, api);

	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			// Handle both string and array content
			if (typeof msg.content === "string") {
				params.push({
					role: "user",
					content: msg.content,
				});
			} else {
				// Convert array content to Anthropic format
				const blocks: ContentBlockParam[] = msg.content.map((item) => {
					if (item.type === "text") {
						return {
							type: "text",
							text: item.text,
						};
					} else {
						// Image content
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
				const filteredBlocks = !model?.input.includes("image") ? blocks.filter((b) => b.type !== "image") : blocks;
				params.push({
					role: "user",
					content: filteredBlocks,
				});
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					blocks.push({
						type: "text",
						text: block.text,
					});
				} else if (block.type === "thinking") {
					blocks.push({
						type: "thinking",
						thinking: block.thinking,
						signature: block.thinkingSignature || "",
					});
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: block.name,
						input: block.arguments,
					});
				}
			}

			params.push({
				role: "assistant",
				content: blocks,
			});
		} else if (msg.role === "toolResult") {
			params.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: msg.toolCallId,
						content: msg.content,
						is_error: msg.isError,
					},
				],
			});
		}
	}
	return params;
}

// Convert tools to Anthropic format
function convertTools(tools: Context["tools"]): Tool[] {
	if (!tools) return [];

	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: {
			type: "object" as const,
			properties: tool.parameters.properties || {},
			required: tool.parameters.required || [],
		},
	}));
}

// Map Anthropic stop reason to our StopReason type
function mapStopReason(reason: Anthropic.Messages.StopReason | null): StopReason {
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
		default:
			return "stop";
	}
}
