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
	ToolCall,
	Usage,
} from "../types.js";

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
				"anthropic-beta": "oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
			};

			process.env.ANTHROPIC_API_KEY = undefined;
			this.client = new Anthropic({ apiKey: null, authToken: apiKey, baseURL: model.baseUrl, defaultHeaders });
			this.isOAuthToken = true;
		} else {
			this.client = new Anthropic({ apiKey, baseURL: model.baseUrl });
			this.isOAuthToken = false;
		}
		this.modelInfo = model;
	}

	getModel(): Model {
		return this.modelInfo;
	}

	async complete(context: Context, options?: AnthropicLLMOptions): Promise<AssistantMessage> {
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

			let blockType: "text" | "thinking" | "toolUse" | "other" = "other";
			let blockContent = "";
			let toolCall: (ToolCall & { partialJson: string }) | null = null;
			for await (const event of stream) {
				if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						blockType = "text";
						blockContent = "";
						options?.onEvent?.({ type: "text_start" });
					} else if (event.content_block.type === "thinking") {
						blockType = "thinking";
						blockContent = "";
						options?.onEvent?.({ type: "thinking_start" });
					} else if (event.content_block.type === "tool_use") {
						// We wait for the full tool use to be streamed to send the event
						toolCall = {
							type: "toolCall",
							id: event.content_block.id,
							name: event.content_block.name,
							arguments: event.content_block.input as Record<string, any>,
							partialJson: "",
						};
						blockType = "toolUse";
						blockContent = "";
					} else {
						blockType = "other";
						blockContent = "";
					}
				}
				if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						options?.onEvent?.({ type: "text_delta", content: blockContent, delta: event.delta.text });
						blockContent += event.delta.text;
					}
					if (event.delta.type === "thinking_delta") {
						options?.onEvent?.({ type: "thinking_delta", content: blockContent, delta: event.delta.thinking });
						blockContent += event.delta.thinking;
					}
					if (event.delta.type === "input_json_delta") {
						toolCall!.partialJson += event.delta.partial_json;
					}
				}
				if (event.type === "content_block_stop") {
					if (blockType === "text") {
						options?.onEvent?.({ type: "text_end", content: blockContent });
					} else if (blockType === "thinking") {
						options?.onEvent?.({ type: "thinking_end", content: blockContent });
					} else if (blockType === "toolUse") {
						const finalToolCall: ToolCall = {
							type: "toolCall",
							id: toolCall!.id,
							name: toolCall!.name,
							arguments: toolCall!.partialJson ? JSON.parse(toolCall!.partialJson) : toolCall!.arguments,
						};
						toolCall = null;
						options?.onEvent?.({ type: "toolCall", toolCall: finalToolCall });
					}
					blockType = "other";
				}
			}
			const msg = await stream.finalMessage();
			const blocks: AssistantMessage["content"] = [];
			for (const block of msg.content) {
				if (block.type === "text" && block.text) {
					blocks.push({
						type: "text",
						text: block.text,
					});
				} else if (block.type === "thinking" && block.thinking) {
					blocks.push({
						type: "thinking",
						thinking: block.thinking,
						thinkingSignature: block.signature,
					});
				} else if (block.type === "tool_use") {
					blocks.push({
						type: "toolCall",
						id: block.id,
						name: block.name,
						arguments: block.input as Record<string, any>,
					});
				}
			}

			const usage: Usage = {
				input: msg.usage.input_tokens,
				output: msg.usage.output_tokens,
				cacheRead: msg.usage.cache_read_input_tokens || 0,
				cacheWrite: msg.usage.cache_creation_input_tokens || 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			};
			calculateCost(this.modelInfo, usage);

			const output = {
				role: "assistant",
				content: blocks,
				provider: this.modelInfo.provider,
				model: this.modelInfo.id,
				usage,
				stopReason: this.mapStopReason(msg.stop_reason),
			} satisfies AssistantMessage;
			options?.onEvent?.({ type: "done", reason: output.stopReason, message: output });

			return output;
		} catch (error) {
			const output = {
				role: "assistant",
				content: [],
				provider: this.modelInfo.provider,
				model: this.modelInfo.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error",
				error: error instanceof Error ? error.message : JSON.stringify(error),
			} satisfies AssistantMessage;
			options?.onEvent?.({ type: "error", error: output.error });
			return output;
		}
	}

	private convertMessages(messages: Message[]): MessageParam[] {
		const params: MessageParam[] = [];

		for (const msg of messages) {
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
					params.push({
						role: "user",
						content: blocks,
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
