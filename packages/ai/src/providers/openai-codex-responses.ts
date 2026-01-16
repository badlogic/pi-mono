import os from "node:os";
import type {
	ResponseFunctionToolCall,
	ResponseOutputMessage,
	ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import { PI_STATIC_INSTRUCTIONS } from "../constants.js";
import { calculateCost } from "../models.js";
import { getEnvApiKey } from "../stream.js";
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
	ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { transformMessages } from "./transform-messages.js";

// ============================================================================
// Configuration
// ============================================================================

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const JWT_CLAIM_PATH = "https://api.openai.com/auth" as const;
const DEFAULT_REQUEST_MAX_RETRIES = 4;
const DEFAULT_REQUEST_BASE_DELAY_MS = 200;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;

// ============================================================================
// Types
// ============================================================================

export interface OpenAICodexResponsesOptions extends StreamOptions {
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
	textVerbosity?: "low" | "medium" | "high";
}

interface RequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: unknown[];
	tools?: unknown;
	tool_choice?: "auto";
	parallel_tool_calls?: boolean;
	temperature?: number;
	reasoning?: { effort?: string; summary?: string };
	text?: { verbosity?: string };
	include?: string[];
	prompt_cache_key?: string;
	prompt_cache_retention?: "in-memory";
	[key: string]: unknown;
}

type CodexErrorDetails = AssistantMessage["errorDetails"];
type StreamReadResult = { done: boolean; value?: Uint8Array };

class CodexError extends Error {
	readonly details?: CodexErrorDetails;

	constructor(message: string, details?: CodexErrorDetails) {
		super(message);
		this.name = "CodexError";
		this.details = details;
	}
}

// ============================================================================
// Main Stream Function
// ============================================================================

export const streamOpenAICodexResponses: StreamFunction<"openai-codex-responses"> = (
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: OpenAICodexResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-codex-responses" as Api,
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
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const accountId = extractAccountId(apiKey);
			const body = buildRequestBody(model, context, options);
			const headers = buildHeaders(model.headers, accountId, apiKey, options?.sessionId);

			const response = await fetchWithRetry(
				CODEX_URL,
				{
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal: options?.signal,
				},
				{
					maxRetries: options?.requestMaxRetries ?? DEFAULT_REQUEST_MAX_RETRIES,
					baseDelayMs: options?.requestBaseDelayMs ?? DEFAULT_REQUEST_BASE_DELAY_MS,
					signal: options?.signal,
				},
			);

			if (!response.ok) {
				const info = await parseErrorResponse(response);
				throw new CodexError(info.message, info.errorDetails);
			}

			if (!response.body) {
				throw new CodexError("No response body", { retryable: true, kind: "transport" });
			}

			stream.push({ type: "start", partial: output });
			await processStream(response, output, stream, model, options);

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			if (error instanceof CodexError) {
				output.errorDetails = error.details;
			}
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

// ============================================================================
// Request Building
// ============================================================================

function buildRequestBody(
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: OpenAICodexResponsesOptions,
): RequestBody {
	const systemPrompt = buildSystemPrompt(context.systemPrompt);
	const messages = convertMessages(model, context);

	// Prepend developer messages
	const developerMessages = systemPrompt.developerMessages.map((text) => ({
		type: "message",
		role: "developer",
		content: [{ type: "input_text", text }],
	}));

	const body: RequestBody = {
		model: model.id,
		store: false,
		stream: true,
		instructions: systemPrompt.instructions,
		input: [...developerMessages, ...messages],
		text: { verbosity: options?.textVerbosity || "medium" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: options?.sessionId,
		tool_choice: "auto",
		parallel_tool_calls: true,
	};

	if (options?.sessionId) {
		body.prompt_cache_retention = "in-memory";
	}

	if (options?.temperature !== undefined) {
		body.temperature = options.temperature;
	}

	if (context.tools) {
		body.tools = context.tools.map((tool) => ({
			type: "function",
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			strict: null,
		}));
	}

	if (options?.reasoningEffort !== undefined) {
		body.reasoning = {
			effort: clampReasoningEffort(model.id, options.reasoningEffort),
			summary: options.reasoningSummary ?? "auto",
		};
	}

	return body;
}

function buildSystemPrompt(userSystemPrompt?: string): { instructions: string; developerMessages: string[] } {
	// PI_STATIC_INSTRUCTIONS is whitelisted and must be in the instructions field.
	// User's system prompt goes in developer messages, with the static prefix stripped.
	const staticPrefix = PI_STATIC_INSTRUCTIONS.trim();
	const developerMessages: string[] = [];

	if (userSystemPrompt?.trim()) {
		let dynamicPart = userSystemPrompt.trim();
		if (dynamicPart.startsWith(staticPrefix)) {
			dynamicPart = dynamicPart.slice(staticPrefix.length).trim();
		}
		if (dynamicPart) developerMessages.push(dynamicPart);
	}

	return { instructions: staticPrefix, developerMessages };
}

function clampReasoningEffort(modelId: string, effort: string): string {
	const id = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
	if (id === "gpt-5.1" && effort === "xhigh") return "high";
	if (id === "gpt-5.1-codex-mini") return effort === "high" || effort === "xhigh" ? "high" : "medium";
	return effort;
}

// ============================================================================
// Message Conversion
// ============================================================================

function convertMessages(model: Model<"openai-codex-responses">, context: Context): unknown[] {
	const messages: unknown[] = [];
	const transformed = transformMessages(context.messages, model);

	for (const msg of transformed) {
		if (msg.role === "user") {
			messages.push(convertUserMessage(msg, model));
		} else if (msg.role === "assistant") {
			messages.push(...convertAssistantMessage(msg));
		} else if (msg.role === "toolResult") {
			messages.push(...convertToolResult(msg, model));
		}
	}

	return messages.filter(Boolean);
}

function convertUserMessage(
	msg: { content: string | Array<{ type: string; text?: string; mimeType?: string; data?: string }> },
	model: Model<"openai-codex-responses">,
): unknown {
	if (typeof msg.content === "string") {
		return {
			role: "user",
			content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
		};
	}

	const content = msg.content.map((item) => {
		if (item.type === "text") {
			return { type: "input_text", text: sanitizeSurrogates(item.text || "") };
		}
		return {
			type: "input_image",
			detail: "auto",
			image_url: `data:${item.mimeType};base64,${item.data}`,
		};
	});

	const filtered = model.input.includes("image") ? content : content.filter((c) => c.type !== "input_image");
	return filtered.length > 0 ? { role: "user", content: filtered } : null;
}

function convertAssistantMessage(msg: AssistantMessage): unknown[] {
	const output: unknown[] = [];

	for (const block of msg.content) {
		if (block.type === "thinking" && msg.stopReason !== "error" && block.thinkingSignature) {
			output.push(JSON.parse(block.thinkingSignature));
		} else if (block.type === "text") {
			output.push({
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] }],
				status: "completed",
			});
		} else if (block.type === "toolCall" && msg.stopReason !== "error") {
			const [callId, id] = block.id.split("|");
			output.push({
				type: "function_call",
				id,
				call_id: callId,
				name: block.name,
				arguments: JSON.stringify(block.arguments),
			});
		}
	}

	return output;
}

function convertToolResult(
	msg: { toolCallId: string; content: Array<{ type: string; text?: string; mimeType?: string; data?: string }> },
	model: Model<"openai-codex-responses">,
): unknown[] {
	const output: unknown[] = [];
	const textResult = msg.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
	const hasImages = msg.content.some((c) => c.type === "image");

	output.push({
		type: "function_call_output",
		call_id: msg.toolCallId.split("|")[0],
		output: sanitizeSurrogates(textResult || "(see attached image)"),
	});

	if (hasImages && model.input.includes("image")) {
		const imageParts = msg.content
			.filter((c) => c.type === "image")
			.map((c) => ({
				type: "input_image",
				detail: "auto",
				image_url: `data:${c.mimeType};base64,${c.data}`,
			}));

		output.push({
			role: "user",
			content: [{ type: "input_text", text: "Attached image(s) from tool result:" }, ...imageParts],
		});
	}

	return output;
}

// ============================================================================
// Response Processing
// ============================================================================

async function processStream(
	response: Response,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"openai-codex-responses">,
	options?: OpenAICodexResponsesOptions,
): Promise<void> {
	let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
	let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
	const blockIndex = () => output.content.length - 1;
	const streamIdleTimeoutMs = options?.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
	let sawCompletion = false;

	for await (const event of parseSSE(response, { idleTimeoutMs: streamIdleTimeoutMs, signal: options?.signal })) {
		const type = event.type as string;

		switch (type) {
			case "response.output_item.added": {
				const item = event.item as ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall;
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
						id: `${item.call_id}|${item.id}`,
						name: item.name,
						arguments: {},
						partialJson: item.arguments || "",
					};
					output.content.push(currentBlock);
					stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
				}
				break;
			}

			case "response.reasoning_summary_part.added": {
				if (currentItem?.type === "reasoning") {
					currentItem.summary = currentItem.summary || [];
					currentItem.summary.push((event as { part: ResponseReasoningItem["summary"][number] }).part);
				}
				break;
			}

			case "response.reasoning_summary_text.delta": {
				if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
					const delta = (event as { delta?: string }).delta || "";
					const lastPart = currentItem.summary?.[currentItem.summary.length - 1];
					if (lastPart) {
						currentBlock.thinking += delta;
						lastPart.text += delta;
						stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta, partial: output });
					}
				}
				break;
			}

			case "response.reasoning_summary_part.done": {
				if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
					const lastPart = currentItem.summary?.[currentItem.summary.length - 1];
					if (lastPart) {
						currentBlock.thinking += "\n\n";
						lastPart.text += "\n\n";
						stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta: "\n\n", partial: output });
					}
				}
				break;
			}

			case "response.content_part.added": {
				if (currentItem?.type === "message") {
					currentItem.content = currentItem.content || [];
					const part = (event as { part?: ResponseOutputMessage["content"][number] }).part;
					if (part && (part.type === "output_text" || part.type === "refusal")) {
						currentItem.content.push(part);
					}
				}
				break;
			}

			case "response.output_text.delta": {
				if (currentItem?.type === "message" && currentBlock?.type === "text") {
					const lastPart = currentItem.content[currentItem.content.length - 1];
					if (lastPart?.type === "output_text") {
						const delta = (event as { delta?: string }).delta || "";
						currentBlock.text += delta;
						lastPart.text += delta;
						stream.push({ type: "text_delta", contentIndex: blockIndex(), delta, partial: output });
					}
				}
				break;
			}

			case "response.refusal.delta": {
				if (currentItem?.type === "message" && currentBlock?.type === "text") {
					const lastPart = currentItem.content[currentItem.content.length - 1];
					if (lastPart?.type === "refusal") {
						const delta = (event as { delta?: string }).delta || "";
						currentBlock.text += delta;
						lastPart.refusal += delta;
						stream.push({ type: "text_delta", contentIndex: blockIndex(), delta, partial: output });
					}
				}
				break;
			}

			case "response.function_call_arguments.delta": {
				if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
					const delta = (event as { delta?: string }).delta || "";
					currentBlock.partialJson += delta;
					currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
					stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta, partial: output });
				}
				break;
			}

			case "response.output_item.done": {
				const item = event.item as ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall;
				if (item.type === "reasoning" && currentBlock?.type === "thinking") {
					currentBlock.thinking = item.summary?.map((s) => s.text).join("\n\n") || "";
					currentBlock.thinkingSignature = JSON.stringify(item);
					stream.push({
						type: "thinking_end",
						contentIndex: blockIndex(),
						content: currentBlock.thinking,
						partial: output,
					});
					currentBlock = null;
				} else if (item.type === "message" && currentBlock?.type === "text") {
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
						id: `${item.call_id}|${item.id}`,
						name: item.name,
						arguments: JSON.parse(item.arguments),
					};
					stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
				}
				break;
			}

			case "response.completed":
			case "response.done": {
				const resp = (
					event as {
						response?: {
							usage?: {
								input_tokens?: number;
								output_tokens?: number;
								total_tokens?: number;
								input_tokens_details?: { cached_tokens?: number };
							};
							status?: string;
						};
					}
				).response;
				sawCompletion = true;
				if (resp?.usage) {
					const cached = resp.usage.input_tokens_details?.cached_tokens || 0;
					output.usage = {
						input: (resp.usage.input_tokens || 0) - cached,
						output: resp.usage.output_tokens || 0,
						cacheRead: cached,
						cacheWrite: 0,
						totalTokens: resp.usage.total_tokens || 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					};
					calculateCost(model, output.usage);
				}
				output.stopReason = mapStopReason(resp?.status);
				if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
					output.stopReason = "toolUse";
				}
				break;
			}

			case "error": {
				const code = (event as { code?: string }).code || "";
				const message = (event as { message?: string }).message || "";
				const errorMessage = message || code || JSON.stringify(event);
				const retryAfterMs = parseRetryAfterFromMessage(errorMessage);
				const errorDetails = buildCodexErrorDetails({ code, message: errorMessage, retryAfterMs });
				throw new CodexError(`Codex error: ${errorMessage}`, errorDetails);
			}

			case "response.failed": {
				const error = (
					event as {
						response?: {
							error?: {
								code?: string;
								type?: string;
								message?: string;
								status?: number;
								resets_at?: number;
							};
						};
					}
				).response?.error;
				const code = error?.code || error?.type || "";
				const message = error?.message;
				const retryAfterMs = parseRetryAfterFromMessage(message) ?? parseRetryAfterFromResetAt(error?.resets_at);
				const errorDetails = buildCodexErrorDetails({
					code,
					status: error?.status,
					message,
					retryAfterMs,
				});
				const errorMessage = message || (code ? `Codex response failed (${code})` : "Codex response failed");
				throw new CodexError(errorMessage, errorDetails);
			}
		}
	}

	if (!sawCompletion) {
		throw new CodexError("Codex stream disconnected before completion", {
			retryable: true,
			kind: "stream_disconnect",
		});
	}
}

function mapStopReason(status?: string): StopReason {
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

// ============================================================================
// SSE Parsing
// ============================================================================

async function* parseSSE(
	response: Response,
	options?: { idleTimeoutMs?: number; signal?: AbortSignal },
): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const idleTimeoutMs = options?.idleTimeoutMs;

	while (true) {
		if (options?.signal?.aborted) {
			throw new Error("Request was aborted");
		}
		const { done, value } = await readWithTimeout(reader, idleTimeoutMs, options?.signal);
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let idx = buffer.indexOf("\n\n");
		while (idx !== -1) {
			const chunk = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);

			const dataLines = chunk
				.split("\n")
				.filter((l) => l.startsWith("data:"))
				.map((l) => l.slice(5).trim());
			if (dataLines.length > 0) {
				const data = dataLines.join("\n").trim();
				if (data && data !== "[DONE]") {
					try {
						yield JSON.parse(data);
					} catch {}
				}
			}
			idx = buffer.indexOf("\n\n");
		}
	}
}

async function readWithTimeout(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	idleTimeoutMs: number | undefined,
	signal?: AbortSignal,
): Promise<StreamReadResult> {
	if (signal?.aborted) {
		throw new Error("Request was aborted");
	}

	if (!idleTimeoutMs || idleTimeoutMs <= 0) {
		return reader.read();
	}

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<StreamReadResult>((_, reject) => {
		timeoutId = setTimeout(() => {
			reader.cancel().catch(() => {});
			reject(
				new CodexError("Codex stream idle timeout", {
					retryable: true,
					kind: "stream_idle_timeout",
				}),
			);
		}, idleTimeoutMs);
	});

	const readPromise = reader.read().catch((error) => {
		if (signal?.aborted || isAbortError(error)) {
			throw error;
		}
		throw new CodexError("Codex stream disconnected", {
			retryable: true,
			kind: "stream_disconnect",
		});
	});

	try {
		return (await Promise.race([readPromise, timeoutPromise])) as StreamReadResult;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

// ============================================================================
// Error Handling
// ============================================================================

function buildCodexErrorDetails({
	code,
	status,
	message,
	retryAfterMs,
}: {
	code?: string;
	status?: number;
	message?: string;
	retryAfterMs?: number;
}): CodexErrorDetails | undefined {
	const normalizedCode = code?.toLowerCase() ?? "";
	if (normalizedCode === "context_length_exceeded") {
		return { retryable: false, kind: "context_length_exceeded" };
	}
	if (normalizedCode === "insufficient_quota") {
		return { retryable: false, kind: "insufficient_quota" };
	}
	if (normalizedCode.includes("usage_limit_reached")) {
		return { retryable: false, kind: "usage_limit_reached" };
	}
	if (normalizedCode === "usage_not_included") {
		return { retryable: false, kind: "usage_not_included" };
	}
	if (normalizedCode && /invalid_request|invalid_params/.test(normalizedCode)) {
		return { retryable: false, kind: "invalid_request" };
	}

	const isRateLimit =
		normalizedCode.includes("rate_limit") ||
		status === 429 ||
		(message ? /rate.?limit|too many requests/i.test(message) : false);

	if (isRateLimit) {
		return { retryable: true, kind: "rate_limit", retryAfterMs };
	}

	if (status && status >= 500 && status <= 599) {
		return { retryable: true, kind: "server_error" };
	}

	return undefined;
}

function parseRetryAfterFromMessage(message?: string): number | undefined {
	if (!message) return undefined;
	const match = message.match(/try again in\s*(\d+(?:\.\d+)?)\s*(s|ms|seconds?)/i);
	if (!match) return undefined;
	const value = Number.parseFloat(match[1]);
	if (Number.isNaN(value)) return undefined;
	const unit = match[2].toLowerCase();
	if (unit === "ms") return Math.round(value);
	return Math.round(value * 1000);
}

function parseRetryAfterFromResetAt(resetsAt?: number): number | undefined {
	if (typeof resetsAt !== "number") return undefined;
	return Math.max(0, resetsAt * 1000 - Date.now());
}

function parseRetryAfterHeader(value?: string | null): number | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	const seconds = Number.parseInt(trimmed, 10);
	if (!Number.isNaN(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const dateMs = Date.parse(trimmed);
	if (!Number.isNaN(dateMs)) {
		return Math.max(0, dateMs - Date.now());
	}
	return undefined;
}

function isRetryableStatus(status: number): boolean {
	return status >= 500 && status <= 599;
}

function getRetryDelayMs(baseDelayMs: number, attempt: number, retryAfterMs?: number): number {
	const backoffMs = baseDelayMs * 2 ** attempt;
	const jitterFactor = 0.9 + Math.random() * 0.2;
	const candidateDelay = Math.round(backoffMs * jitterFactor);
	if (retryAfterMs !== undefined) {
		return Math.max(retryAfterMs, candidateDelay);
	}
	return candidateDelay;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

async function sleepWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (delayMs <= 0) return;
	if (signal?.aborted) {
		throw new Error("Request was aborted");
	}
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(resolve, delayMs);
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout);
			reject(new Error("Request was aborted"));
		});
	});
}

async function fetchWithRetry(
	url: string,
	init: RequestInit,
	options: { maxRetries: number; baseDelayMs: number; signal?: AbortSignal },
): Promise<Response> {
	const maxRetries = Math.max(0, options.maxRetries);
	const baseDelayMs = options.baseDelayMs;
	let attempt = 0;

	while (true) {
		if (options.signal?.aborted) {
			throw new Error("Request was aborted");
		}

		try {
			const response = await fetch(url, { ...init, signal: options.signal });
			if (!response.ok && isRetryableStatus(response.status) && attempt < maxRetries) {
				const retryAfterMs = parseRetryAfterHeader(response.headers.get("retry-after"));
				const delayMs = getRetryDelayMs(baseDelayMs, attempt, retryAfterMs);
				await sleepWithSignal(delayMs, options.signal);
				attempt++;
				continue;
			}
			return response;
		} catch (error) {
			if (options.signal?.aborted || isAbortError(error)) {
				throw error;
			}
			if (attempt < maxRetries) {
				const delayMs = getRetryDelayMs(baseDelayMs, attempt);
				await sleepWithSignal(delayMs, options.signal);
				attempt++;
				continue;
			}
			throw new CodexError(error instanceof Error ? error.message : String(error), {
				retryable: true,
				kind: "transport",
			});
		}
	}
}

async function parseErrorResponse(
	response: Response,
): Promise<{ message: string; friendlyMessage?: string; errorDetails?: CodexErrorDetails }> {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;
	let code: string | undefined;
	let retryAfterMs = parseRetryAfterHeader(response.headers.get("retry-after"));

	try {
		const parsed = JSON.parse(raw) as {
			error?: { code?: string; type?: string; message?: string; plan_type?: string; resets_at?: number };
		};
		const err = parsed?.error;
		if (err) {
			code = err.code || err.type;
			if (err.resets_at !== undefined) {
				retryAfterMs = parseRetryAfterFromResetAt(err.resets_at) ?? retryAfterMs;
			}
			if (
				(code && /usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code)) ||
				response.status === 429
			) {
				const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
				const mins = err.resets_at
					? Math.max(0, Math.round((err.resets_at * 1000 - Date.now()) / 60000))
					: undefined;
				const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
			}
			message = err.message || friendlyMessage || message;
		}
	} catch {}

	if (retryAfterMs === undefined) {
		retryAfterMs = parseRetryAfterFromMessage(message);
	}

	const errorDetails = buildCodexErrorDetails({
		code,
		status: response.status,
		message,
		retryAfterMs,
	});

	return { message, friendlyMessage, errorDetails };
}

// ============================================================================
// Auth & Headers
// ============================================================================

function extractAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
		const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
		if (!accountId) throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}

function buildHeaders(
	initHeaders: Record<string, string> | undefined,
	accountId: string,
	token: string,
	sessionId?: string,
): Headers {
	const headers = new Headers(initHeaders);
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("originator", "pi");
	headers.set("User-Agent", `pi (${os.platform()} ${os.release()}; ${os.arch()})`);
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");

	if (sessionId) {
		headers.set("conversation_id", sessionId);
		headers.set("session_id", sessionId);
	}

	return headers;
}
