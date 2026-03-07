/**
 * Request size management for LLM API calls.
 *
 * Providers have HTTP request body size limits (e.g., Anthropic ~25MB)
 * that are separate from token-based context window limits. When sessions
 * accumulate many images, the base64 data can exceed these limits even
 * though token usage is low (images are cheap in tokens but large in bytes).
 *
 * This module provides utilities to strip old images from outbound messages
 * to bring the request size under the provider's limit.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";

const IMAGE_PLACEHOLDER = "[image omitted from request — payload too large]";

/**
 * Check if a message has array content that could contain image blocks.
 * Handles user, toolResult, and custom message roles.
 */
function hasArrayContent(msg: AgentMessage): msg is AgentMessage & { content: (TextContent | ImageContent)[] } {
	if (msg.role === "user" || msg.role === "toolResult" || msg.role === "custom") {
		return Array.isArray(msg.content);
	}
	return false;
}

/**
 * Count the total number of image content blocks across all messages.
 * Checks user, toolResult, and custom messages (all roles that can carry images).
 */
export function countImages(messages: AgentMessage[]): number {
	let count = 0;
	for (const msg of messages) {
		if (hasArrayContent(msg)) {
			for (const block of msg.content) {
				if ((block as ImageContent).type === "image") {
					count++;
				}
			}
		}
	}
	return count;
}

export interface StripImagesResult {
	messages: AgentMessage[];
	strippedCount: number;
}

/**
 * Strip the oldest half of image content blocks from messages, replacing
 * them with text placeholders. Preserves message structure and all non-image
 * content. Returns a new array — does not mutate the input.
 *
 * Images are removed oldest-first (from the start of the messages array),
 * keeping the most recent images which are more likely to be relevant.
 * Handles user, toolResult, and custom message roles.
 *
 * @param messages - The agent messages to process
 * @returns New messages array with old images replaced, plus count of stripped images
 */
export function stripOldestImages(messages: AgentMessage[]): StripImagesResult {
	const totalImages = countImages(messages);
	if (totalImages === 0) {
		return { messages, strippedCount: 0 };
	}

	const stripCount = Math.ceil(totalImages / 2);
	let stripped = 0;

	const result: AgentMessage[] = messages.map((msg) => {
		if (stripped >= stripCount) return msg;

		if (hasArrayContent(msg)) {
			let hasStrippableImage = false;
			for (const block of msg.content) {
				if ((block as ImageContent).type === "image" && stripped < stripCount) {
					hasStrippableImage = true;
					break;
				}
			}
			if (hasStrippableImage) {
				const newContent = msg.content.map((block) => {
					if ((block as ImageContent).type === "image" && stripped < stripCount) {
						stripped++;
						return { type: "text" as const, text: IMAGE_PLACEHOLDER };
					}
					return block;
				});
				return { ...msg, content: newContent } as AgentMessage;
			}
		}
		return msg;
	});

	return { messages: result, strippedCount: stripped };
}
