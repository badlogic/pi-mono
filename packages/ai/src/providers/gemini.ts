import { FunctionCallingMode, GoogleGenerativeAI } from "@google/generative-ai";
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

export interface GeminiLLMOptions extends LLMOptions {
	toolChoice?: "auto" | "none" | "any";
}

export class GeminiLLM implements LLM<GeminiLLMOptions> {
	private client: GoogleGenerativeAI;
	private model: string;

	constructor(model: string, apiKey?: string) {
		if (!apiKey) {
			if (!process.env.GEMINI_API_KEY) {
				throw new Error(
					"Gemini API key is required. Set GEMINI_API_KEY environment variable or pass it as an argument.",
				);
			}
			apiKey = process.env.GEMINI_API_KEY;
		}
		this.client = new GoogleGenerativeAI(apiKey);
		this.model = model;
	}

	async complete(context: Context, options?: GeminiLLMOptions): Promise<AssistantMessage> {
		try {
			const model = this.client.getGenerativeModel({
				model: this.model,
				systemInstruction: context.systemPrompt,
				tools: context.tools ? this.convertTools(context.tools) : undefined,
				toolConfig: options?.toolChoice
					? {
							functionCallingConfig: {
								mode: this.mapToolChoice(options.toolChoice),
							},
						}
					: undefined,
			});

			const contents = this.convertMessages(context.messages);

			const stream = await model.generateContentStream({
				contents,
				generationConfig: {
					temperature: options?.temperature,
					maxOutputTokens: options?.maxTokens,
				},
			});

			let content = "";
			let thinking = "";
			const toolCalls: ToolCall[] = [];
			let usage: TokenUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			};
			let stopReason: StopReason = "stop";
			let inTextBlock = false;
			let inThinkingBlock = false;

			// Process the stream
			for await (const chunk of stream.stream) {
				// Extract parts from the chunk
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text) {
							// Check if it's thinking content
							if ((part as any).thought) {
								thinking += part.text;
								options?.onThinking?.(part.text, false);
								inThinkingBlock = true;
								if (inTextBlock) {
									options?.onText?.("", true);
									inTextBlock = false;
								}
							} else {
								content += part.text;
								options?.onText?.(part.text, false);
								inTextBlock = true;
								if (inThinkingBlock) {
									options?.onThinking?.("", true);
									inThinkingBlock = false;
								}
							}
						}

						// Handle function calls
						if (part.functionCall) {
							if (inTextBlock) {
								options?.onText?.("", true);
								inTextBlock = false;
							}
							if (inThinkingBlock) {
								options?.onThinking?.("", true);
								inThinkingBlock = false;
							}

							toolCalls.push({
								id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
								name: part.functionCall.name,
								arguments: part.functionCall.args as Record<string, any>,
							});
						}
					}
				}

				// Map finish reason
				if (candidate?.finishReason) {
					stopReason = this.mapStopReason(candidate.finishReason);
				}
			}

			// Signal end of blocks
			if (inTextBlock) {
				options?.onText?.("", true);
			}
			if (inThinkingBlock) {
				options?.onThinking?.("", true);
			}

			// Get final response for usage metadata
			const response = await stream.response;
			if (response.usageMetadata) {
				usage = {
					input: response.usageMetadata.promptTokenCount || 0,
					output: response.usageMetadata.candidatesTokenCount || 0,
					cacheRead: response.usageMetadata.cachedContentTokenCount || 0,
					cacheWrite: 0,
				};
			}

			return {
				role: "assistant",
				content: content || undefined,
				thinking: thinking || undefined,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				model: this.model,
				usage,
				stopReason,
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

	private convertMessages(messages: Message[]): any[] {
		const contents: any[] = [];

		for (const msg of messages) {
			if (msg.role === "user") {
				contents.push({
					role: "user",
					parts: [{ text: msg.content }],
				});
			} else if (msg.role === "assistant") {
				const parts: any[] = [];

				if (msg.content) {
					parts.push({ text: msg.content });
				}

				if (msg.toolCalls) {
					for (const toolCall of msg.toolCalls) {
						parts.push({
							functionCall: {
								name: toolCall.name,
								args: toolCall.arguments,
							},
						});
					}
				}

				if (parts.length > 0) {
					contents.push({
						role: "model",
						parts,
					});
				}
			} else if (msg.role === "toolResult") {
				// Tool results are sent as function responses
				contents.push({
					role: "user",
					parts: [
						{
							functionResponse: {
								name: msg.toolCallId.split("_")[1], // Extract function name from our ID format
								response: {
									result: msg.content,
									isError: msg.isError || false,
								},
							},
						},
					],
				});
			}
		}

		return contents;
	}

	private convertTools(tools: Tool[]): any[] {
		return [
			{
				functionDeclarations: tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				})),
			},
		];
	}

	private mapToolChoice(choice: string): FunctionCallingMode {
		switch (choice) {
			case "auto":
				return FunctionCallingMode.AUTO;
			case "none":
				return FunctionCallingMode.NONE;
			case "any":
				return FunctionCallingMode.ANY;
			default:
				return FunctionCallingMode.AUTO;
		}
	}

	private mapStopReason(reason: string): StopReason {
		switch (reason) {
			case "STOP":
				return "stop";
			case "MAX_TOKENS":
				return "length";
			case "SAFETY":
				return "safety";
			case "RECITATION":
				return "safety";
			default:
				return "stop";
		}
	}
}
