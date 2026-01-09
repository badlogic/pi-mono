import { calculateCost } from "../../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { transformMessages } from "../transorm-messages.js";
import { getVertexAccessToken, resolveLocation, resolveProject } from "./shared.js";
import type { GoogleVertexOptions } from "./types.js";

const VERTEX_ANTHROPIC_VERSION = "vertex-2023-10-16";

// Counter for generating unique tool call IDs
let toolCallCounter = 0;

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

type ClaudeTextBlockParam = { type: "text"; text: string };

type ClaudeImageBlockParam = {
	type: "image";
	source: {
		type: "base64";
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
		data: string;
	};
};

type ClaudeThinkingBlockParam = { type: "thinking"; thinking: string; signature?: string };

type ClaudeToolUseBlockParam = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type ClaudeToolResultBlockParam = {
	type: "tool_result";
	tool_use_id: string;
	content: string | ClaudeContentBlockParam[];
	is_error?: boolean;
};

type ClaudeContentBlockParam =
	| ClaudeTextBlockParam
	| ClaudeImageBlockParam
	| ClaudeThinkingBlockParam
	| ClaudeToolUseBlockParam
	| ClaudeToolResultBlockParam;

type ClaudeMessageParam = { role: "user" | "assistant"; content: string | ClaudeContentBlockParam[] };

type VertexClaudeTool = {
	name: string;
	description?: string;
	input_schema: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
};

type VertexClaudeParams = {
	anthropic_version: string;
	messages: ClaudeMessageParam[];
	max_tokens: number;
	stream: boolean;
	system?: string;
	temperature?: number;
	tools?: VertexClaudeTool[];
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
	error?: { message?: string };
};

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

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
			},
			body: JSON.stringify(params),
			signal: options?.signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(errorText || "Vertex Claude request failed");
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
			output.stopReason = mapClaudeStopReason(message.stop_reason);
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
			const message = event.error?.message || "Vertex Claude stream error";
			throw new Error(message);
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
					id: event.content_block?.id || `tool_${Date.now()}_${++toolCallCounter}`,
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
				output.stopReason = mapClaudeStopReason(event.delta.stop_reason);
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

function mapClaudeStopReason(
	reason: string | null | undefined,
): Extract<StopReason, "stop" | "length" | "toolUse" | "error"> {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "error";
		case "pause_turn":
			return "stop";
		case "stop_sequence":
			return "stop";
		default:
			return "stop";
	}
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
		messages: convertClaudeMessages(context.messages, model),
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
		params.tools = convertClaudeTools(context.tools);
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

function convertClaudeContentBlocks(content: (TextContent | ImageContent)[]): string | ClaudeContentBlockParam[] {
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	const blocks: ClaudeContentBlockParam[] = content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: sanitizeSurrogates(block.text) };
		}
		return {
			type: "image",
			source: {
				type: "base64",
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({ type: "text", text: "(see attached image)" });
	}

	return blocks;
}

function convertClaudeMessages(messages: Message[], model: Model<"google-vertex">): ClaudeMessageParam[] {
	const params: ClaudeMessageParam[] = [];
	const transformedMessages = transformMessages(messages, model);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
				}
			} else {
				const blocks: ClaudeContentBlockParam[] = msg.content.map((item) => {
					if (item.type === "text") {
						return { type: "text", text: sanitizeSurrogates(item.text) };
					}
					return {
						type: "image",
						source: {
							type: "base64",
							media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
							data: item.data,
						},
					};
				});
				let filteredBlocks = !model?.input.includes("image") ? blocks.filter((b) => b.type !== "image") : blocks;
				filteredBlocks = filteredBlocks.filter((b) => {
					if (b.type === "text") {
						return b.text.trim().length > 0;
					}
					return true;
				});
				if (filteredBlocks.length === 0) continue;
				params.push({ role: "user", content: filteredBlocks });
			}
		} else if (msg.role === "assistant") {
			const blocks: ClaudeContentBlockParam[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push({ type: "text", text: sanitizeSurrogates(block.thinking) });
					} else {
						blocks.push({
							type: "thinking",
							thinking: sanitizeSurrogates(block.thinking),
							signature: block.thinkingSignature,
						});
					}
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: sanitizeToolCallId(block.id),
						name: block.name,
						input: block.arguments,
					});
				}
			}

			if (blocks.length === 0) continue;
			params.push({ role: "assistant", content: blocks });
		} else if (msg.role === "toolResult") {
			const toolResults: ClaudeContentBlockParam[] = [];

			toolResults.push({
				type: "tool_result",
				tool_use_id: sanitizeToolCallId(msg.toolCallId),
				content: convertClaudeContentBlocks(msg.content),
				is_error: msg.isError,
			});

			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage;
				toolResults.push({
					type: "tool_result",
					tool_use_id: sanitizeToolCallId(nextMsg.toolCallId),
					content: convertClaudeContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}

			i = j - 1;
			params.push({ role: "user", content: toolResults });
		}
	}

	return params;
}

function convertClaudeTools(tools: Tool[]): VertexClaudeTool[] {
	if (!tools) return [];

	return tools.map((tool) => {
		const jsonSchema = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

function sanitizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
