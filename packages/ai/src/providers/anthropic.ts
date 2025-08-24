import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
	Tool,
} from "@anthropic-ai/sdk/resources/messages.js";
import type {
	AssistantMessage,
	Context,
	LLM,
	LLMOptions,
	Message,
	StopReason,
	TokenUsage,
	ToolCall,
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
	private model: string;

	constructor(model: string, apiKey?: string, baseUrl?: string) {
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
			this.client = new Anthropic({ apiKey: null, authToken: apiKey, baseURL: baseUrl, defaultHeaders });
		} else {
			this.client = new Anthropic({ apiKey, baseURL: baseUrl });
		}
		this.model = model;
	}

	async complete(context: Context, options?: AnthropicLLMOptions): Promise<AssistantMessage> {
		try {
			const messages = this.convertMessages(context.messages);

			const params: MessageCreateParamsStreaming = {
				model: this.model,
				messages,
				max_tokens: options?.maxTokens || 4096,
				stream: true,
			};

			if (context.systemPrompt) {
				params.system = [
					{
						type: "text",
						text: "You are Claude Code, Anthropic's official CLI for Claude.",
						cache_control: {
							type: "ephemeral",
						},
					},
					{
						type: "text",
						text: context.systemPrompt,
						cache_control: {
							type: "ephemeral",
						},
					},
				];
			}

			if (options?.temperature !== undefined) {
				params.temperature = options?.temperature;
			}

			if (context.tools) {
				params.tools = this.convertTools(context.tools);
			}

			if (options?.thinking?.enabled) {
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

			let blockType: "text" | "thinking" | "other" = "other";
			for await (const event of stream) {
				if (event.type === "content_block_start") {
					if (event.content_block.type === "text") {
						blockType = "text";
					} else if (event.content_block.type === "thinking") {
						blockType = "thinking";
					} else {
						blockType = "other";
					}
				}
				if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						options?.onText?.(event.delta.text, false);
					}
					if (event.delta.type === "thinking_delta") {
						options?.onThinking?.(event.delta.thinking, false);
					}
				}
				if (event.type === "content_block_stop") {
					if (blockType === "text") {
						options?.onText?.("", true);
					} else if (blockType === "thinking") {
						options?.onThinking?.("", true);
					}
					blockType = "other";
				}
			}
			const msg = await stream.finalMessage();
			const thinking = msg.content.some((block) => block.type === "thinking")
				? msg.content
						.filter((block) => block.type === "thinking")
						.map((block) => block.thinking)
						.join("\n")
				: undefined;
			// This is kinda wrong if there is more than one thinking block. We do not use interleaved thinking though, so we should
			// always have a single thinking block.
			const thinkingSignature = msg.content.some((block) => block.type === "thinking")
				? msg.content
						.filter((block) => block.type === "thinking")
						.map((block) => block.signature)
						.join("\n")
				: undefined;
			const content = msg.content.some((block) => block.type === "text")
				? msg.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n")
				: undefined;
			const toolCalls: ToolCall[] = msg.content
				.filter((block) => block.type === "tool_use")
				.map((block) => ({
					id: block.id,
					name: block.name,
					arguments: block.input as Record<string, any>,
				}));
			const usage: TokenUsage = {
				input: msg.usage.input_tokens,
				output: msg.usage.output_tokens,
				cacheRead: msg.usage.cache_read_input_tokens || 0,
				cacheWrite: msg.usage.cache_creation_input_tokens || 0,
				// TODO add cost
			};

			return {
				role: "assistant",
				content,
				thinking,
				thinkingSignature,
				toolCalls,
				model: this.model,
				usage,
				stopResaon: this.mapStopReason(msg.stop_reason),
			};
		} catch (error) {
			return {
				role: "assistant",
				model: this.model,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				stopResaon: "error",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private convertMessages(messages: Message[]): MessageParam[] {
		const params: MessageParam[] = [];

		for (const msg of messages) {
			if (msg.role === "user") {
				params.push({
					role: "user",
					content: msg.content,
				});
			} else if (msg.role === "assistant") {
				const blocks: ContentBlockParam[] = [];

				if (msg.thinking && msg.thinkingSignature) {
					blocks.push({
						type: "thinking",
						thinking: msg.thinking,
						signature: msg.thinkingSignature,
					});
				}

				if (msg.content) {
					blocks.push({
						type: "text",
						text: msg.content,
					});
				}

				if (msg.toolCalls) {
					for (const toolCall of msg.toolCalls) {
						blocks.push({
							type: "tool_use",
							id: toolCall.id,
							name: toolCall.name,
							input: toolCall.arguments,
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
