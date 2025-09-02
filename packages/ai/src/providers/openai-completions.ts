import OpenAI from "openai";
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionChunk,
	ChatCompletionContentPart,
	ChatCompletionContentPartImage,
	ChatCompletionContentPartText,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions.js";
import { QueuedGenerateStream } from "../generate.js";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	GenerateFunction,
	GenerateOptions,
	GenerateStream,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
} from "../types.js";
import { transformMessages } from "./utils.js";

export interface OpenAICompletionsOptions extends GenerateOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export const streamOpenAICompletions: GenerateFunction<"openai-completions"> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): GenerateStream => {
	const stream = new QueuedGenerateStream();

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
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
		};

		try {
			const client = createClient(model, options?.apiKey);
			const params = buildParams(model, context, options);
			const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			let currentBlock: TextContent | ThinkingContent | (ToolCall & { partialArgs?: string }) | null = null;
			for await (const chunk of openaiStream) {
				if (chunk.usage) {
					output.usage = {
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
							if (currentBlock) {
								if (currentBlock.type === "thinking") {
									stream.push({
										type: "thinking_end",
										content: currentBlock.thinking,
										partial: output,
									});
								} else if (currentBlock.type === "toolCall") {
									currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
									delete currentBlock.partialArgs;
									stream.push({
										type: "toolCall",
										toolCall: currentBlock as ToolCall,
										partial: output,
									});
								}
							}
							currentBlock = { type: "text", text: "" };
							output.content.push(currentBlock);
							stream.push({ type: "text_start", partial: output });
						}

						if (currentBlock.type === "text") {
							currentBlock.text += choice.delta.content;
							stream.push({
								type: "text_delta",
								delta: choice.delta.content,
								partial: output,
							});
						}
					}

					// Some endpoints return reasoning in reasoning_content (llama.cpp)
					if (
						(choice.delta as any).reasoning_content !== null &&
						(choice.delta as any).reasoning_content !== undefined &&
						(choice.delta as any).reasoning_content.length > 0
					) {
						if (!currentBlock || currentBlock.type !== "thinking") {
							if (currentBlock) {
								if (currentBlock.type === "text") {
									stream.push({
										type: "text_end",
										content: currentBlock.text,
										partial: output,
									});
								} else if (currentBlock.type === "toolCall") {
									currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
									delete currentBlock.partialArgs;
									stream.push({
										type: "toolCall",
										toolCall: currentBlock as ToolCall,
										partial: output,
									});
								}
							}
							currentBlock = {
								type: "thinking",
								thinking: "",
								thinkingSignature: "reasoning_content",
							};
							output.content.push(currentBlock);
							stream.push({ type: "thinking_start", partial: output });
						}

						if (currentBlock.type === "thinking") {
							const delta = (choice.delta as any).reasoning_content;
							currentBlock.thinking += delta;
							stream.push({
								type: "thinking_delta",
								delta,
								partial: output,
							});
						}
					}

					// Some endpoints return reasoning in reasining (ollama, xAI, ...)
					if (
						(choice.delta as any).reasoning !== null &&
						(choice.delta as any).reasoning !== undefined &&
						(choice.delta as any).reasoning.length > 0
					) {
						if (!currentBlock || currentBlock.type !== "thinking") {
							if (currentBlock) {
								if (currentBlock.type === "text") {
									stream.push({
										type: "text_end",
										content: currentBlock.text,
										partial: output,
									});
								} else if (currentBlock.type === "toolCall") {
									currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
									delete currentBlock.partialArgs;
									stream.push({
										type: "toolCall",
										toolCall: currentBlock as ToolCall,
										partial: output,
									});
								}
							}
							currentBlock = {
								type: "thinking",
								thinking: "",
								thinkingSignature: "reasoning",
							};
							output.content.push(currentBlock);
							stream.push({ type: "thinking_start", partial: output });
						}

						if (currentBlock.type === "thinking") {
							const delta = (choice.delta as any).reasoning;
							currentBlock.thinking += delta;
							stream.push({ type: "thinking_delta", delta, partial: output });
						}
					}

					if (choice?.delta?.tool_calls) {
						for (const toolCall of choice.delta.tool_calls) {
							if (
								!currentBlock ||
								currentBlock.type !== "toolCall" ||
								(toolCall.id && currentBlock.id !== toolCall.id)
							) {
								if (currentBlock) {
									if (currentBlock.type === "text") {
										stream.push({
											type: "text_end",
											content: currentBlock.text,
											partial: output,
										});
									} else if (currentBlock.type === "thinking") {
										stream.push({
											type: "thinking_end",
											content: currentBlock.thinking,
											partial: output,
										});
									} else if (currentBlock.type === "toolCall") {
										currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
										delete currentBlock.partialArgs;
										stream.push({
											type: "toolCall",
											toolCall: currentBlock as ToolCall,
											partial: output,
										});
									}
								}

								currentBlock = {
									type: "toolCall",
									id: toolCall.id || "",
									name: toolCall.function?.name || "",
									arguments: {},
									partialArgs: "",
								};
								output.content.push(currentBlock);
							}

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
			}

			if (currentBlock) {
				if (currentBlock.type === "text") {
					stream.push({
						type: "text_end",
						content: currentBlock.text,
						partial: output,
					});
				} else if (currentBlock.type === "thinking") {
					stream.push({
						type: "thinking_end",
						content: currentBlock.thinking,
						partial: output,
					});
				} else if (currentBlock.type === "toolCall") {
					currentBlock.arguments = JSON.parse(currentBlock.partialArgs || "{}");
					delete currentBlock.partialArgs;
					stream.push({
						type: "toolCall",
						toolCall: currentBlock as ToolCall,
						partial: output,
					});
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
			return output;
		} catch (error) {
			output.stopReason = "error";
			output.error = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", error: output.error, partial: output });
			stream.end();
		}
	})();

	return stream;
};

function createClient(model: Model<"openai-completions">, apiKey?: string) {
	if (!apiKey) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = process.env.OPENAI_API_KEY;
	}
	return new OpenAI({ apiKey, baseURL: model.baseUrl, dangerouslyAllowBrowser: true });
}

function buildParams(model: Model<"openai-completions">, context: Context, options?: OpenAICompletionsOptions) {
	const messages = convertMessages(model, context);

	const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: model.id,
		messages,
		stream: true,
		stream_options: { include_usage: true },
	};

	// Cerebras/xAI dont like the "store" field
	if (!model.baseUrl.includes("cerebras.ai") && !model.baseUrl.includes("api.x.ai")) {
		params.store = false;
	}

	if (options?.maxTokens) {
		params.max_completion_tokens = options?.maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options?.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	}

	if (options?.toolChoice) {
		params.tool_choice = options.toolChoice;
	}

	// Grok models don't like reasoning_effort
	if (options?.reasoningEffort && model.reasoning && !model.id.toLowerCase().includes("grok")) {
		params.reasoning_effort = options.reasoningEffort;
	}

	return params;
}

function convertMessages(model: Model<"openai-completions">, context: Context): ChatCompletionMessageParam[] {
	const params: ChatCompletionMessageParam[] = [];

	const transformedMessages = transformMessages(context.messages, model);

	if (context.systemPrompt) {
		// Cerebras/xAi don't like the "developer" role
		const useDeveloperRole =
			model.reasoning && !model.baseUrl.includes("cerebras.ai") && !model.baseUrl.includes("api.x.ai");
		const role = useDeveloperRole ? "developer" : "system";
		params.push({ role: role, content: context.systemPrompt });
	}

	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				params.push({
					role: "user",
					content: msg.content,
				});
			} else {
				const content: ChatCompletionContentPart[] = msg.content.map((item): ChatCompletionContentPart => {
					if (item.type === "text") {
						return {
							type: "text",
							text: item.text,
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
			const assistantMsg: ChatCompletionAssistantMessageParam = {
				role: "assistant",
				content: null,
			};

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

function convertTools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
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
			return "safety";
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
