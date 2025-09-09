import OpenAI from "openai";
import type {
	Tool as OpenAITool,
	ResponseCreateParamsStreaming,
	ResponseFunctionToolCall,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputMessage,
	ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AssistantMessageEventStream } from "../event-stream.js";
import { calculateCost } from "../models.js";
import type {
	Api,
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
import { validateToolArguments } from "../validation.js";
import { transformMessages } from "./transorm-messages.js";

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
}

/**
 * Generate function for OpenAI Responses API
 */
export const streamOpenAIResponses: StreamFunction<"openai-responses"> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	// Start async processing
	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-responses" as Api,
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
			// Create OpenAI client
			const client = createClient(model, options?.apiKey);
			const params = buildParams(model, context, options);
			const openaiStream = await client.responses.create(params, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
			let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;

			for await (const event of openaiStream) {
				// Handle output item start
				if (event.type === "response.output_item.added") {
					const item = event.item;
					if (item.type === "reasoning") {
						currentItem = item;
						currentBlock = { type: "thinking", thinking: "" };
						output.content.push(currentBlock);
						stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
					} else if (item.type === "message") {
						currentItem = item;
						currentBlock = { type: "text", text: "" };
						output.content.push(currentBlock);
						stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
					} else if (item.type === "function_call") {
						currentItem = item;
						currentBlock = {
							type: "toolCall",
							id: item.call_id + "|" + item.id,
							name: item.name,
							arguments: {},
							partialJson: item.arguments || "",
						};
						output.content.push(currentBlock);
						stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
					}
				}
				// Handle reasoning summary deltas
				else if (event.type === "response.reasoning_summary_part.added") {
					if (currentItem && currentItem.type === "reasoning") {
						currentItem.summary = currentItem.summary || [];
						currentItem.summary.push(event.part);
					}
				} else if (event.type === "response.reasoning_summary_text.delta") {
					if (
						currentItem &&
						currentItem.type === "reasoning" &&
						currentBlock &&
						currentBlock.type === "thinking"
					) {
						currentItem.summary = currentItem.summary || [];
						const lastPart = currentItem.summary[currentItem.summary.length - 1];
						if (lastPart) {
							currentBlock.thinking += event.delta;
							lastPart.text += event.delta;
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				}
				// Add a new line between summary parts (hack...)
				else if (event.type === "response.reasoning_summary_part.done") {
					if (
						currentItem &&
						currentItem.type === "reasoning" &&
						currentBlock &&
						currentBlock.type === "thinking"
					) {
						currentItem.summary = currentItem.summary || [];
						const lastPart = currentItem.summary[currentItem.summary.length - 1];
						if (lastPart) {
							currentBlock.thinking += "\n\n";
							lastPart.text += "\n\n";
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: "\n\n",
								partial: output,
							});
						}
					}
				}
				// Handle text output deltas
				else if (event.type === "response.content_part.added") {
					if (currentItem && currentItem.type === "message") {
						currentItem.content = currentItem.content || [];
						currentItem.content.push(event.part);
					}
				} else if (event.type === "response.output_text.delta") {
					if (currentItem && currentItem.type === "message" && currentBlock && currentBlock.type === "text") {
						const lastPart = currentItem.content[currentItem.content.length - 1];
						if (lastPart && lastPart.type === "output_text") {
							currentBlock.text += event.delta;
							lastPart.text += event.delta;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				} else if (event.type === "response.refusal.delta") {
					if (currentItem && currentItem.type === "message" && currentBlock && currentBlock.type === "text") {
						const lastPart = currentItem.content[currentItem.content.length - 1];
						if (lastPart && lastPart.type === "refusal") {
							currentBlock.text += event.delta;
							lastPart.refusal += event.delta;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				}
				// Handle function call argument deltas
				else if (event.type === "response.function_call_arguments.delta") {
					if (
						currentItem &&
						currentItem.type === "function_call" &&
						currentBlock &&
						currentBlock.type === "toolCall"
					) {
						currentBlock.partialJson += event.delta;
						try {
							const args = JSON.parse(currentBlock.partialJson);
							currentBlock.arguments = args;
						} catch {
							// Ignore JSON parse errors - the JSON might be incomplete
						}
						stream.push({
							type: "toolcall_delta",
							contentIndex: blockIndex(),
							delta: event.delta,
							partial: output,
						});
					}
				}
				// Handle output item completion
				else if (event.type === "response.output_item.done") {
					const item = event.item;

					if (item.type === "reasoning" && currentBlock && currentBlock.type === "thinking") {
						currentBlock.thinking = item.summary?.map((s) => s.text).join("\n\n") || "";
						currentBlock.thinkingSignature = JSON.stringify(item);
						stream.push({
							type: "thinking_end",
							contentIndex: blockIndex(),
							content: currentBlock.thinking,
							partial: output,
						});
						currentBlock = null;
					} else if (item.type === "message" && currentBlock && currentBlock.type === "text") {
						currentBlock.text = item.content.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("");
						currentBlock.textSignature = item.id;
						stream.push({
							type: "text_end",
							contentIndex: blockIndex(),
							content: currentBlock.text,
							partial: output,
						});
						currentBlock = null;
					} else if (item.type === "function_call") {
						const toolCall: ToolCall = {
							type: "toolCall",
							id: item.call_id + "|" + item.id,
							name: item.name,
							arguments: JSON.parse(item.arguments),
						};

						// Validate tool arguments if tool definition is available
						if (context.tools) {
							const tool = context.tools.find((t) => t.name === toolCall.name);
							if (tool) {
								toolCall.arguments = validateToolArguments(tool, toolCall);
							}
						}

						stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
					}
				}
				// Handle completion
				else if (event.type === "response.completed") {
					const response = event.response;
					if (response?.usage) {
						output.usage = {
							input: response.usage.input_tokens || 0,
							output: response.usage.output_tokens || 0,
							cacheRead: response.usage.input_tokens_details?.cached_tokens || 0,
							cacheWrite: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
					}
					calculateCost(model, output.usage);
					// Map status to stop reason
					output.stopReason = mapStopReason(response?.status);
					if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
						output.stopReason = "toolUse";
					}
				}
				// Handle errors
				else if (event.type === "error") {
					output.stopReason = "error";
					output.error = `Code ${event.code}: ${event.message}` || "Unknown error";
					stream.push({ type: "error", error: output.error, partial: output });
					stream.end();
					return output;
				} else if (event.type === "response.failed") {
					output.stopReason = "error";
					output.error = "Unknown error";
					stream.push({ type: "error", error: output.error, partial: output });
					stream.end();
					return output;
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

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

function createClient(model: Model<"openai-responses">, apiKey?: string) {
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

function buildParams(model: Model<"openai-responses">, context: Context, options?: OpenAIResponsesOptions) {
	const messages = convertMessages(model, context);

	const params: ResponseCreateParamsStreaming = {
		model: model.id,
		input: messages,
		stream: true,
	};

	if (options?.maxTokens) {
		params.max_output_tokens = options?.maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options?.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	}

	if (model.reasoning) {
		if (options?.reasoningEffort || options?.reasoningSummary) {
			params.reasoning = {
				effort: options?.reasoningEffort || "medium",
				summary: options?.reasoningSummary || "auto",
			};
			params.include = ["reasoning.encrypted_content"];
		} else {
			params.reasoning = {
				effort: model.name.startsWith("gpt-5") ? "minimal" : null,
				summary: null,
			};

			if (model.name.startsWith("gpt-5")) {
				// Jesus Christ, see https://community.openai.com/t/need-reasoning-false-option-for-gpt-5/1351588/7
				messages.push({
					role: "developer",
					content: [
						{
							type: "input_text",
							text: "# Juice: 0 !important",
						},
					],
				});
			}
		}
	}

	return params;
}

function convertMessages(model: Model<"openai-responses">, context: Context): ResponseInput {
	const messages: ResponseInput = [];

	const transformedMessages = transformMessages(context.messages, model);

	if (context.systemPrompt) {
		const role = model.reasoning ? "developer" : "system";
		messages.push({
			role,
			content: context.systemPrompt,
		});
	}

	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({
					role: "user",
					content: [{ type: "input_text", text: msg.content }],
				});
			} else {
				const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
					if (item.type === "text") {
						return {
							type: "input_text",
							text: item.text,
						} satisfies ResponseInputText;
					} else {
						return {
							type: "input_image",
							detail: "auto",
							image_url: `data:${item.mimeType};base64,${item.data}`,
						} satisfies ResponseInputImage;
					}
				});
				const filteredContent = !model.input.includes("image")
					? content.filter((c) => c.type !== "input_image")
					: content;
				if (filteredContent.length === 0) continue;
				messages.push({
					role: "user",
					content: filteredContent,
				});
			}
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];

			for (const block of msg.content) {
				// Do not submit thinking blocks if the completion had an error (i.e. abort)
				if (block.type === "thinking" && msg.stopReason !== "error") {
					if (block.thinkingSignature) {
						const reasoningItem = JSON.parse(block.thinkingSignature);
						output.push(reasoningItem);
					}
				} else if (block.type === "text") {
					const textBlock = block as TextContent;
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: textBlock.text, annotations: [] }],
						status: "completed",
						id: textBlock.textSignature || "msg_" + Math.random().toString(36).substring(2, 15),
					} satisfies ResponseOutputMessage);
					// Do not submit toolcall blocks if the completion had an error (i.e. abort)
				} else if (block.type === "toolCall" && msg.stopReason !== "error") {
					const toolCall = block as ToolCall;
					output.push({
						type: "function_call",
						id: toolCall.id.split("|")[1],
						call_id: toolCall.id.split("|")[0],
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.arguments),
					});
				}
			}
			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			messages.push({
				type: "function_call_output",
				call_id: msg.toolCallId.split("|")[0],
				output: msg.output,
			});
		}
	}

	return messages;
}

function convertTools(tools: Tool[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: zodToJsonSchema(tool.parameters, { $refStrategy: "none" }),
		strict: null,
	}));
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		// These two are wonky ...
		case "in_progress":
		case "queued":
			return "stop";
		default: {
			const _exhaustive: never = status;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
