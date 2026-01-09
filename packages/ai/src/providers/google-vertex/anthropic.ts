import { calculateCost } from "../../models.js";
import type { Api, AssistantMessage, Context, Model, TextContent, ThinkingContent, ToolCall } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import {
	type AnthropicMessageParam,
	type AnthropicToolDefinition,
	convertAnthropicMessages,
	convertAnthropicTools,
	mapAnthropicStopReason,
} from "../anthropic-shared.js";
import { createVertexToolCallId, getVertexAccessToken, resolveLocation, resolveProject } from "./shared.js";
import type { GoogleVertexOptions } from "./types.js";

// Vertex Anthropic API version used by streamRawPredict.
const VERTEX_ANTHROPIC_VERSION = "vertex-2023-10-16";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

type VertexClaudeContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "thinking"; thinking: string; signature?: string };

type VertexClaudeUsage = {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
};

type VertexClaudeResponse = {
	content?: VertexClaudeContentBlock[] | string;
	stop_reason?: string | null;
	usage?: VertexClaudeUsage;
};

type VertexClaudeParams = {
	anthropic_version: string;
	messages: AnthropicMessageParam[];
	max_tokens: number;
	stream: boolean;
	system?: string;
	temperature?: number;
	tools?: AnthropicToolDefinition[];
	tool_choice?: { type: "auto" | "any" | "none" };
	thinking?: { type: "enabled"; budget_tokens: number };
};

type VertexClaudeStreamEvent = {
	type?: string;
	message?: {
		usage?: VertexClaudeUsage;
	};
	content_block?: {
		type?: "text" | "thinking" | "tool_use";
		text?: string;
		thinking?: string;
		signature?: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	};
	delta?: {
		type?: string;
		text?: string;
		thinking?: string;
		partial_json?: string;
		signature?: string;
		stop_reason?: string | null;
	};
	usage?: VertexClaudeUsage;
	index?: number;
	error?: {
		message?: string;
		type?: string;
		code?: number;
		status?: number;
	};
};

function isRetryableStatus(status: number): boolean {
	return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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

export function isVertexAnthropicModel(model: Model<"google-vertex">): boolean {
	return model.vertex?.publisher === "anthropic";
}

export async function streamVertexAnthropic(
	model: Model<"google-vertex">,
	context: Context,
	options: GoogleVertexOptions | undefined,
	stream: AssistantMessageEventStream,
): Promise<void> {
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "google-vertex" as Api,
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
		const project = resolveProject(options);
		const location = resolveLocation(options);
		const accessToken = await getVertexAccessToken();
		const endpoint = buildClaudeVertexEndpoint(project, location, model.vertex?.modelId || model.id);
		const params = buildClaudeVertexParams(model, context, options);

		let response: Response | undefined;
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			try {
				response = await fetch(endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${accessToken}`,
						"Content-Type": "application/json",
						Accept: "text/event-stream",
					},
					body: JSON.stringify(params),
					signal: options?.signal,
				});

				if (response.ok) {
					break;
				}

				const errorText = await response.text();
				const statusLabel = response.statusText
					? `${response.status} ${response.statusText}`
					: `${response.status}`;
				const message = errorText
					? `Vertex Claude request failed (${statusLabel}): ${errorText}`
					: `Vertex Claude request failed (${statusLabel})`;

				if (attempt < MAX_RETRIES && isRetryableStatus(response.status)) {
					const delayMs = BASE_DELAY_MS * 2 ** attempt;
					await sleep(delayMs, options?.signal);
					continue;
				}

				throw new Error(message);
			} catch (error) {
				if (error instanceof Error) {
					if (error.name === "AbortError" || error.message === "Request was aborted") {
						throw new Error("Request was aborted");
					}
				}
				lastError = error instanceof Error ? error : new Error(String(error));
				if (attempt < MAX_RETRIES) {
					const delayMs = BASE_DELAY_MS * 2 ** attempt;
					await sleep(delayMs, options?.signal);
					continue;
				}
				throw lastError;
			}
		}

		if (!response || !response.ok) {
			throw lastError ?? new Error("Failed to get response after retries");
		}

		stream.push({ type: "start", partial: output });

		const contentType = response.headers.get("content-type") || "";
		if (contentType.includes("text/event-stream")) {
			await streamClaudeSse(response, model, output, stream);
		} else {
			const payload = (await response.json()) as unknown;
			const message = extractClaudeResponse(payload);
			emitClaudeContentBlocks(output, stream, normalizeClaudeContent(message.content));
			output.usage = mapClaudeUsage(message.usage);
			calculateCost(model, output.usage);
			output.stopReason = mapAnthropicStopReason(message.stop_reason);
		}

		if (options?.signal?.aborted) {
			throw new Error("Request was aborted");
		}

		if (output.stopReason === "aborted") {
			throw new Error("Request was aborted");
		}
		if (output.stopReason === "error") {
			throw new Error("Model refused to respond");
		}

		const finalStopReason = output.content.some((b) => b.type === "toolCall") ? "toolUse" : output.stopReason;
		output.stopReason = finalStopReason;
		stream.push({ type: "done", reason: finalStopReason, message: output });
		stream.end();
	} catch (error) {
		for (const block of output.content) {
			if ("index" in block) {
				delete (block as { index?: number }).index;
			}
			if ("partialJson" in block) {
				delete (block as { partialJson?: string }).partialJson;
			}
		}
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
		stream.push({ type: "error", reason: output.stopReason, error: output });
		stream.end();
	}
}

async function streamClaudeSse(
	response: Response,
	model: Model<"google-vertex">,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): Promise<void> {
	if (!response.body) {
		throw new Error("No response body");
	}

	type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
	const blocks = output.content as Block[];

	const handleEvent = (event: VertexClaudeStreamEvent) => {
		if (!event || typeof event !== "object") return;

		if (event.type === "error") {
			const errorDetails = event.error;
			const message = errorDetails?.message || "Vertex Claude stream error";
			const extra = [
				errorDetails?.type ? `type=${errorDetails.type}` : null,
				typeof errorDetails?.code === "number" ? `code=${errorDetails.code}` : null,
				typeof errorDetails?.status === "number" ? `status=${errorDetails.status}` : null,
			].filter((value): value is string => Boolean(value));
			throw new Error(extra.length > 0 ? `${message} (${extra.join(" ")})` : message);
		}

		if (event.type === "message_start") {
			if (event.message?.usage) {
				output.usage = mapClaudeUsage(event.message.usage);
				calculateCost(model, output.usage);
			}
			return;
		}

		if (event.type === "content_block_start") {
			const blockType = event.content_block?.type;
			const blockIndex = event.index ?? output.content.length;
			if (blockType === "text") {
				const block: Block = { type: "text", text: "", index: blockIndex };
				output.content.push(block);
				stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
			} else if (blockType === "thinking") {
				const block: Block = {
					type: "thinking",
					thinking: "",
					thinkingSignature: "",
					index: blockIndex,
				};
				output.content.push(block);
				stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
			} else if (blockType === "tool_use") {
				const block: Block = {
					type: "toolCall",
					id: event.content_block?.id || createVertexToolCallId(event.content_block?.name || "tool"),
					name: event.content_block?.name || "",
					arguments: event.content_block?.input || {},
					partialJson: "",
					index: blockIndex,
				};
				output.content.push(block);
				stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
			}
			return;
		}

		if (event.type === "content_block_delta") {
			const index = blocks.findIndex((b) => b.index === event.index);
			const block = blocks[index];
			if (!block) return;

			if (event.delta?.type === "text_delta" && block.type === "text") {
				const deltaText = event.delta.text || "";
				block.text += deltaText;
				stream.push({ type: "text_delta", contentIndex: index, delta: deltaText, partial: output });
			} else if (event.delta?.type === "thinking_delta" && block.type === "thinking") {
				const deltaText = event.delta.thinking || "";
				block.thinking += deltaText;
				stream.push({ type: "thinking_delta", contentIndex: index, delta: deltaText, partial: output });
			} else if (event.delta?.type === "input_json_delta" && block.type === "toolCall") {
				const partial = event.delta.partial_json || "";
				block.partialJson += partial;
				block.arguments = parseStreamingJson(block.partialJson);
				stream.push({ type: "toolcall_delta", contentIndex: index, delta: partial, partial: output });
			} else if (event.delta?.type === "signature_delta" && block.type === "thinking") {
				block.thinkingSignature = block.thinkingSignature || "";
				block.thinkingSignature += event.delta.signature || "";
			}
			return;
		}

		if (event.type === "content_block_stop") {
			const index = blocks.findIndex((b) => b.index === event.index);
			const block = blocks[index];
			if (!block) return;
			delete (block as { index?: number }).index;
			if (block.type === "text") {
				stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
			} else if (block.type === "thinking") {
				stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
			} else if (block.type === "toolCall") {
				block.arguments = parseStreamingJson(block.partialJson);
				delete (block as { partialJson?: string }).partialJson;
				stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
			}
			return;
		}

		if (event.type === "message_delta") {
			if (event.delta?.stop_reason) {
				output.stopReason = mapAnthropicStopReason(event.delta.stop_reason);
			}
			if (event.usage) {
				output.usage = mapClaudeUsage(event.usage);
				calculateCost(model, output.usage);
			}
		}
	};

	await readVertexSseEvents(response.body, handleEvent);

	for (const block of blocks) {
		if (!("index" in block)) continue;
		const contentIndex = output.content.indexOf(block);
		if (contentIndex === -1) continue;
		delete (block as { index?: number }).index;
		if (block.type === "text") {
			stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
		} else if (block.type === "thinking") {
			stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
		} else if (block.type === "toolCall") {
			block.arguments = parseStreamingJson(block.partialJson);
			delete (block as { partialJson?: string }).partialJson;
			stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
		}
	}
}

async function readVertexSseEvents(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: VertexClaudeStreamEvent) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		buffer = buffer.replace(/\r\n/g, "\n");

		let separatorIndex = buffer.indexOf("\n\n");
		while (separatorIndex !== -1) {
			const rawEvent = buffer.slice(0, separatorIndex);
			buffer = buffer.slice(separatorIndex + 2);
			separatorIndex = buffer.indexOf("\n\n");

			const data = rawEvent
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.join("\n");
			if (!data || data === "[DONE]") continue;

			let event: VertexClaudeStreamEvent;
			try {
				event = JSON.parse(data) as VertexClaudeStreamEvent;
			} catch {
				continue;
			}

			onEvent(event);
		}
	}

	const trimmed = buffer.trim();
	if (!trimmed) return;

	const data = trimmed
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.join("\n");
	if (!data || data === "[DONE]") return;

	try {
		onEvent(JSON.parse(data) as VertexClaudeStreamEvent);
	} catch {
		return;
	}
}

function emitClaudeContentBlocks(
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	contentBlocks: VertexClaudeContentBlock[],
): void {
	for (const block of contentBlocks) {
		if (block.type === "text") {
			const textBlock: TextContent = { type: "text", text: block.text };
			output.content.push(textBlock);
			const index = output.content.length - 1;
			stream.push({ type: "text_start", contentIndex: index, partial: output });
			if (textBlock.text.length > 0) {
				stream.push({ type: "text_delta", contentIndex: index, delta: textBlock.text, partial: output });
			}
			stream.push({ type: "text_end", contentIndex: index, content: textBlock.text, partial: output });
		} else if (block.type === "thinking") {
			const thinkingBlock: ThinkingContent = {
				type: "thinking",
				thinking: block.thinking,
				thinkingSignature: block.signature,
			};
			output.content.push(thinkingBlock);
			const index = output.content.length - 1;
			stream.push({ type: "thinking_start", contentIndex: index, partial: output });
			if (thinkingBlock.thinking.length > 0) {
				stream.push({
					type: "thinking_delta",
					contentIndex: index,
					delta: thinkingBlock.thinking,
					partial: output,
				});
			}
			stream.push({
				type: "thinking_end",
				contentIndex: index,
				content: thinkingBlock.thinking,
				partial: output,
			});
		} else if (block.type === "tool_use") {
			const toolCall: ToolCall = {
				type: "toolCall",
				id: block.id,
				name: block.name,
				arguments: block.input as Record<string, any>,
			};
			output.content.push(toolCall);
			const index = output.content.length - 1;
			stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
			stream.push({
				type: "toolcall_delta",
				contentIndex: index,
				delta: JSON.stringify(toolCall.arguments),
				partial: output,
			});
			stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
		}
	}
}

function normalizeClaudeContent(content: VertexClaudeResponse["content"]): VertexClaudeContentBlock[] {
	if (!content) return [];
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	return content;
}

function mapClaudeUsage(usage?: VertexClaudeUsage): AssistantMessage["usage"] {
	const input = usage?.input_tokens || 0;
	const output = usage?.output_tokens || 0;
	const cacheRead = usage?.cache_read_input_tokens || 0;
	const cacheWrite = usage?.cache_creation_input_tokens || 0;
	const totalTokens = input + output + cacheRead + cacheWrite;

	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function buildClaudeVertexEndpoint(project: string, location: string, modelId: string): string {
	const normalizedModelId = normalizeClaudeModelId(modelId);
	return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${normalizedModelId}:streamRawPredict`;
}

function extractClaudeResponse(payload: unknown): VertexClaudeResponse {
	if (payload && typeof payload === "object") {
		if ("content" in payload) {
			return payload as VertexClaudeResponse;
		}
		const predictions = (payload as { predictions?: unknown }).predictions;
		if (Array.isArray(predictions) && predictions.length > 0) {
			const first = predictions[0];
			if (first && typeof first === "object" && "content" in first) {
				return first as VertexClaudeResponse;
			}
		}
	}
	throw new Error("Unexpected Vertex Claude response format");
}

function normalizeClaudeModelId(modelId: string): string {
	const prefix = "publishers/anthropic/models/";
	return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function buildClaudeVertexParams(
	model: Model<"google-vertex">,
	context: Context,
	options?: GoogleVertexOptions,
): VertexClaudeParams {
	const params: VertexClaudeParams = {
		anthropic_version: VERTEX_ANTHROPIC_VERSION,
		messages: convertAnthropicMessages(context.messages, model, { addCacheControl: false }),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		stream: true,
	};

	if (context.systemPrompt) {
		params.system = sanitizeSurrogates(context.systemPrompt);
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools && context.tools.length > 0) {
		params.tools = convertAnthropicTools(context.tools, { addCacheControl: false });
	}

	if (context.tools && context.tools.length > 0 && options?.toolChoice) {
		params.tool_choice = { type: options.toolChoice };
	}

	if (options?.thinking?.enabled && model.reasoning) {
		const rawBudget = options.thinking.budgetTokens;
		const budgetTokens = rawBudget && rawBudget >= 1024 ? rawBudget : 1024;
		params.thinking = {
			type: "enabled",
			budget_tokens: budgetTokens,
		};
	}

	return params;
}
