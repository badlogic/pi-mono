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
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

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
	[key: string]: unknown;
}

// ============================================================================
// Retry Helpers
// ============================================================================

function isRetryableError(status: number, errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
		return true;
	}
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout);
			reject(new Error("Request was aborted"));
		});
	});
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
			const bodyJson = JSON.stringify(body);

			// Fetch with retry logic for rate limits and transient errors
			let response: Response | undefined;
			let lastError: Error | undefined;

			for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				if (options?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				try {
					response = await fetch(CODEX_URL, {
						method: "POST",
						headers,
						body: bodyJson,
						signal: options?.signal,
					});

					if (response.ok) {
						break;
					}

					const errorText = await response.text();
					if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
						const delayMs = BASE_DELAY_MS * 2 ** attempt;
						await sleep(delayMs, options?.signal);
						continue;
					}

					// Parse error for friendly message on final attempt or non-retryable error
					const fakeResponse = new Response(errorText, {
						status: response.status,
						statusText: response.statusText,
					});
					const info = await parseErrorResponse(fakeResponse);
					throw new Error(info.friendlyMessage || info.message);
				} catch (error) {
					if (error instanceof Error) {
						if (error.name === "AbortError" || error.message === "Request was aborted") {
							throw new Error("Request was aborted");
						}
					}
					lastError = error instanceof Error ? error : new Error(String(error));
					// Network errors are retryable
					if (attempt < MAX_RETRIES && !lastError.message.includes("usage limit")) {
						const delayMs = BASE_DELAY_MS * 2 ** attempt;
						await sleep(delayMs, options?.signal);
						continue;
					}
					throw lastError;
				}
			}

			if (!response?.ok) {
				throw lastError ?? new Error("Failed after retries");
			}

			if (!response.body) {
				throw new Error("No response body");
			}

			stream.push({ type: "start", partial: output });
			await processStream(response, output, stream, model);

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
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
	if (id.startsWith("gpt-5.2") && effort === "minimal") return "low";
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
): Promise<void> {
	let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
	let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
	const blockIndex = () => output.content.length - 1;

	for await (const event of parseSSE(response)) {
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
				throw new Error(`Codex error: ${message || code || JSON.stringify(event)}`);
			}

			case "response.failed": {
				const msg = (event as { response?: { error?: { message?: string } } }).response?.error?.message;
				throw new Error(msg || "Codex response failed");
			}
		}
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

async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
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

// ============================================================================
// Error Handling
// ============================================================================

async function parseErrorResponse(response: Response): Promise<{ message: string; friendlyMessage?: string }> {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;

	try {
		const parsed = JSON.parse(raw) as {
			error?: { code?: string; type?: string; message?: string; plan_type?: string; resets_at?: number };
		};
		const err = parsed?.error;
		if (err) {
			const code = err.code || err.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
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

	return { message, friendlyMessage };
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
		headers.set("session_id", sessionId);
	}

	return headers;
}
