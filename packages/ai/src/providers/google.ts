import {
	type FinishReason,
	FunctionCallingConfigMode,
	type GenerateContentConfig,
	type GenerateContentParameters,
	GoogleGenAI,
} from "@google/genai";
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

export interface GoogleLLMOptions extends LLMOptions {
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number; // -1 for dynamic, 0 to disable
	};
}

export class GoogleLLM implements LLM<GoogleLLMOptions> {
	private client: GoogleGenAI;
	private model: Model;

	constructor(model: Model, apiKey?: string) {
		if (!apiKey) {
			if (!process.env.GEMINI_API_KEY) {
				throw new Error(
					"Gemini API key is required. Set GEMINI_API_KEY environment variable or pass it as an argument.",
				);
			}
			apiKey = process.env.GEMINI_API_KEY;
		}
		this.client = new GoogleGenAI({ apiKey });
		this.model = model;
	}

	getModel(): Model {
		return this.model;
	}

	async complete(context: Context, options?: GoogleLLMOptions): Promise<AssistantMessage> {
		try {
			const contents = this.convertMessages(context.messages);

			// Build generation config
			const generationConfig: GenerateContentConfig = {};
			if (options?.temperature !== undefined) {
				generationConfig.temperature = options.temperature;
			}
			if (options?.maxTokens !== undefined) {
				generationConfig.maxOutputTokens = options.maxTokens;
			}

			// Build the config object
			const config: GenerateContentConfig = {
				...(Object.keys(generationConfig).length > 0 && generationConfig),
				...(context.systemPrompt && { systemInstruction: context.systemPrompt }),
				...(context.tools && { tools: this.convertTools(context.tools) }),
			};

			// Add tool config if needed
			if (context.tools && options?.toolChoice) {
				config.toolConfig = {
					functionCallingConfig: {
						mode: this.mapToolChoice(options.toolChoice),
					},
				};
			}

			// Add thinking config if enabled and model supports it
			if (options?.thinking?.enabled && this.model.reasoning) {
				config.thinkingConfig = {
					includeThoughts: true,
					...(options.thinking.budgetTokens !== undefined && { thinkingBudget: options.thinking.budgetTokens }),
				};
			}

			// Build the request parameters
			const params: GenerateContentParameters = {
				model: this.model.id,
				contents,
				config,
			};

			const stream = await this.client.models.generateContentStream(params);

			let content = "";
			let thinking = "";
			let thoughtSignature: string | undefined;
			const toolCalls: ToolCall[] = [];
			let usage: Usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			let stopReason: StopReason = "stop";
			let inTextBlock = false;
			let inThinkingBlock = false;

			// Process the stream
			for await (const chunk of stream) {
				// Extract parts from the chunk
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						// Cast to any to access thinking properties not yet in SDK types
						const partWithThinking = part;
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

							// Gemini doesn't provide tool call IDs, so we need to generate them
							// Use the function name as part of the ID for better debugging
							const toolCallId = `${part.functionCall.name}_${Date.now()}`;
							toolCalls.push({
								id: toolCallId,
								name: part.functionCall.name || "",
								arguments: part.functionCall.args as Record<string, any>,
							});
						}
					}
				}

				// Map finish reason
				if (candidate?.finishReason) {
					stopReason = this.mapStopReason(candidate.finishReason);
					if (toolCalls.length > 0) {
						stopReason = "toolUse";
					}
				}

				// Capture usage metadata if available
				if (chunk.usageMetadata) {
					usage = {
						input: chunk.usageMetadata.promptTokenCount || 0,
						output:
							(chunk.usageMetadata.candidatesTokenCount || 0) + (chunk.usageMetadata.thoughtsTokenCount || 0),
						cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
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
			}

			// Signal end of blocks
			if (inTextBlock) {
				options?.onText?.("", true);
			}
			if (inThinkingBlock) {
				options?.onThinking?.("", true);
			}

			// Generate a thinking signature if we have thinking content but no signature from API
			// This is needed for proper multi-turn conversations with thinking
			if (thinking && !thoughtSignature) {
				// Create a base64-encoded signature as Gemini expects
				// In production, Gemini API should provide this
				const encoder = new TextEncoder();
				const data = encoder.encode(thinking);
				// Create a simple hash-like signature and encode to base64
				const signature = `gemini_thinking_${data.length}_${Date.now()}`;
				thoughtSignature = Buffer.from(signature).toString("base64");
			}

			// Calculate cost
			calculateCost(this.model, usage);

			// Usage metadata is in the last chunk
			// Already captured during streaming

			return {
				role: "assistant",
				content: content || undefined,
				thinking: thinking || undefined,
				thinkingSignature: thoughtSignature,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				provider: this.model.provider,
				model: this.model.id,
				usage,
				stopReason,
			};
		} catch (error) {
			return {
				role: "assistant",
				provider: this.model.provider,
				model: this.model.id,
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

				// Add thinking if present
				// Note: We include thinkingSignature in our response for multi-turn context,
				// but don't send it back to Gemini API as it may cause errors
				if (msg.thinking) {
					parts.push({
						text: msg.thinking,
						thought: true,
						// Don't include thoughtSignature when sending back to API
						// thoughtSignature: msg.thinkingSignature,
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
				// Extract function name from the tool call ID (format: "functionName_timestamp")
				const functionName = msg.toolCallId.substring(0, msg.toolCallId.lastIndexOf("_"));
				contents.push({
					role: "user",
					parts: [
						{
							functionResponse: {
								name: functionName,
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

	private mapToolChoice(choice: string): FunctionCallingConfigMode {
		switch (choice) {
			case "auto":
				return FunctionCallingConfigMode.AUTO;
			case "none":
				return FunctionCallingConfigMode.NONE;
			case "any":
				return FunctionCallingConfigMode.ANY;
			default:
				return FunctionCallingConfigMode.AUTO;
		}
	}

	private mapStopReason(reason: FinishReason): StopReason {
		switch (reason) {
			case "STOP":
				return "stop";
			case "MAX_TOKENS":
				return "length";
			case "BLOCKLIST":
			case "PROHIBITED_CONTENT":
			case "SPII":
			case "SAFETY":
			case "IMAGE_SAFETY":
				return "safety";
			case "RECITATION":
				return "safety";
			case "FINISH_REASON_UNSPECIFIED":
			case "OTHER":
			case "LANGUAGE":
			case "MALFORMED_FUNCTION_CALL":
			case "UNEXPECTED_TOOL_CALL":
				return "error";
			default:
				return "stop";
		}
	}
}
