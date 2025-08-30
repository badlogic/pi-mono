import OpenAI from "openai";
import type {
	Tool as OpenAITool,
	ResponseCreateParamsStreaming,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
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

			let content = "";
			let thinking = "";
			const toolCalls: ToolCall[] = [];
			const reasoningItems: ResponseReasoningItem[] = [];
			let usage: Usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			let stopReason: StopReason = "stop";

			for await (const event of stream) {
				// Handle reasoning summary for models that support it
				if (event.type === "response.reasoning_summary_text.delta") {
					const delta = event.delta;
					thinking += delta;
					options?.onThinking?.(delta, false);
				} else if (event.type === "response.reasoning_summary_text.done") {
					if (event.text) {
						thinking = event.text;
					}
					options?.onThinking?.("", true);
				}
				// Handle main text output
				else if (event.type === "response.output_text.delta") {
					const delta = event.delta;
					content += delta;
					options?.onText?.(delta, false);
				} else if (event.type === "response.output_text.done") {
					if (event.text) {
						content = event.text;
					}
					options?.onText?.("", true);
				}
				// Handle function calls
				else if (event.type === "response.output_item.done") {
					const item = event.item;
					if (item?.type === "function_call") {
						toolCalls.push({
							id: item.call_id + "|" + item.id,
							name: item.name,
							arguments: JSON.parse(item.arguments),
						});
					}
					if (item.type === "reasoning") {
						reasoningItems.push(item);
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
					if (toolCalls.length > 0 && stopReason === "stop") {
						stopReason = "toolUse";
					}
				}
				// Handle errors
				else if (event.type === "error") {
					return {
						role: "assistant",
						provider: this.modelInfo.provider,
						model: this.modelInfo.id,
						usage,
						stopReason: "error",
						error: `Code ${event.code}: ${event.message}` || "Unknown error",
					};
				}
			}

			return {
				role: "assistant",
				content: content || undefined,
				thinking: thinking || undefined,
				thinkingSignature: JSON.stringify(reasoningItems) || undefined,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				provider: this.modelInfo.provider,
				model: this.modelInfo.id,
				usage,
				stopReason,
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
				// Assistant messages - add both content and tool calls to output
				const output: ResponseInput = [];
				if (msg.thinkingSignature) {
					output.push(...JSON.parse(msg.thinkingSignature));
				}
				if (msg.toolCalls) {
					for (const toolCall of msg.toolCalls) {
						output.push({
							type: "function_call",
							id: toolCall.id.split("|")[1], // Extract original ID
							call_id: toolCall.id.split("|")[0], // Extract call session ID
							name: toolCall.name,
							arguments: JSON.stringify(toolCall.arguments),
						});
					}
				}
				if (msg.content) {
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "input_text", text: msg.content }],
					});
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
