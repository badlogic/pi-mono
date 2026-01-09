import type { ImageContent, Message, Model, StopReason, TextContent, Tool, ToolResultMessage } from "../types.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { transformMessages } from "./transorm-messages.js";

export type AnthropicCacheControl = { type: "ephemeral" };

export type AnthropicTextBlockParam = { type: "text"; text: string; cache_control?: AnthropicCacheControl };

export type AnthropicImageBlockParam = {
	type: "image";
	source: {
		type: "base64";
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
		data: string;
	};
	cache_control?: AnthropicCacheControl;
};

export type AnthropicThinkingBlockParam = { type: "thinking"; thinking: string; signature: string };

export type AnthropicToolUseBlockParam = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type AnthropicToolResultBlockParam = {
	type: "tool_result";
	tool_use_id: string;
	content: string | AnthropicContentBlockParam[];
	is_error?: boolean;
	cache_control?: AnthropicCacheControl;
};

export type AnthropicContentBlockParam =
	| AnthropicTextBlockParam
	| AnthropicImageBlockParam
	| AnthropicThinkingBlockParam
	| AnthropicToolUseBlockParam
	| AnthropicToolResultBlockParam;

export type AnthropicMessageParam = { role: "user" | "assistant"; content: string | AnthropicContentBlockParam[] };

export type AnthropicToolDefinition = {
	name: string;
	description?: string;
	input_schema: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
};

type ConvertOptions = {
	toolNamePrefix?: string;
	addCacheControl?: boolean;
};

export function sanitizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function applyToolPrefix(name: string, prefix?: string): string {
	return prefix ? `${prefix}${name}` : name;
}

export function convertAnthropicContentBlocks(
	content: (TextContent | ImageContent)[],
): string | AnthropicContentBlockParam[] {
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	const blocks: AnthropicContentBlockParam[] = content.map((block) => {
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

export function convertAnthropicMessages(
	messages: Message[],
	model: Model<"anthropic-messages" | "google-vertex">,
	options: ConvertOptions = {},
): AnthropicMessageParam[] {
	const params: AnthropicMessageParam[] = [];
	const transformedMessages = transformMessages(messages, model);
	const toolNamePrefix = options.toolNamePrefix;

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
				}
			} else {
				const blocks: AnthropicContentBlockParam[] = msg.content.map((item) => {
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
			const blocks: AnthropicContentBlockParam[] = [];

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
						name: applyToolPrefix(block.name, toolNamePrefix),
						input: block.arguments,
					});
				}
			}

			if (blocks.length === 0) continue;
			params.push({ role: "assistant", content: blocks });
		} else if (msg.role === "toolResult") {
			const toolResults: AnthropicContentBlockParam[] = [];

			toolResults.push({
				type: "tool_result",
				tool_use_id: sanitizeToolCallId(msg.toolCallId),
				content: convertAnthropicContentBlocks(msg.content),
				is_error: msg.isError,
			});

			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage;
				toolResults.push({
					type: "tool_result",
					tool_use_id: sanitizeToolCallId(nextMsg.toolCallId),
					content: convertAnthropicContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}

			i = j - 1;
			params.push({ role: "user", content: toolResults });
		}
	}

	if (options.addCacheControl ?? true) {
		const lastMessage = params[params.length - 1];
		if (lastMessage?.role === "user" && Array.isArray(lastMessage.content)) {
			const lastBlock = lastMessage.content[lastMessage.content.length - 1];
			if (
				lastBlock &&
				(lastBlock.type === "text" || lastBlock.type === "image" || lastBlock.type === "tool_result")
			) {
				lastBlock.cache_control = { type: "ephemeral" };
			}
		}
	}

	return params;
}

export function convertAnthropicTools(tools: Tool[], options: ConvertOptions = {}): AnthropicToolDefinition[] {
	if (!tools) return [];

	const toolNamePrefix = options.toolNamePrefix;

	return tools.map((tool) => {
		const jsonSchema = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
		return {
			name: applyToolPrefix(tool.name, toolNamePrefix),
			description: tool.description,
			input_schema: {
				type: "object",
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

export function mapAnthropicStopReason(reason: string | null | undefined): StopReason {
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
