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
	Tool,
	ToolCall,
	Usage,
} from "../types.js";

export interface OpenAIResponsesLLMOptions extends LLMOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
}

export class OpenAIResponsesLLM implements LLM<OpenAIResponsesLLMOptions> {
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

	async complete(request: Context, options?: OpenAIResponsesLLMOptions): Promise<AssistantMessage> {
		try {
			const input = this.convertToInput(request.messages, request.systemPrompt);

			const params: ResponseCreateParamsStreaming = {
				model: this.modelInfo.id,
				input,
				stream: true,
			};

			if (options?.maxTokens) {
				params.max_output_tokens = options?.maxTokens;
			}

			if (options?.temperature !== undefined) {
				params.temperature = options?.temperature;
			}

			if (request.tools) {
				params.tools = this.convertTools(request.tools);
			}

			// Add reasoning options for models that support it
			if (this.modelInfo?.reasoning && (options?.reasoningEffort || options?.reasoningSummary)) {
				params.reasoning = {
					effort: options?.reasoningEffort || "medium",
					summary: options?.reasoningSummary || "auto",
				};
				params.include = ["reasoning.encrypted_content"];
			}

			const stream = await this.client.responses.create(params, {
				signal: options?.signal,
			});

			options?.onEvent?.({ type: "start", model: this.modelInfo.id, provider: this.modelInfo.provider });

			const outputItems: (ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall)[] = []; // any for function_call items
			let currentTextAccum = ""; // For delta accumulation
			let currentThinkingAccum = ""; // For delta accumulation
			let usage: Usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			let stopReason: StopReason = "stop";

			for await (const event of stream) {
				// Handle output item start
				if (event.type === "response.output_item.added") {
					const item = event.item;
					if (item.type === "reasoning") {
						options?.onEvent?.({ type: "thinking_start" });
						currentThinkingAccum = "";
					} else if (item.type === "message") {
						options?.onEvent?.({ type: "text_start" });
						currentTextAccum = "";
					}
				}
				// Handle reasoning summary deltas
				else if (event.type === "response.reasoning_summary_text.delta") {
					const delta = event.delta;
					currentThinkingAccum += delta;
					options?.onEvent?.({ type: "thinking_delta", content: currentThinkingAccum, delta });
				}
				// Add a new line between summary parts (hack...)
				else if (event.type === "response.reasoning_summary_part.done") {
					currentThinkingAccum += "\n\n";
					options?.onEvent?.({ type: "thinking_delta", content: currentThinkingAccum, delta: "\n\n" });
				}
				// Handle text output deltas
				else if (event.type === "response.output_text.delta") {
					const delta = event.delta;
					currentTextAccum += delta;
					options?.onEvent?.({ type: "text_delta", content: currentTextAccum, delta });
				}
				// Handle refusal output deltas
				else if (event.type === "response.refusal.delta") {
					const delta = event.delta;
					currentTextAccum += delta;
					options?.onEvent?.({ type: "text_delta", content: currentTextAccum, delta });
				}
				// Handle output item completion
				else if (event.type === "response.output_item.done") {
					const item = event.item;

					if (item.type === "reasoning") {
						const thinkingContent = item.summary?.map((s: any) => s.text).join("\n\n") || "";
						options?.onEvent?.({ type: "thinking_end", content: thinkingContent });
						outputItems.push(item);
					} else if (item.type === "message") {
						const textContent = item.content.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("");
						options?.onEvent?.({ type: "text_end", content: textContent });
						outputItems.push(item);
					} else if (item.type === "function_call") {
						const toolCall: ToolCall = {
							type: "toolCall",
							id: item.call_id + "|" + item.id,
							name: item.name,
							arguments: JSON.parse(item.arguments),
						};
						options?.onEvent?.({ type: "toolCall", toolCall });
						outputItems.push(item);
					}
				}
				// Handle completion
				else if (event.type === "response.completed") {
					const response = event.response;
					if (response?.usage) {
						usage = {
							input: response.usage.input_tokens || 0,
							output: response.usage.output_tokens || 0,
							cacheRead: response.usage.input_tokens_details?.cached_tokens || 0,
							cacheWrite: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
					}

					// Map status to stop reason
					stopReason = this.mapStopReason(response?.status);
				}
				// Handle errors
				else if (event.type === "error") {
					const errorOutput = {
						role: "assistant",
						content: [],
						provider: this.modelInfo.provider,
						model: this.modelInfo.id,
						usage,
						stopReason: "error",
						error: `Code ${event.code}: ${event.message}` || "Unknown error",
					} satisfies AssistantMessage;
					options?.onEvent?.({ type: "error", error: errorOutput.error || "Unknown error" });
					return errorOutput;
				} else if (event.type === "response.failed") {
					const errorOutput = {
						role: "assistant",
						content: [],
						provider: this.modelInfo.provider,
						model: this.modelInfo.id,
						usage,
						stopReason: "error",
						error: "Unknown error",
					} satisfies AssistantMessage;
					options?.onEvent?.({ type: "error", error: errorOutput.error || "Unknown error" });
					return errorOutput;
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			// Convert output items to blocks
			const blocks: AssistantMessage["content"] = [];

			for (const item of outputItems) {
				if (item.type === "reasoning") {
					blocks.push({
						type: "thinking",
						thinking: item.summary?.map((s: any) => s.text).join("\n\n") || "",
						thinkingSignature: JSON.stringify(item), // Full item for resubmission
					});
				} else if (item.type === "message") {
					blocks.push({
						type: "text",
						text: item.content.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join(""),
						textSignature: item.id, // ID for resubmission
					});
				} else if (item.type === "function_call") {
					blocks.push({
						type: "toolCall",
						id: item.call_id + "|" + item.id,
						name: item.name,
						arguments: JSON.parse(item.arguments),
					});
				}
			}

			// Check if we have tool calls for stop reason
			if (blocks.some((b) => b.type === "toolCall") && stopReason === "stop") {
				stopReason = "toolUse";
			}

			calculateCost(this.modelInfo, usage);

			const output = {
				role: "assistant",
				content: blocks,
				provider: this.modelInfo.provider,
				model: this.modelInfo.id,
				usage,
				stopReason,
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

	private convertToInput(messages: Message[], systemPrompt?: string): ResponseInput {
		const input: ResponseInput = [];

		// Add system prompt if provided
		if (systemPrompt) {
			const role = this.modelInfo?.reasoning ? "developer" : "system";
			input.push({
				role,
				content: systemPrompt,
			});
		}

		// Convert messages
		for (const msg of messages) {
			if (msg.role === "user") {
				// Handle both string and array content
				if (typeof msg.content === "string") {
					input.push({
						role: "user",
						content: [{ type: "input_text", text: msg.content }],
					});
				} else {
					// Convert array content to OpenAI Responses format
					const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
						if (item.type === "text") {
							return {
								type: "input_text",
								text: item.text,
							} satisfies ResponseInputText;
						} else {
							// Image content - OpenAI Responses uses data URLs
							return {
								type: "input_image",
								detail: "auto",
								image_url: `data:${item.mimeType};base64,${item.data}`,
							} satisfies ResponseInputImage;
						}
					});
					input.push({
						role: "user",
						content,
					});
				}
			} else if (msg.role === "assistant") {
				// Process content blocks in order
				const output: ResponseInput = [];

				for (const block of msg.content) {
					if (block.type === "thinking") {
						// Push the full reasoning item(s) from signature
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
					} else if (block.type === "toolCall") {
						const toolCall = block as ToolCall;
						output.push({
							type: "function_call",
							id: toolCall.id.split("|")[1], // Extract original ID
							call_id: toolCall.id.split("|")[0], // Extract call session ID
							name: toolCall.name,
							arguments: JSON.stringify(toolCall.arguments),
						});
					}
				}

				// Add all output items to input
				input.push(...output);
			} else if (msg.role === "toolResult") {
				// Tool results are sent as function_call_output
				input.push({
					type: "function_call_output",
					call_id: msg.toolCallId.split("|")[0], // Extract call session ID
					output: msg.content,
				});
			}
		}

		return input;
	}

	private convertTools(tools: Tool[]): OpenAITool[] {
		return tools.map((tool) => ({
			type: "function",
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			strict: null,
		}));
	}

	private mapStopReason(status: string | undefined): StopReason {
		switch (status) {
			case "completed":
				return "stop";
			case "incomplete":
				return "length";
			case "failed":
			case "cancelled":
				return "error";
			default:
				return "stop";
		}
	}
}
