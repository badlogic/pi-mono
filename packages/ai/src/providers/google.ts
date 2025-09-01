import {
	type Content,
	type FinishReason,
	FunctionCallingConfigMode,
	type GenerateContentConfig,
	type GenerateContentParameters,
	GoogleGenAI,
	type Part,
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
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
} from "../types.js";
import { transformMessages } from "./utils.js";

export interface GoogleLLMOptions extends LLMOptions {
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number; // -1 for dynamic, 0 to disable
	};
}

export class GoogleLLM implements LLM<GoogleLLMOptions> {
	private client: GoogleGenAI;
	private modelInfo: Model;

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
		this.modelInfo = model;
	}

	getModel(): Model {
		return this.modelInfo;
	}

	async generate(context: Context, options?: GoogleLLMOptions): Promise<AssistantMessage> {
		const output: AssistantMessage = {
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
			stopReason: "stop",
		};
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
			if (options?.thinking?.enabled && this.modelInfo.reasoning) {
				config.thinkingConfig = {
					includeThoughts: true,
					...(options.thinking.budgetTokens !== undefined && { thinkingBudget: options.thinking.budgetTokens }),
				};
			}

			// Abort signal
			if (options?.signal) {
				if (options.signal.aborted) {
					throw new Error("Request aborted");
				}
				config.abortSignal = options.signal;
			}

			// Build the request parameters
			const params: GenerateContentParameters = {
				model: this.modelInfo.id,
				contents,
				config,
			};

			const stream = await this.client.models.generateContentStream(params);

			options?.onEvent?.({ type: "start", model: this.modelInfo.id, provider: this.modelInfo.provider });
			let currentBlock: TextContent | ThinkingContent | null = null;
			for await (const chunk of stream) {
				// Extract parts from the chunk
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text !== undefined) {
							const isThinking = part.thought === true;

							// Check if we need to switch blocks
							if (
								!currentBlock ||
								(isThinking && currentBlock.type !== "thinking") ||
								(!isThinking && currentBlock.type !== "text")
							) {
								if (currentBlock) {
									if (currentBlock.type === "text") {
										options?.onEvent?.({ type: "text_end", content: currentBlock.text });
									} else {
										options?.onEvent?.({ type: "thinking_end", content: currentBlock.thinking });
									}
								}

								// Start new block
								if (isThinking) {
									currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
									options?.onEvent?.({ type: "thinking_start" });
								} else {
									currentBlock = { type: "text", text: "" };
									options?.onEvent?.({ type: "text_start" });
								}
								output.content.push(currentBlock);
							}

							// Append content to current block
							if (currentBlock.type === "thinking") {
								currentBlock.thinking += part.text;
								currentBlock.thinkingSignature = part.thoughtSignature;
								options?.onEvent?.({
									type: "thinking_delta",
									content: currentBlock.thinking,
									delta: part.text,
								});
							} else {
								currentBlock.text += part.text;
								options?.onEvent?.({ type: "text_delta", content: currentBlock.text, delta: part.text });
							}
						}

						// Handle function calls
						if (part.functionCall) {
							if (currentBlock) {
								if (currentBlock.type === "text") {
									options?.onEvent?.({ type: "text_end", content: currentBlock.text });
								} else {
									options?.onEvent?.({ type: "thinking_end", content: currentBlock.thinking });
								}
								currentBlock = null;
							}

							// Add tool call
							const toolCallId = part.functionCall.id || `${part.functionCall.name}_${Date.now()}`;
							const toolCall: ToolCall = {
								type: "toolCall",
								id: toolCallId,
								name: part.functionCall.name || "",
								arguments: part.functionCall.args as Record<string, any>,
							};
							output.content.push(toolCall);
							options?.onEvent?.({ type: "toolCall", toolCall });
						}
					}
				}

				// Map finish reason
				if (candidate?.finishReason) {
					output.stopReason = this.mapStopReason(candidate.finishReason);
					// Check if we have tool calls in blocks
					if (output.content.some((b) => b.type === "toolCall")) {
						output.stopReason = "toolUse";
					}
				}

				// Capture usage metadata if available
				if (chunk.usageMetadata) {
					output.usage = {
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
					calculateCost(this.modelInfo, output.usage);
				}
			}

			// Finalize last block
			if (currentBlock) {
				if (currentBlock.type === "text") {
					options?.onEvent?.({ type: "text_end", content: currentBlock.text });
				} else {
					options?.onEvent?.({ type: "thinking_end", content: currentBlock.thinking });
				}
			}

			options?.onEvent?.({ type: "done", reason: output.stopReason, message: output });
			return output;
		} catch (error) {
			output.stopReason = "error";
			output.error = error instanceof Error ? error.message : JSON.stringify(error);
			options?.onEvent?.({ type: "error", error: output.error });
			return output;
		}
	}

	private convertMessages(messages: Message[]): Content[] {
		const contents: Content[] = [];

		// Transform messages for cross-provider compatibility
		const transformedMessages = transformMessages(messages, this.modelInfo);

		for (const msg of transformedMessages) {
			if (msg.role === "user") {
				// Handle both string and array content
				if (typeof msg.content === "string") {
					contents.push({
						role: "user",
						parts: [{ text: msg.content }],
					});
				} else {
					// Convert array content to Google format
					const parts: Part[] = msg.content.map((item) => {
						if (item.type === "text") {
							return { text: item.text };
						} else {
							// Image content - Google uses inlineData
							return {
								inlineData: {
									mimeType: item.mimeType,
									data: item.data,
								},
							};
						}
					});
					contents.push({
						role: "user",
						parts,
					});
				}
			} else if (msg.role === "assistant") {
				const parts: Part[] = [];

				// Process content blocks
				for (const block of msg.content) {
					if (block.type === "text") {
						parts.push({ text: block.text });
					} else if (block.type === "thinking") {
						const thinkingPart: Part = {
							thought: true,
							thoughtSignature: block.thinkingSignature,
							text: block.thinking,
						};
						parts.push(thinkingPart);
					} else if (block.type === "toolCall") {
						parts.push({
							functionCall: {
								id: block.id,
								name: block.name,
								args: block.arguments,
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
				contents.push({
					role: "user",
					parts: [
						{
							functionResponse: {
								id: msg.toolCallId,
								name: msg.toolName,
								response: {
									result: msg.content,
									isError: msg.isError,
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
