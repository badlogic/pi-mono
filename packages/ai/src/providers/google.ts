import {
	type GenerateContentConfig,
	type GenerateContentParameters,
	GoogleGenAI,
	type ThinkingConfig,
} from "@google/genai";
import { getEnvApiKey } from "../env-api-keys.js";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingBudgets,
	ThinkingContent,
	ThinkingLevel,
	ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import type { GoogleThinkingLevel } from "./google-gemini-cli.js";
import {
	convertMessages,
	convertMessagesToInteractionInput,
	convertTools,
	convertToolsToInteractionFormat,
	isThinkingPart,
	mapInteractionStatus,
	mapStopReason,
	mapToolChoice,
	retainThoughtSignature,
} from "./google-shared.js";
import { buildBaseOptions, clampReasoning } from "./simple-options.js";

export interface GoogleOptions extends StreamOptions {
	useInteractionsApi?: boolean;
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number; // -1 for dynamic, 0 to disable
		level?: GoogleThinkingLevel;
	};
}

// Counter for generating unique tool call IDs
let toolCallCounter = 0;

export const streamGoogle: StreamFunction<"google-generative-ai", GoogleOptions> = (
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
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const client = createClient(model, apiKey, options?.headers);

			if (options?.useInteractionsApi) {
				let params = buildInteractionParams(model, context, options);
				const nextParams = await options?.onPayload?.(params, model);
				if (nextParams !== undefined) {
					params = nextParams;
				}
				const finalPayload = { ...params, stream: true, store: false };

				// Use generic 'any' typing to bypass typed client restrictions
				const interactionStream = await (client as any).interactions.create(finalPayload);
				stream.push({ type: "start", partial: output });

				let currentBlock: TextContent | ThinkingContent | null = null;
				const blocks = output.content;
				const blockIndex = () => blocks.length - 1;

				function emitBlockEnd() {
					if (currentBlock) {
						const idx = blockIndex();
						if (currentBlock.type === "text" && currentBlock.text.length > 0) {
							stream.push({ type: "text_end", contentIndex: idx, content: currentBlock.text, partial: output });
						} else if (currentBlock.type === "thinking") {
							if (currentBlock.thinking.length > 0 || currentBlock.thinkingSignature) {
								stream.push({
									type: "thinking_end",
									contentIndex: idx,
									content: currentBlock.thinking,
									partial: output,
								});
							} else {
								blocks.pop();
							}
						}
					}
					currentBlock = null;
				}

				for await (const chunk of interactionStream) {
					if (chunk.content?.delta) {
						const delta = chunk.content.delta;
						if (delta.type === "text" && delta.text) {
							if (!currentBlock || currentBlock.type !== "text") {
								emitBlockEnd();
								currentBlock = { type: "text", text: "" };
								blocks.push(currentBlock);
								stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
							}
							currentBlock.text += delta.text;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: delta.text,
								partial: output,
							});
						} else if ((delta.type === "thought" || delta.type === "thought_summary") && delta.text) {
							if (!currentBlock || currentBlock.type !== "thinking") {
								emitBlockEnd();
								currentBlock = { type: "thinking", thinking: "" };
								blocks.push(currentBlock);
								stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
							}
							currentBlock.thinking += delta.text;
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: delta.text,
								partial: output,
							});
						} else if (delta.type === "thought_signature" && delta.text) {
							if (!currentBlock || currentBlock.type !== "thinking") {
								emitBlockEnd();
								currentBlock = { type: "thinking", thinking: "" };
								blocks.push(currentBlock);
								stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
							}
							currentBlock.thinkingSignature = (currentBlock.thinkingSignature || "") + delta.text;
						} else if (delta.type === "function_call") {
							emitBlockEnd();
							const callId = delta.id || `call_${toolCallCounter++}`;
							const tc: ToolCall = {
								type: "toolCall",
								id: callId,
								name: delta.name || "",
								arguments: delta.arguments || {},
							};
							blocks.push(tc);
							stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall: tc, partial: output });
						}
					}

					if (chunk.interaction?.complete) {
						emitBlockEnd();
						const complete = chunk.interaction.complete;
						if (complete.usage) {
							output.usage.input = complete.usage.total_input_tokens || 0;
							output.usage.output = complete.usage.total_output_tokens || 0;
							output.usage.cacheRead = complete.usage.total_cached_tokens || 0;
							output.usage.totalTokens = complete.usage.total_tokens || 0;
							// Add thought tokens to usage if available
							(output.usage as any).thoughtTokens = complete.usage.total_thought_tokens || 0;
						}
						if (complete.status) {
							output.stopReason = mapInteractionStatus(complete.status);
						}
					}
				}

				emitBlockEnd();

				output.usage.cost = calculateCost(model, output.usage);
				output.timestamp = Date.now();
				stream.push({ type: "done", reason: output.stopReason as any, message: output });
				return;
			}

			let params = buildParams(model, context, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== undefined) {
				params = nextParams as GenerateContentParameters;
			}
			const googleStream = await client.models.generateContentStream(params);

			stream.push({ type: "start", partial: output });
			let currentBlock: TextContent | ThinkingContent | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			for await (const chunk of googleStream) {
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text !== undefined) {
							const isThinking = isThinkingPart(part);
							if (
								!currentBlock ||
								(isThinking && currentBlock.type !== "thinking") ||
								(!isThinking && currentBlock.type !== "text")
							) {
								if (currentBlock) {
									if (currentBlock.type === "text") {
										stream.push({
											type: "text_end",
											contentIndex: blocks.length - 1,
											content: currentBlock.text,
											partial: output,
										});
									} else {
										stream.push({
											type: "thinking_end",
											contentIndex: blockIndex(),
											content: currentBlock.thinking,
											partial: output,
										});
									}
								}
								if (isThinking) {
									currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
									output.content.push(currentBlock);
									stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
								} else {
									currentBlock = { type: "text", text: "" };
									output.content.push(currentBlock);
									stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
								}
							}
							if (currentBlock.type === "thinking") {
								currentBlock.thinking += part.text;
								currentBlock.thinkingSignature = retainThoughtSignature(
									currentBlock.thinkingSignature,
									part.thoughtSignature,
								);
								stream.push({
									type: "thinking_delta",
									contentIndex: blockIndex(),
									delta: part.text,
									partial: output,
								});
							} else {
								currentBlock.text += part.text;
								currentBlock.textSignature = retainThoughtSignature(
									currentBlock.textSignature,
									part.thoughtSignature,
								);
								stream.push({
									type: "text_delta",
									contentIndex: blockIndex(),
									delta: part.text,
									partial: output,
								});
							}
						}

						if (part.functionCall) {
							if (currentBlock) {
								if (currentBlock.type === "text") {
									stream.push({
										type: "text_end",
										contentIndex: blockIndex(),
										content: currentBlock.text,
										partial: output,
									});
								} else {
									stream.push({
										type: "thinking_end",
										contentIndex: blockIndex(),
										content: currentBlock.thinking,
										partial: output,
									});
								}
								currentBlock = null;
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
								arguments: (part.functionCall.args as Record<string, any>) ?? {},
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

			if (currentBlock) {
				if (currentBlock.type === "text") {
					stream.push({
						type: "text_end",
						contentIndex: blockIndex(),
						content: currentBlock.text,
						partial: output,
					});
				} else {
					stream.push({
						type: "thinking_end",
						contentIndex: blockIndex(),
						content: currentBlock.thinking,
						partial: output,
					});
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
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

export const streamSimpleGoogle: StreamFunction<"google-generative-ai", SimpleStreamOptions> = (
	model: Model<"google-generative-ai">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamGoogle(model, context, { ...base, thinking: { enabled: false } } satisfies GoogleOptions);
	}

	const effort = clampReasoning(options.reasoning)!;
	const googleModel = model as Model<"google-generative-ai">;

	if (isGemini3ProModel(googleModel) || isGemini3FlashModel(googleModel)) {
		return streamGoogle(model, context, {
			...base,
			thinking: {
				enabled: true,
				level: getGemini3ThinkingLevel(effort, googleModel),
			},
		} satisfies GoogleOptions);
	}

	return streamGoogle(model, context, {
		...base,
		thinking: {
			enabled: true,
			budgetTokens: getGoogleBudget(googleModel, effort, options.thinkingBudgets),
		},
	} satisfies GoogleOptions);
};

function createClient(
	model: Model<"google-generative-ai">,
	apiKey?: string,
	optionsHeaders?: Record<string, string>,
): GoogleGenAI {
	const httpOptions: { baseUrl?: string; apiVersion?: string; headers?: Record<string, string> } = {};
	if (model.baseUrl) {
		httpOptions.baseUrl = model.baseUrl;
		httpOptions.apiVersion = ""; // baseUrl already includes version path, don't append
	}
	if (model.headers || optionsHeaders) {
		httpOptions.headers = { ...model.headers, ...optionsHeaders };
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
			// Cast to any since our GoogleThinkingLevel mirrors Google's ThinkingLevel enum values
			thinkingConfig.thinkingLevel = options.thinking.level as any;
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

type ClampedThinkingLevel = Exclude<ThinkingLevel, "xhigh">;

function isGemini3ProModel(model: Model<"google-generative-ai">): boolean {
	return /gemini-3(?:\.\d+)?-pro/.test(model.id.toLowerCase());
}

function isGemini3FlashModel(model: Model<"google-generative-ai">): boolean {
	return /gemini-3(?:\.\d+)?-flash/.test(model.id.toLowerCase());
}

function getGemini3ThinkingLevel(
	effort: ClampedThinkingLevel,
	model: Model<"google-generative-ai">,
): GoogleThinkingLevel {
	if (isGemini3ProModel(model)) {
		switch (effort) {
			case "minimal":
			case "low":
				return "LOW";
			case "medium":
			case "high":
				return "HIGH";
		}
	}
	switch (effort) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
			return "HIGH";
	}
}

function getGoogleBudget(
	model: Model<"google-generative-ai">,
	effort: ClampedThinkingLevel,
	customBudgets?: ThinkingBudgets,
): number {
	if (customBudgets?.[effort] !== undefined) {
		return customBudgets[effort]!;
	}

	if (model.id.includes("2.5-pro")) {
		const budgets: Record<ClampedThinkingLevel, number> = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 32768,
		};
		return budgets[effort];
	}

	if (model.id.includes("2.5-flash")) {
		const budgets: Record<ClampedThinkingLevel, number> = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 24576,
		};
		return budgets[effort];
	}

	return -1;
}

function buildInteractionParams(model: Model<"google-generative-ai">, context: Context, options?: GoogleOptions): any {
	const input = convertMessagesToInteractionInput(model, context);
	const system_instruction =
		typeof context.systemPrompt === "string" ? sanitizeSurrogates(context.systemPrompt) : undefined;

	const params: any = {
		model: model.id,
		input,
		tools: convertToolsToInteractionFormat(context.tools) as any,
	};

	if (system_instruction) {
		params.system_instruction = system_instruction;
	}

	if (options) {
		const genConfig: any = {};
		if (options.temperature !== undefined) genConfig.temperature = options.temperature;
		if (options.maxTokens !== undefined) genConfig.maxOutputTokens = options.maxTokens;

		if (options.thinking?.enabled && model.reasoning) {
			genConfig.thinking_level = options.thinking.level;
			genConfig.thinking_budget = options.thinking.budgetTokens;
		}

		if (Object.keys(genConfig).length > 0) {
			params.generation_config = genConfig;
		}
	}

	return params;
}
