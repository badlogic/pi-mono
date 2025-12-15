import type { Api, AssistantMessage, Message, Model, ToolCall } from "../types.js";

/**
 * Normalize tool call ID for GitHub Copilot cross-API compatibility.
 * OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
 * Other APIs (Claude, etc.) require max 40 chars and only alphanumeric + underscore + hyphen.
 */
function normalizeCopilotToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

export function transformMessages<TApi extends Api>(messages: Message[], model: Model<TApi>): Message[] {
	// Build a map of original tool call IDs to normalized IDs for github-copilot cross-API switches
	const toolCallIdMap = new Map<string, string>();

	return messages
		.map((msg) => {
			// User messages pass through unchanged
			if (msg.role === "user") {
				return msg;
			}

			// Handle toolResult messages - normalize toolCallId if we have a mapping
			if (msg.role === "toolResult") {
				const normalizedId = toolCallIdMap.get(msg.toolCallId);
				if (normalizedId && normalizedId !== msg.toolCallId) {
					return { ...msg, toolCallId: normalizedId };
				}
				return msg;
			}

			// Assistant messages need transformation check
			if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;

				// If message is from the same provider and API, keep as is
				if (assistantMsg.provider === model.provider && assistantMsg.api === model.api) {
					return msg;
				}

				// Check if we need to normalize tool call IDs (github-copilot cross-API)
				const needsToolCallIdNormalization =
					assistantMsg.provider === "github-copilot" &&
					model.provider === "github-copilot" &&
					assistantMsg.api !== model.api;

				// Transform message from different provider/model
				const transformedContent = assistantMsg.content.map((block) => {
					if (block.type === "thinking") {
						// Convert thinking block to text block with <thinking> tags
						return {
							type: "text" as const,
							text: `<thinking>\n${block.thinking}\n</thinking>`,
						};
					}
					// Normalize tool call IDs for github-copilot cross-API switches
					if (block.type === "toolCall" && needsToolCallIdNormalization) {
						const toolCall = block as ToolCall;
						const normalizedId = normalizeCopilotToolCallId(toolCall.id);
						if (normalizedId !== toolCall.id) {
							toolCallIdMap.set(toolCall.id, normalizedId);
							return { ...toolCall, id: normalizedId };
						}
					}
					// All other blocks pass through unchanged
					return block;
				});

				// Return transformed assistant message
				return {
					...assistantMsg,
					content: transformedContent,
				};
			}
			return msg;
		})
		.map((msg, index, allMessages) => {
			// Second pass: filter out tool calls without corresponding tool results
			if (msg.role !== "assistant") {
				return msg;
			}

			const assistantMsg = msg as AssistantMessage;
			const isLastMessage = index === allMessages.length - 1;

			// If this is the last message, keep all tool calls (ongoing turn)
			if (isLastMessage) {
				return msg;
			}

			// Extract tool call IDs from this message
			const toolCallIds = assistantMsg.content
				.filter((block) => block.type === "toolCall")
				.map((block) => (block.type === "toolCall" ? block.id : ""));

			// If no tool calls, return as is
			if (toolCallIds.length === 0) {
				return msg;
			}

			// Scan forward through subsequent messages to find matching tool results
			const matchedToolCallIds = new Set<string>();
			for (let i = index + 1; i < allMessages.length; i++) {
				const nextMsg = allMessages[i];

				// Stop scanning when we hit another assistant message
				if (nextMsg.role === "assistant") {
					break;
				}

				// Check tool result messages for matching IDs
				if (nextMsg.role === "toolResult") {
					matchedToolCallIds.add(nextMsg.toolCallId);
				}
			}

			// Filter out tool calls that don't have corresponding results
			const filteredContent = assistantMsg.content.filter((block) => {
				if (block.type === "toolCall") {
					return matchedToolCallIds.has(block.id);
				}
				return true; // Keep all non-toolCall blocks
			});

			return {
				...assistantMsg,
				content: filteredContent,
			};
		});
}
