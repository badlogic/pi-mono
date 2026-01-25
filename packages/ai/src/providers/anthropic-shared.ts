/**
 * Shared utilities for Anthropic API providers (direct API and Vertex AI).
 */

import type { ImageContent, StopReason, TextContent } from "../types.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";

/**
 * Convert content blocks to Anthropic API format.
 * Used for tool result content that can contain text and images.
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
	// If only text blocks, return as concatenated string for simplicity
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	// If we have images, convert to content block array
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

	// If only images (no text), add placeholder text block
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
 * Merge multiple header objects, later sources override earlier ones.
 */
export function mergeHeaders(...headerSources: (Record<string, string> | undefined)[]): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}
	return merged;
}

/**
 * Normalize tool call IDs to match Anthropic's required pattern and length.
 * Anthropic requires IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
 */
export function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Map Anthropic stop reasons to unified StopReason type.
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
		default:
			// Log unexpected stop reasons for debugging but don't crash
			console.warn(`Unknown Anthropic stop reason: ${reason}`);
			return "stop";
	}
}
