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
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { validateToolArguments } from "../utils/validation.js";
import { transformMessages } from "./transorm-messages.js";

type RetryPolicy = {
	maxAttempts: number;
	initialDelayMs: number;
	backoffFactor: number;
};

const AZURE_OPENAI_HOST_SUFFIX = ".openai.azure.com";

const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxAttempts: 1,
	initialDelayMs: 0,
	backoffFactor: 1,
};

const RETRYABLE_SUBSTRINGS = [
	"unknown error",
	"failed to fetch",
	"network error",
	"socket hang up",
	"timed out",
	"no response",
	"connection reset",
	"server error",
];

function getEffectiveBaseUrl(baseUrl?: string): string | undefined {
	if (!baseUrl) {
		return undefined;
	}

	try {
		const parsed = new URL(baseUrl);
		const proxiedUrl = parsed.searchParams.get("url");
		return proxiedUrl ?? baseUrl;
	} catch {
		return baseUrl;
	}
}

function isAzureOpenAIBaseUrl(baseUrl?: string): boolean {
	const effectiveUrl = getEffectiveBaseUrl(baseUrl);
	if (!effectiveUrl) {
		return false;
	}

	try {
		const hostname = new URL(effectiveUrl).hostname.toLowerCase();
		return hostname.endsWith(AZURE_OPENAI_HOST_SUFFIX);
	} catch {
		return effectiveUrl.toLowerCase().includes(AZURE_OPENAI_HOST_SUFFIX);
	}
}

function resolveOpenAIRetryPolicy<TApi extends Api>(
	model: Model<TApi>,
	retryOverride?: Partial<RetryPolicy>,
): RetryPolicy {
	if (retryOverride) {
		return resolveRetryPolicy(retryOverride);
	}

	return resolveRetryPolicy(
		isAzureOpenAIBaseUrl(model.baseUrl)
			? { maxAttempts: 10, initialDelayMs: 10_000, backoffFactor: 1 }
			: { maxAttempts: 1, initialDelayMs: 0, backoffFactor: 1 },
	);
}

function resolveRetryPolicy(override?: Partial<RetryPolicy>): RetryPolicy {
	if (!override) {
		return DEFAULT_RETRY_POLICY;
	}

	return {
		maxAttempts: Math.max(1, override.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts),
		initialDelayMs: Math.max(0, override.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs),
		backoffFactor: Math.max(1, override.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor),
	};
}

function computeDelayMs(policy: RetryPolicy, attempt: number): number {
	if (attempt <= 1) {
		return policy.initialDelayMs;
	}
	return Math.round(policy.initialDelayMs * policy.backoffFactor ** (attempt - 1));
}

function isAbortError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	return (error as { name?: string }).name === "AbortError";
}

function isRetriableError(error: unknown): boolean {
	if (!error || isAbortError(error)) {
		return false;
	}

	if (error instanceof Error) {
		const candidate = error as Error & {
			status?: number;
			statusCode?: number;
			response?: { status?: number };
			cause?: { status?: number } | Error;
		};
		const status =
			candidate.status ??
			candidate.statusCode ??
			candidate.response?.status ??
			(candidate.cause && typeof candidate.cause === "object"
				? (candidate.cause as { status?: number }).status
				: undefined);
		if (typeof status === "number" && (status === 408 || status === 409 || status >= 500)) {
			return true;
		}

		const message = candidate.message.toLowerCase();
		if (RETRYABLE_SUBSTRINGS.some((token) => message.includes(token))) {
			return true;
		}
	}

	return false;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		};

		const onAbort = () => {
			cleanup();
			reject(new Error("Retry aborted"));
		};

		if (signal?.aborted) {
			cleanup();
			reject(new Error("Retry aborted"));
			return;
		}

		signal?.addEventListener("abort", onAbort);
	});
}

interface RetryDecisionParams {
	error: unknown;
	attempt: number;
	policy: RetryPolicy;
	hasStreamedContent: boolean;
	signal?: AbortSignal;
	force?: boolean;
}

function shouldRetryAttempt(params: RetryDecisionParams): boolean {
	if (params.signal?.aborted) {
		return false;
	}
	if (params.hasStreamedContent) {
		return false;
	}
	const flagged = Boolean((params.error as { retriable?: boolean } | undefined)?.retriable);
	if (flagged || params.force) {
		return true;
	}
	if (params.attempt >= params.policy.maxAttempts) {
		return false;
	}
	return isRetriableError(params.error);
}

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
	retry?: Partial<RetryPolicy>;
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
	const output = createAssistantMessage(model);
	stream.push({ type: "start", partial: output });

	(async () => {
		const retryPolicy = resolveOpenAIRetryPolicy(model, options?.retry);
		let attempt = 1;

		while (attempt <= retryPolicy.maxAttempts) {
			const attemptState = { streamedContent: false };
			try {
				await processAttempt(attemptState);
				return;
			} catch (error) {
				const canRetry = shouldRetryAttempt({
					error,
					attempt,
					policy: retryPolicy,
					hasStreamedContent: attemptState.streamedContent,
					signal: options?.signal,
				});

				if (!canRetry) {
					emitFailure(error);
					return;
				}

				const nextAttempt = attempt + 1;
				const displayAttempt = Math.min(retryPolicy.maxAttempts, Math.max(1, Math.ceil(nextAttempt)));
				const delayMs = computeDelayMs(retryPolicy, attempt);
				const delaySeconds = Math.max(1, Math.ceil(delayMs / 1000));
				const reason = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

				stream.push({
					type: "status",
					message: `Retrying (${displayAttempt}/${retryPolicy.maxAttempts}) in ${delaySeconds}s after OpenAI Responses error: ${reason}`,
				});

				try {
					await delay(delayMs, options?.signal);
				} catch (delayError) {
					emitFailure(delayError);
					return;
				}

				attempt = nextAttempt;
			}
		}

		function emitFailure(error: unknown) {
			sanitizeBlocks(output);
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}

		async function processAttempt(attemptState: { streamedContent: boolean }) {
			resetAssistantMessage(output);

			const client = createClient(model, options?.apiKey);
			const params = buildParams(model, context, options);
			const openaiStream = await client.responses.create(params, { signal: options?.signal });

			let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
			let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			const markStreamed = () => {
				if (!attemptState.streamedContent) {
					attemptState.streamedContent = true;
				}
			};

			for await (const event of openaiStream) {
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
				} else if (event.type === "response.reasoning_summary_part.added") {
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
							markStreamed();
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				} else if (event.type === "response.reasoning_summary_part.done") {
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
							markStreamed();
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: "\n\n",
								partial: output,
							});
						}
					}
				} else if (event.type === "response.content_part.added") {
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
							markStreamed();
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
							markStreamed();
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				} else if (event.type === "response.function_call_arguments.delta") {
					if (
						currentItem &&
						currentItem.type === "function_call" &&
						currentBlock &&
						currentBlock.type === "toolCall"
					) {
						currentBlock.partialJson += event.delta;
						currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
						markStreamed();
						stream.push({
							type: "toolcall_delta",
							contentIndex: blockIndex(),
							delta: event.delta,
							partial: output,
						});
					}
				} else if (event.type === "response.output_item.done") {
					const item = event.item;

					if (item.type === "reasoning" && currentBlock && currentBlock.type === "thinking") {
						currentBlock.thinking = item.summary?.map((s) => s.text).join("\n\n") || "";
						currentBlock.thinkingSignature = JSON.stringify(item);
						markStreamed();
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
						markStreamed();
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

						if (context.tools) {
							const tool = context.tools.find((t) => t.name === toolCall.name);
							if (tool) {
								toolCall.arguments = validateToolArguments(tool, toolCall);
							}
						}

						markStreamed();
						stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
					}
				} else if (event.type === "response.completed") {
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
					output.stopReason = mapStopReason(response?.status);
					if (
						output.stopReason === "stop" &&
						output.content.some((block: TextContent | ThinkingContent | ToolCall) => block.type === "toolCall")
					) {
						output.stopReason = "toolUse";
					}
				} else if (event.type === "error") {
					throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
				} else if (event.type === "response.failed") {
					throw new Error("Unknown error");
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
		}
	})();

	return stream;
};

function createAssistantMessage(model: Model<"openai-responses">): AssistantMessage {
	return {
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
		timestamp: Date.now(),
	} satisfies AssistantMessage;
}

function resetAssistantMessage(message: AssistantMessage): void {
	message.content.length = 0;
	message.errorMessage = undefined;
	message.stopReason = "stop";
	message.timestamp = Date.now();
	message.usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function sanitizeBlocks(message: AssistantMessage): void {
	for (const block of message.content) {
		if (Object.hasOwn(block, "index")) {
			delete (block as { index?: number }).index;
		}
	}
}

function createClient(model: Model<"openai-responses">, apiKey?: string) {
	if (!apiKey) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = process.env.OPENAI_API_KEY;
	}
	return new OpenAI({
		apiKey,
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: model.headers,
	});
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
			content: sanitizeSurrogates(context.systemPrompt),
		});
	}

	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({
					role: "user",
					content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
					if (item.type === "text") {
						return {
							type: "input_text",
							text: sanitizeSurrogates(item.text),
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
						content: [{ type: "output_text", text: sanitizeSurrogates(textBlock.text), annotations: [] }],
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
			// Extract text and image content
			const textResult = msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as any).text)
				.join("\n");
			const hasImages = msg.content.some((c) => c.type === "image");

			// Always send function_call_output with text (or placeholder if only images)
			const hasText = textResult.length > 0;
			messages.push({
				type: "function_call_output",
				call_id: msg.toolCallId.split("|")[0],
				output: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
			});

			// If there are images and model supports them, send a follow-up user message with images
			if (hasImages && model.input.includes("image")) {
				const contentParts: ResponseInputContent[] = [];

				// Add text prefix
				contentParts.push({
					type: "input_text",
					text: "Attached image(s) from tool result:",
				} satisfies ResponseInputText);

				// Add images
				for (const block of msg.content) {
					if (block.type === "image") {
						contentParts.push({
							type: "input_image",
							detail: "auto",
							image_url: `data:${(block as any).mimeType};base64,${(block as any).data}`,
						} satisfies ResponseInputImage);
					}
				}

				messages.push({
					role: "user",
					content: contentParts,
				});
			}
		}
	}

	return messages;
}

function convertTools(tools: Tool[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as any, // TypeBox already generates JSON Schema
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
