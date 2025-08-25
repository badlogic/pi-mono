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
	thinking?: {
		enabled: boolean;
		budgetTokens?: number; // -1 for dynamic, 0 to disable
	};
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

			const config: any = {
				contents,
				generationConfig: {
					temperature: options?.temperature,
					maxOutputTokens: options?.maxTokens,
				},
			};

			// Add thinking configuration if enabled
			if (options?.thinking?.enabled && this.supportsThinking()) {
				config.config = {
					thinkingConfig: {
						includeThoughts: true,
						thinkingBudget: options.thinking.budgetTokens ?? -1, // Default to dynamic
					},
				};
			}

			const stream = await model.generateContentStream(config);

			let content = "";
			let thinking = "";
			let thoughtSignature: string | undefined;
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
						// Cast to any to access thinking properties not yet in SDK types
						const partWithThinking = part as any;
						if (partWithThinking.text !== undefined) {
							// Check if it's thinking content using the thought boolean flag
							if (partWithThinking.thought === true) {
								if (inTextBlock) {
									options?.onText?.("", true);
									inTextBlock = false;
								}
								thinking += partWithThinking.text;
								options?.onThinking?.(partWithThinking.text, false);
								inThinkingBlock = true;
								// Capture thought signature if present
								if (partWithThinking.thoughtSignature) {
									thoughtSignature = partWithThinking.thoughtSignature;
								}
							} else {
								if (inThinkingBlock) {
									options?.onThinking?.("", true);
									inThinkingBlock = false;
								}
								content += partWithThinking.text;
								options?.onText?.(partWithThinking.text, false);
								inTextBlock = true;
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
				thinkingSignature: thoughtSignature,
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

				// Add thinking if present (with thought signature for function calling)
				if (msg.thinking && msg.thinkingSignature) {
					parts.push({
						text: msg.thinking,
						thought: true,
						thoughtSignature: msg.thinkingSignature,
					});
				}

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

	private supportsThinking(): boolean {
		// Gemini 2.5 series models support thinking
		return this.model.includes("2.5") || this.model.includes("gemini-2");
	}
}
