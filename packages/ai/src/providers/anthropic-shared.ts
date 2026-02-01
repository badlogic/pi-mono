/**
 * Shared utilities for Anthropic API providers (direct API and Vertex AI).
 */

import type { ImageContent, StopReason, TextContent, Tool } from "../types.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";

/**
 * Map Anthropic stop reasons to Pi's StopReason type.
 */
export function mapStopReason(reason: string): StopReason {
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
		case "sensitive":
			return "error";
		default:
			throw new Error(`Unhandled stop reason: ${reason}`);
	}
}

/**
 * Convert content blocks to Anthropic API format.
 */
export function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	const blocks = content.map((block) => {
		if (block.type === "text") {
			return {
				type: "text" as const,
				text: sanitizeSurrogates(block.text),
			};
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

/**
 * Convert Pi tools to Anthropic tool format.
 */
export function convertTools(tools: Tool[]): Array<{
	name: string;
	description: string;
	input_schema: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
}> {
	if (!tools) return [];

	return tools.map((tool) => {
		const jsonSchema = tool.parameters as any;
		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object" as const,
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

/**
 * Normalize tool call IDs to match Anthropic's required pattern and length.
 */
export function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
