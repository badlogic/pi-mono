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
	TextContent,
	ThinkingContent,
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
		this.client = new OpenAI({ apiKey, baseURL: model.baseUrl, dangerouslyAllowBrowser: true });
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

			const blocks: AssistantMessage["content"] = [];
			let currentBlock: TextContent | ThinkingContent | (ToolCall & { partialArgs?: string }) | null = null;
			let usage: Usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			let finishReason: ChatCompletionChunk.Choice["finish_reason"] | null = null;
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
						// Check if we need to switch to text block
						if (!currentBlock || currentBlock.type !== "text") {
							// Save current block if exists
							if (currentBlock) {
								if (currentBlock.type === "thinking") {
									options?.onEvent?.({ type: "thinking_end", content: currentBlock.thinking });
								} else if (currentBlock.type === "toolCall") {
									currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
									delete currentBlock.partialArgs;
									options?.onEvent?.({ type: "toolCall", toolCall: currentBlock as ToolCall });
								}
								blocks.push(currentBlock);
							}
							// Start new text block
							currentBlock = { type: "text", text: "" };
							options?.onEvent?.({ type: "text_start" });
						}
						// Append to text block
						if (currentBlock.type === "text") {
							options?.onEvent?.({
								type: "text_delta",
								content: currentBlock.text,
								delta: choice.delta.content,
							});
							currentBlock.text += choice.delta.content;
						}
					}

					// Handle reasoning_content field
					if (
						(choice.delta as any).reasoning_content !== null &&
						(choice.delta as any).reasoning_content !== undefined
					) {
						// Check if we need to switch to thinking block
						if (!currentBlock || currentBlock.type !== "thinking") {
							// Save current block if exists
							if (currentBlock) {
								if (currentBlock.type === "text") {
									options?.onEvent?.({ type: "text_end", content: currentBlock.text });
								} else if (currentBlock.type === "toolCall") {
									currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
									delete currentBlock.partialArgs;
									options?.onEvent?.({ type: "toolCall", toolCall: currentBlock as ToolCall });
								}
								blocks.push(currentBlock);
							}
							// Start new thinking block
							currentBlock = { type: "thinking", thinking: "", thinkingSignature: "reasoning_content" };
							options?.onEvent?.({ type: "thinking_start" });
						}
						// Append to thinking block
						if (currentBlock.type === "thinking") {
							const delta = (choice.delta as any).reasoning_content;
							options?.onEvent?.({ type: "thinking_delta", content: currentBlock.thinking, delta });
							currentBlock.thinking += delta;
						}
					}

					// Handle reasoning field
					if ((choice.delta as any).reasoning !== null && (choice.delta as any).reasoning !== undefined) {
						// Check if we need to switch to thinking block
						if (!currentBlock || currentBlock.type !== "thinking") {
							// Save current block if exists
							if (currentBlock) {
								if (currentBlock.type === "text") {
									options?.onEvent?.({ type: "text_end", content: currentBlock.text });
								} else if (currentBlock.type === "toolCall") {
									currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
									delete currentBlock.partialArgs;
									options?.onEvent?.({ type: "toolCall", toolCall: currentBlock as ToolCall });
								}
								blocks.push(currentBlock);
							}
							// Start new thinking block
							currentBlock = { type: "thinking", thinking: "", thinkingSignature: "reasoning" };
							options?.onEvent?.({ type: "thinking_start" });
						}
						// Append to thinking block
						if (currentBlock.type === "thinking") {
							const delta = (choice.delta as any).reasoning;
							options?.onEvent?.({ type: "thinking_delta", content: currentBlock.thinking, delta });
							currentBlock.thinking += delta;
						}
					}

					// Handle tool calls
					if (choice?.delta?.tool_calls) {
						for (const toolCall of choice.delta.tool_calls) {
							// Check if we need a new tool call block
							if (
								!currentBlock ||
								currentBlock.type !== "toolCall" ||
								(toolCall.id && currentBlock.id !== toolCall.id)
							) {
								// Save current block if exists
								if (currentBlock) {
									if (currentBlock.type === "text") {
										options?.onEvent?.({ type: "text_end", content: currentBlock.text });
									} else if (currentBlock.type === "thinking") {
										options?.onEvent?.({ type: "thinking_end", content: currentBlock.thinking });
									} else if (currentBlock.type === "toolCall") {
										currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
										delete currentBlock.partialArgs;
										options?.onEvent?.({ type: "toolCall", toolCall: currentBlock as ToolCall });
									}
									blocks.push(currentBlock);
								}

								// Start new tool call block
								currentBlock = {
									type: "toolCall",
									id: toolCall.id || "",
									name: toolCall.function?.name || "",
									arguments: {},
									partialArgs: "",
								};
							}

							// Accumulate tool call data
							if (currentBlock.type === "toolCall") {
								if (toolCall.id) currentBlock.id = toolCall.id;
								if (toolCall.function?.name) currentBlock.name = toolCall.function.name;
								if (toolCall.function?.arguments) {
									currentBlock.partialArgs += toolCall.function.arguments;
								}
							}
						}
					}
				}

				// Capture finish reason
				if (choice.finish_reason) {
					finishReason = choice.finish_reason;
				}
			}

			// Save final block if exists
			if (currentBlock) {
				if (currentBlock.type === "text") {
					options?.onEvent?.({ type: "text_end", content: currentBlock.text });
				} else if (currentBlock.type === "thinking") {
					options?.onEvent?.({ type: "thinking_end", content: currentBlock.thinking });
				} else if (currentBlock.type === "toolCall") {
					currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
					delete currentBlock.partialArgs;
					options?.onEvent?.({ type: "toolCall", toolCall: currentBlock as ToolCall });
				}
				blocks.push(currentBlock);
			}

			// Calculate cost
			calculateCost(this.modelInfo, usage);

			const output = {
				role: "assistant",
				content: blocks,
				provider: this.modelInfo.provider,
				model: this.modelInfo.id,
				usage,
				stopReason: this.mapStopReason(finishReason),
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
				error: error instanceof Error ? error.message : String(error),
			} satisfies AssistantMessage;
			options?.onEvent?.({ type: "error", error: output.error || "Unknown error" });
			return output;
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
					content: null,
				};

				// Build content from blocks
				const textBlocks = msg.content.filter((b) => b.type === "text") as TextContent[];
				if (textBlocks.length > 0) {
					assistantMsg.content = textBlocks.map((b) => b.text).join("");
				}

				// Handle thinking blocks for llama.cpp server + gpt-oss
				const thinkingBlocks = msg.content.filter((b) => b.type === "thinking") as ThinkingContent[];
				if (thinkingBlocks.length > 0) {
					// Use the signature from the first thinking block if available
					const signature = thinkingBlocks[0].thinkingSignature;
					if (signature && signature.length > 0) {
						(assistantMsg as any)[signature] = thinkingBlocks.map((b) => b.thinking).join("");
					}
				}

				// Handle tool calls
				const toolCalls = msg.content.filter((b) => b.type === "toolCall") as ToolCall[];
				if (toolCalls.length > 0) {
					assistantMsg.tool_calls = toolCalls.map((tc) => ({
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
