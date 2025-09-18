import OpenAI from "openai";
import type {
	ChatCompletionAssistantMessageParam,
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
	Model,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { validateToolArguments } from "../utils/validation.js";
import { transformMessages } from "./transorm-messages.js";

export interface OpenAICompletionsOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export const streamOpenAICompletions: StreamFunction<"openai-completions"> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

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
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			const finishCurrentBlock = (block?: typeof currentBlock) => {
				if (block) {
					if (block.type === "text") {
						stream.push({
							type: "text_end",
							contentIndex: blockIndex(),
							content: block.text,
							partial: output,
						});
					} else if (block.type === "thinking") {
						stream.push({
							type: "thinking_end",
							contentIndex: blockIndex(),
							content: block.thinking,
							partial: output,
						});
					} else if (block.type === "toolCall") {
						block.arguments = JSON.parse(block.partialArgs || "{}");

						// Validate tool arguments if tool definition is available
						if (context.tools) {
							const tool = context.tools.find((t) => t.name === block.name);
							if (tool) {
								block.arguments = validateToolArguments(tool, block);
							}
						}

						delete block.partialArgs;
						stream.push({
							type: "toolcall_end",
							contentIndex: blockIndex(),
							toolCall: block,
							partial: output,
						});
					}
				}
			};

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
							finishCurrentBlock(currentBlock);
							currentBlock = { type: "text", text: "" };
							output.content.push(currentBlock);
							stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
						}

						if (currentBlock.type === "text") {
							currentBlock.text += choice.delta.content;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: choice.delta.content,
								partial: output,
							});
						}
					}

					// Some endpoints return reasoning in reasoning_content (llama.cpp),
					// or reasoning (other openai compatible endpoints)
					const reasoningFields = ["reasoning_content", "reasoning"];
					for (const field of reasoningFields) {
						if (
							(choice.delta as any)[field] !== null &&
							(choice.delta as any)[field] !== undefined &&
							(choice.delta as any)[field].length > 0
						) {
							if (!currentBlock || currentBlock.type !== "thinking") {
								finishCurrentBlock(currentBlock);
								currentBlock = {
									type: "thinking",
									thinking: "",
									thinkingSignature: field,
								};
								output.content.push(currentBlock);
								stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
							}

							if (currentBlock.type === "thinking") {
								const delta = (choice.delta as any)[field];
								currentBlock.thinking += delta;
								stream.push({
									type: "thinking_delta",
									contentIndex: blockIndex(),
									delta,
									partial: output,
								});
							}
						}
					}

					if (choice?.delta?.tool_calls) {
						for (const toolCall of choice.delta.tool_calls) {
							if (
								!currentBlock ||
								currentBlock.type !== "toolCall" ||
								(toolCall.id && currentBlock.id !== toolCall.id)
							) {
								finishCurrentBlock(currentBlock);
								currentBlock = {
									type: "toolCall",
									id: toolCall.id || "",
									name: toolCall.function?.name || "",
									arguments: {},
									partialArgs: "",
								};
								output.content.push(currentBlock);
								stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							}

							if (currentBlock.type === "toolCall") {
								if (toolCall.id) currentBlock.id = toolCall.id;
								if (toolCall.function?.name) currentBlock.name = toolCall.function.name;
								let delta = "";
								if (toolCall.function?.arguments) {
									delta = toolCall.function.arguments;
									currentBlock.partialArgs += toolCall.function.arguments;
									currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs);
								}
								stream.push({
									type: "toolcall_delta",
									contentIndex: blockIndex(),
									delta,
									partial: output,
								});
							}
						}
					}
				}
			}

			finishCurrentBlock(currentBlock);

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unkown error ocurred");
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
				assistantMsg.content = textBlocks.map((b) => {
					return { type: "text", text: b.text };
				});
			}

			// Handle thinking blocks for llama.cpp server + gpt-oss
			const thinkingBlocks = msg.content.filter((b) => b.type === "thinking") as ThinkingContent[];
			if (thinkingBlocks.length > 0) {
				// Use the signature from the first thinking block if available
				const signature = thinkingBlocks[0].thinkingSignature;
				if (signature && signature.length > 0) {
					(assistantMsg as any)[signature] = thinkingBlocks.map((b) => b.thinking).join("\n");
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
			if (assistantMsg.content === null && !assistantMsg.tool_calls) {
				continue;
			}
			params.push(assistantMsg);
		} else if (msg.role === "toolResult") {
			params.push({
				role: "tool",
				content: msg.output,
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
			parameters: tool.parameters as any, // TypeBox already generates JSON Schema
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
			return "error";
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
