import {
	type GenerateContentConfig,
	type GenerateContentParameters,
	GoogleGenAI,
	type ThinkingConfig,
	type ThinkingLevel,
} from "@google/genai";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { ThinkingTagExtractor } from "../utils/thinking-tag-extractor.js";
import { convertMessages, convertTools, mapStopReason, mapToolChoice } from "./google-shared.js";

export interface GoogleOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number; // -1 for dynamic, 0 to disable
		level?: ThinkingLevel;
	};
}

// Counter for generating unique tool call IDs
let toolCallCounter = 0;

export const streamGoogle: StreamFunction<"google-generative-ai"> = (
	model: Model<"google-generative-ai">,
	context: Context,
	options?: GoogleOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "google-generative-ai" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const client = createClient(model, options?.apiKey);
			const params = buildParams(model, context, options);
			const googleStream = await client.models.generateContentStream(params);

			stream.push({ type: "start", partial: output });
			const state: { currentBlock: TextContent | ThinkingContent | null } = { currentBlock: null };
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			const thinkingExtractor = new ThinkingTagExtractor();

			// Helper to handle a text/thinking segment
			const handleSegment = (content: string, isThinking: boolean, thoughtSignature?: string) => {
				if (content.length === 0) return;

				if (
					!state.currentBlock ||
					(isThinking && state.currentBlock.type !== "thinking") ||
					(!isThinking && state.currentBlock.type !== "text")
				) {
					if (state.currentBlock) {
						if (state.currentBlock.type === "text") {
							stream.push({
								type: "text_end",
								contentIndex: blocks.length - 1,
								content: state.currentBlock.text,
								partial: output,
							});
						} else {
							stream.push({
								type: "thinking_end",
								contentIndex: blockIndex(),
								content: state.currentBlock.thinking,
								partial: output,
							});
						}
					}
					if (isThinking) {
						state.currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
						output.content.push(state.currentBlock);
						stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
					} else {
						state.currentBlock = { type: "text", text: "" };
						output.content.push(state.currentBlock);
						stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
					}
				}
				if (state.currentBlock.type === "thinking") {
					state.currentBlock.thinking += content;
					state.currentBlock.thinkingSignature = thoughtSignature;
					stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta: content,
						partial: output,
					});
				} else {
					state.currentBlock.text += content;
					stream.push({
						type: "text_delta",
						contentIndex: blockIndex(),
						delta: content,
						partial: output,
					});
				}
			};

			for await (const chunk of googleStream) {
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text !== undefined) {
							const extracted = thinkingExtractor.process(part.text, part.thought === true);
							// Process thinking content first, then regular text
							handleSegment(extracted.thinking, true, part.thoughtSignature);
							handleSegment(extracted.text, false);
						}

						if (part.functionCall) {
							if (state.currentBlock) {
								if (state.currentBlock.type === "text") {
									stream.push({
										type: "text_end",
										contentIndex: blockIndex(),
										content: state.currentBlock.text,
										partial: output,
									});
								} else {
									stream.push({
										type: "thinking_end",
										contentIndex: blockIndex(),
										content: state.currentBlock.thinking,
										partial: output,
									});
								}
								state.currentBlock = null;
							}

							// Generate unique ID if not provided or if it's a duplicate
							const providedId = part.functionCall.id;
							const needsNewId =
								!providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
							const toolCallId = needsNewId
								? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
								: providedId;

							const toolCall: ToolCall = {
								type: "toolCall",
								id: toolCallId,
								name: part.functionCall.name || "",
								arguments: part.functionCall.args as Record<string, any>,
								...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
							};

							output.content.push(toolCall);
							stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							stream.push({
								type: "toolcall_delta",
								contentIndex: blockIndex(),
								delta: JSON.stringify(toolCall.arguments),
								partial: output,
							});
							stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
						}
					}
				}

				if (candidate?.finishReason) {
					output.stopReason = mapStopReason(candidate.finishReason);
					if (output.content.some((b) => b.type === "toolCall")) {
						output.stopReason = "toolUse";
					}
				}

				if (chunk.usageMetadata) {
					output.usage = {
						input: chunk.usageMetadata.promptTokenCount || 0,
						output:
							(chunk.usageMetadata.candidatesTokenCount || 0) + (chunk.usageMetadata.thoughtsTokenCount || 0),
						cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
						cacheWrite: 0,
						totalTokens: chunk.usageMetadata.totalTokenCount || 0,
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
			}

			if (state.currentBlock) {
				if (state.currentBlock.type === "text") {
					stream.push({
						type: "text_end",
						contentIndex: blockIndex(),
						content: state.currentBlock.text,
						partial: output,
					});
				} else {
					stream.push({
						type: "thinking_end",
						contentIndex: blockIndex(),
						content: state.currentBlock.thinking,
						partial: output,
					});
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unkown error ocurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			// Remove internal index property used during streaming
			for (const block of output.content) {
				if ("index" in block) {
					delete (block as { index?: number }).index;
				}
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function createClient(model: Model<"google-generative-ai">, apiKey?: string): GoogleGenAI {
	if (!apiKey) {
		if (!process.env.GEMINI_API_KEY) {
			throw new Error(
				"Gemini API key is required. Set GEMINI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = process.env.GEMINI_API_KEY;
	}

	const httpOptions: { baseUrl?: string; apiVersion?: string; headers?: Record<string, string> } = {};
	if (model.baseUrl) {
		httpOptions.baseUrl = model.baseUrl;
		httpOptions.apiVersion = ""; // baseUrl already includes version path, don't append
	}
	if (model.headers) {
		httpOptions.headers = model.headers;
	}

	return new GoogleGenAI({
		apiKey,
		httpOptions: Object.keys(httpOptions).length > 0 ? httpOptions : undefined,
	});
}

function buildParams(
	model: Model<"google-generative-ai">,
	context: Context,
	options: GoogleOptions = {},
): GenerateContentParameters {
	const contents = convertMessages(model, context);

	const generationConfig: GenerateContentConfig = {};
	if (options.temperature !== undefined) {
		generationConfig.temperature = options.temperature;
	}
	if (options.maxTokens !== undefined) {
		generationConfig.maxOutputTokens = options.maxTokens;
	}

	const config: GenerateContentConfig = {
		...(Object.keys(generationConfig).length > 0 && generationConfig),
		...(context.systemPrompt && { systemInstruction: sanitizeSurrogates(context.systemPrompt) }),
		...(context.tools && context.tools.length > 0 && { tools: convertTools(context.tools) }),
	};

	if (context.tools && context.tools.length > 0 && options.toolChoice) {
		config.toolConfig = {
			functionCallingConfig: {
				mode: mapToolChoice(options.toolChoice),
			},
		};
	} else {
		config.toolConfig = undefined;
	}

	if (options.thinking?.enabled && model.reasoning) {
		const thinkingConfig: ThinkingConfig = { includeThoughts: true };
		if (options.thinking.level !== undefined) {
			thinkingConfig.thinkingLevel = options.thinking.level;
		} else if (options.thinking.budgetTokens !== undefined) {
			thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		}
		config.thinkingConfig = thinkingConfig;
	}

	if (options.signal) {
		if (options.signal.aborted) {
			throw new Error("Request aborted");
		}
		config.abortSignal = options.signal;
	}

	const params: GenerateContentParameters = {
		model: model.id,
		contents,
		config,
	};

	return params;
}
