import OpenAI from "openai";
import type { ChatCompletionChunk, ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type {
	AssistantMessage,
	Context,
	LLM,
	LLMOptions,
	Message,
	StopReason,
	TokenUsage,
	Tool,
	ToolCall,
} from "../types.js";

export interface OpenAICompletionsLLMOptions extends LLMOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "low" | "medium" | "high";
}

export class OpenAICompletionsLLM implements LLM<OpenAICompletionsLLMOptions> {
	private client: OpenAI;
	private model: string;

	constructor(model: string, apiKey?: string, baseUrl?: string) {
		if (!apiKey) {
			if (!process.env.OPENAI_API_KEY) {
				throw new Error(
					"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
				);
			}
			apiKey = process.env.OPENAI_API_KEY;
		}
		this.client = new OpenAI({ apiKey, baseURL: baseUrl });
		this.model = model;
	}

	async complete(request: Context, options?: OpenAICompletionsLLMOptions): Promise<AssistantMessage> {
		try {
			const messages = this.convertMessages(request.messages, request.systemPrompt);

			const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: this.model,
				messages,
				stream: true,
				stream_options: { include_usage: true },
				store: false,
			};

			if (options?.maxTokens) {
				params.max_completion_tokens = options?.maxTokens;
			}

			if (options?.temperature !== undefined) {
				params.temperature = options?.temperature;
			}

			if (request.tools) {
				params.tools = this.convertTools(request.tools);
			}

			if (options?.toolChoice) {
				params.tool_choice = options.toolChoice;
			}

			if (options?.reasoningEffort && this.isReasoningModel()) {
				params.reasoning_effort = options.reasoningEffort;
			}

			const stream = await this.client.chat.completions.create(params, {
				signal: options?.signal,
			});

			let content = "";
			const toolCallsMap = new Map<
				number,
				{
					id: string;
					name: string;
					arguments: string;
				}
			>();
			let usage: TokenUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			};
			let finishReason: ChatCompletionChunk.Choice["finish_reason"] | null = null;

			let inTextBlock = false;
			for await (const chunk of stream) {
				const choice = chunk.choices[0];

				// Handle text content
				if (choice?.delta?.content) {
					content += choice.delta.content;
					options?.onText?.(choice.delta.content, false);
					inTextBlock = true;
				}

				// Handle tool calls
				if (choice?.delta?.tool_calls) {
					if (inTextBlock) {
						// If we were in a text block, signal its end
						options?.onText?.("", true);
						inTextBlock = false;
					}
					for (const toolCall of choice.delta.tool_calls) {
						const index = toolCall.index;

						if (!toolCallsMap.has(index)) {
							toolCallsMap.set(index, {
								id: toolCall.id || "",
								name: toolCall.function?.name || "",
								arguments: "",
							});
						}

						const existing = toolCallsMap.get(index)!;
						if (toolCall.id) existing.id = toolCall.id;
						if (toolCall.function?.name) existing.name = toolCall.function.name;
						if (toolCall.function?.arguments) {
							existing.arguments += toolCall.function.arguments;
						}
					}
				}

				// Capture finish reason
				if (choice?.finish_reason) {
					if (inTextBlock) {
						// If we were in a text block, signal its end
						options?.onText?.("", true);
						inTextBlock = false;
					}
					finishReason = choice.finish_reason;
				}

				// Capture usage
				if (chunk.usage) {
					usage = {
						input: chunk.usage.prompt_tokens || 0,
						output: chunk.usage.completion_tokens || 0,
						cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						cacheWrite: 0,
					};

					// Note: reasoning tokens are in completion_tokens_details?.reasoning_tokens
					// but we don't have actual thinking content from Chat Completions API
				}
			}

			// Convert tool calls map to array
			const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
				id: tc.id,
				name: tc.name,
				arguments: JSON.parse(tc.arguments),
			}));

			return {
				role: "assistant",
				content: content || undefined,
				thinking: undefined, // Chat Completions doesn't provide actual thinking content
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				model: this.model,
				usage,
				stopReason: this.mapStopReason(finishReason),
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
				stopReason: "error",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private convertMessages(messages: Message[], systemPrompt?: string): ChatCompletionMessageParam[] {
		const params: ChatCompletionMessageParam[] = [];

		// Add system prompt if provided
		if (systemPrompt) {
			const role = this.isReasoningModel() ? "developer" : "system";
			params.push({ role: role, content: systemPrompt });
		}

		// Convert messages
		for (const msg of messages) {
			if (msg.role === "user") {
				params.push({
					role: "user",
					content: msg.content,
				});
			} else if (msg.role === "assistant") {
				const assistantMsg: ChatCompletionMessageParam = {
					role: "assistant",
					content: msg.content || null,
				};

				if (msg.toolCalls) {
					assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
						id: tc.id,
						type: "function" as const,
						function: {
							name: tc.name,
							arguments: JSON.stringify(tc.arguments),
						},
					}));
				}

				params.push(assistantMsg);
			} else if (msg.role === "toolResult") {
				params.push({
					role: "tool",
					content: msg.content,
					tool_call_id: msg.toolCallId,
				});
			}
		}

		return params;
	}

	private convertTools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
		return tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}

	private mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"] | null): StopReason {
		switch (reason) {
			case "stop":
				return "stop";
			case "length":
				return "length";
			case "function_call":
			case "tool_calls":
				return "toolUse";
			case "content_filter":
				return "safety";
			default:
				return "stop";
		}
	}

	private isReasoningModel(): boolean {
		// TODO base on models.dev data
		return this.model.includes("o1") || this.model.includes("o3");
	}
}
