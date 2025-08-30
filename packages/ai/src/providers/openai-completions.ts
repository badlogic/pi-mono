import OpenAI from "openai";
import type {
	ChatCompletionChunk,
	ChatCompletionContentPart,
	ChatCompletionContentPartImage,
	ChatCompletionContentPartText,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions.js";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	LLM,
	LLMOptions,
	Message,
	Model,
	StopReason,
	Tool,
	ToolCall,
	Usage,
} from "../types.js";

export interface OpenAICompletionsLLMOptions extends LLMOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "low" | "medium" | "high";
}

export class OpenAICompletionsLLM implements LLM<OpenAICompletionsLLMOptions> {
	private client: OpenAI;
	private modelInfo: Model;

	constructor(model: Model, apiKey?: string) {
		if (!apiKey) {
			if (!process.env.OPENAI_API_KEY) {
				throw new Error(
					"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
				);
			}
			apiKey = process.env.OPENAI_API_KEY;
		}
		this.client = new OpenAI({ apiKey, baseURL: model.baseUrl });
		this.modelInfo = model;
	}

	getModel(): Model {
		return this.modelInfo;
	}

	async complete(request: Context, options?: OpenAICompletionsLLMOptions): Promise<AssistantMessage> {
		try {
			const messages = this.convertMessages(request.messages, request.systemPrompt);

			const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: this.modelInfo.id,
				messages,
				stream: true,
				stream_options: { include_usage: true },
			};

			// Cerebras/xAI dont like the "store" field
			if (!this.modelInfo.baseUrl?.includes("cerebras.ai") && !this.modelInfo.baseUrl?.includes("api.x.ai")) {
				params.store = false;
			}

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

			if (
				options?.reasoningEffort &&
				this.modelInfo.reasoning &&
				!this.modelInfo.id.toLowerCase().includes("grok")
			) {
				params.reasoning_effort = options.reasoningEffort;
			}

			const stream = await this.client.chat.completions.create(params, {
				signal: options?.signal,
			});

			let content = "";
			let reasoningContent = "";
			let reasoningField: "reasoning" | "reasoning_content" | null = null;
			const parsedToolCalls: { id: string; name: string; arguments: string }[] = [];
			let usage: Usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			let finishReason: ChatCompletionChunk.Choice["finish_reason"] | null = null;
			let blockType: "text" | "thinking" | null = null;
			for await (const chunk of stream) {
				if (chunk.usage) {
					usage = {
						input: chunk.usage.prompt_tokens || 0,
						output:
							(chunk.usage.completion_tokens || 0) +
							(chunk.usage.completion_tokens_details?.reasoning_tokens || 0),
						cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						cacheWrite: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					};
				}

				const choice = chunk.choices[0];
				if (!choice) continue;

				if (choice.delta) {
					// Handle text content
					if (
						choice.delta.content !== null &&
						choice.delta.content !== undefined &&
						choice.delta.content.length > 0
					) {
						if (blockType === "thinking") {
							options?.onThinking?.("", true);
							blockType = null;
						}
						content += choice.delta.content;
						options?.onText?.(choice.delta.content, false);
						blockType = "text";
					}

					// Handle reasoning_content field
					if (
						(choice.delta as any).reasoning_content !== null &&
						(choice.delta as any).reasoning_content !== undefined
					) {
						if (blockType === "text") {
							options?.onText?.("", true);
							blockType = null;
						}
						reasoningContent += (choice.delta as any).reasoning_content;
						reasoningField = "reasoning_content";
						options?.onThinking?.((choice.delta as any).reasoning_content, false);
						blockType = "thinking";
					}

					// Handle reasoning field
					if ((choice.delta as any).reasoning !== null && (choice.delta as any).reasoning !== undefined) {
						if (blockType === "text") {
							options?.onText?.("", true);
							blockType = null;
						}
						reasoningContent += (choice.delta as any).reasoning;
						reasoningField = "reasoning";
						options?.onThinking?.((choice.delta as any).reasoning, false);
						blockType = "thinking";
					}

					// Handle tool calls
					if (choice?.delta?.tool_calls) {
						if (blockType === "text") {
							options?.onText?.("", true);
							blockType = null;
						}
						if (blockType === "thinking") {
							options?.onThinking?.("", true);
							blockType = null;
						}
						for (const toolCall of choice.delta.tool_calls) {
							if (
								parsedToolCalls.length === 0 ||
								(toolCall.id !== undefined && parsedToolCalls[parsedToolCalls.length - 1].id !== toolCall.id)
							) {
								parsedToolCalls.push({
									id: toolCall.id || "",
									name: toolCall.function?.name || "",
									arguments: "",
								});
							}

							const current = parsedToolCalls[parsedToolCalls.length - 1];
							if (toolCall.id) current.id = toolCall.id;
							if (toolCall.function?.name) current.name = toolCall.function.name;
							if (toolCall.function?.arguments) {
								current.arguments += toolCall.function.arguments;
							}
						}
					}
				}

				// Capture finish reason
				if (choice.finish_reason) {
					if (blockType === "text") {
						options?.onText?.("", true);
						blockType = null;
					}
					if (blockType === "thinking") {
						options?.onThinking?.("", true);
						blockType = null;
					}
					finishReason = choice.finish_reason;
				}
			}

			// Convert tool calls map to array
			const toolCalls: ToolCall[] = parsedToolCalls.map((tc) => ({
				id: tc.id,
				name: tc.name,
				arguments: JSON.parse(tc.arguments),
			}));

			// Calculate cost
			calculateCost(this.modelInfo, usage);

			return {
				role: "assistant",
				content: content || undefined,
				thinking: reasoningContent || undefined,
				thinkingSignature: reasoningField || undefined,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				provider: this.modelInfo.provider,
				model: this.modelInfo.id,
				usage,
				stopReason: this.mapStopReason(finishReason),
			};
		} catch (error) {
			return {
				role: "assistant",
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
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private convertMessages(messages: Message[], systemPrompt?: string): ChatCompletionMessageParam[] {
		const params: ChatCompletionMessageParam[] = [];

		// Add system prompt if provided
		if (systemPrompt) {
			// Cerebras/xAi don't like the "developer" role
			const useDeveloperRole =
				this.modelInfo.reasoning &&
				!this.modelInfo.baseUrl?.includes("cerebras.ai") &&
				!this.modelInfo.baseUrl?.includes("api.x.ai");
			const role = useDeveloperRole ? "developer" : "system";
			params.push({ role: role, content: systemPrompt });
		}

		// Convert messages
		for (const msg of messages) {
			if (msg.role === "user") {
				// Handle both string and array content
				if (typeof msg.content === "string") {
					params.push({
						role: "user",
						content: msg.content,
					});
				} else {
					// Convert array content to OpenAI format
					const content: ChatCompletionContentPart[] = msg.content.map((item): ChatCompletionContentPart => {
						if (item.type === "text") {
							return {
								type: "text",
								text: item.text,
							} satisfies ChatCompletionContentPartText;
						} else {
							// Image content - OpenAI uses data URLs
							return {
								type: "image_url",
								image_url: {
									url: `data:${item.mimeType};base64,${item.data}`,
								},
							} satisfies ChatCompletionContentPartImage;
						}
					});
					params.push({
						role: "user",
						content,
					});
				}
			} else if (msg.role === "assistant") {
				const assistantMsg: ChatCompletionMessageParam = {
					role: "assistant",
					content: msg.content || null,
				};

				// LLama.cpp server + gpt-oss
				if (msg.thinking && msg.thinkingSignature && msg.thinkingSignature.length > 0) {
					(assistantMsg as any)[msg.thinkingSignature] = msg.thinking;
				}

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
}
