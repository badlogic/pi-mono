import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
	Tool,
} from "@anthropic-ai/sdk/resources/messages.js";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	LLM,
	LLMOptions,
	Message,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../types.js";
import { transformMessages } from "./utils.js";

export interface AnthropicLLMOptions extends LLMOptions {
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
	};
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

export class AnthropicLLM implements LLM<AnthropicLLMOptions> {
	private client: Anthropic;
	private modelInfo: Model;
	private isOAuthToken: boolean = false;

	constructor(model: Model, apiKey?: string) {
		if (!apiKey) {
			if (!process.env.ANTHROPIC_API_KEY) {
				throw new Error(
					"Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass it as an argument.",
				);
			}
			apiKey = process.env.ANTHROPIC_API_KEY;
		}
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
			this.client = new Anthropic({
				apiKey: null,
				authToken: apiKey,
				baseURL: model.baseUrl,
				defaultHeaders,
				dangerouslyAllowBrowser: true,
			});
			this.isOAuthToken = true;
		} else {
			const defaultHeaders = {
				accept: "application/json",
				"anthropic-dangerous-direct-browser-access": "true",
				"anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
			};
			this.client = new Anthropic({ apiKey, baseURL: model.baseUrl, dangerouslyAllowBrowser: true, defaultHeaders });
			this.isOAuthToken = false;
		}
		this.modelInfo = model;
	}

	getModel(): Model {
		return this.modelInfo;
	}

	getApi(): string {
		return "anthropic-messages";
	}

	async generate(context: Context, options?: AnthropicLLMOptions): Promise<AssistantMessage> {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: this.getApi(),
			provider: this.modelInfo.provider,
			model: this.modelInfo.id,
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
			const messages = this.convertMessages(context.messages);

			const params: MessageCreateParamsStreaming = {
				model: this.modelInfo.id,
				messages,
				max_tokens: options?.maxTokens || 4096,
				stream: true,
			};

			// For OAuth tokens, we MUST include Claude Code identity
			if (this.isOAuthToken) {
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
				params.temperature = options?.temperature;
			}

			if (context.tools) {
				params.tools = this.convertTools(context.tools);
			}

			// Only enable thinking if the model supports it
			if (options?.thinking?.enabled && this.modelInfo.reasoning) {
				params.thinking = {
					type: "enabled",
					budget_tokens: options.thinking.budgetTokens || 1024,
				};
			}

			if (options?.toolChoice) {
				if (typeof options.toolChoice === "string") {
					params.tool_choice = { type: options.toolChoice };
				} else {
					params.tool_choice = options.toolChoice;
				}
			}

			const stream = this.client.messages.stream(
				{
					...params,
					stream: true,
				},
				{
					signal: options?.signal,
				},
			);

			options?.onEvent?.({ type: "start", model: this.modelInfo.id, provider: this.modelInfo.provider });

			let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
			for await (const event of stream) {
				if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						currentBlock = {
							type: "text",
							text: "",
						};
						output.content.push(currentBlock);
						options?.onEvent?.({ type: "text_start" });
					} else if (event.content_block.type === "thinking") {
						currentBlock = {
							type: "thinking",
							thinking: "",
							thinkingSignature: "",
						};
						output.content.push(currentBlock);
						options?.onEvent?.({ type: "thinking_start" });
					} else if (event.content_block.type === "tool_use") {
						// We wait for the full tool use to be streamed to send the event
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
							options?.onEvent?.({ type: "text_delta", content: currentBlock.text, delta: event.delta.text });
						}
					} else if (event.delta.type === "thinking_delta") {
						if (currentBlock && currentBlock.type === "thinking") {
							currentBlock.thinking += event.delta.thinking;
							options?.onEvent?.({
								type: "thinking_delta",
								content: currentBlock.thinking,
								delta: event.delta.thinking,
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
							options?.onEvent?.({ type: "text_end", content: currentBlock.text });
						} else if (currentBlock.type === "thinking") {
							options?.onEvent?.({ type: "thinking_end", content: currentBlock.thinking });
						} else if (currentBlock.type === "toolCall") {
							const finalToolCall: ToolCall = {
								type: "toolCall",
								id: currentBlock.id,
								name: currentBlock.name,
								arguments: JSON.parse(currentBlock.partialJson),
							};
							output.content.push(finalToolCall);
							options?.onEvent?.({ type: "toolCall", toolCall: finalToolCall });
						}
						currentBlock = null;
					}
				} else if (event.type === "message_delta") {
					if (event.delta.stop_reason) {
						output.stopReason = this.mapStopReason(event.delta.stop_reason);
					}
					output.usage.input += event.usage.input_tokens || 0;
					output.usage.output += event.usage.output_tokens || 0;
					output.usage.cacheRead += event.usage.cache_read_input_tokens || 0;
					output.usage.cacheWrite += event.usage.cache_creation_input_tokens || 0;
					calculateCost(this.modelInfo, output.usage);
				}
			}

			options?.onEvent?.({ type: "done", reason: output.stopReason, message: output });
			return output;
		} catch (error) {
			output.stopReason = "error";
			output.error = error instanceof Error ? error.message : JSON.stringify(error);
			options?.onEvent?.({ type: "error", error: output.error });
			return output;
		}
	}

	private convertMessages(messages: Message[]): MessageParam[] {
		const params: MessageParam[] = [];

		// Transform messages for cross-provider compatibility
		const transformedMessages = transformMessages(messages, this.modelInfo, this.getApi());

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
					const filteredBlocks = !this.modelInfo?.input.includes("image")
						? blocks.filter((b) => b.type !== "image")
						: blocks;
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

	private convertTools(tools: Context["tools"]): Tool[] {
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

	private mapStopReason(reason: Anthropic.Messages.StopReason | null): StopReason {
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
}
