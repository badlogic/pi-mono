import type { AssistantMessage, Message, Model } from "../types.js";

/**
 * Transform messages for cross-provider compatibility.
 *
 * - User and toolResult messages are copied verbatim
 * - Assistant messages:
 *   - If from the same provider/model, copied as-is
 *   - If from different provider/model, thinking blocks are converted to text blocks with <thinking></thinking> tags
 *
 * @param messages The messages to transform
 * @param model The target model that will process these messages
 * @returns A copy of the messages array with transformations applied
 */
export function transformMessages(messages: Message[], model: Model): Message[] {
	return messages.map((msg) => {
		// User and toolResult messages pass through unchanged
		if (msg.role === "user" || msg.role === "toolResult") {
			return msg;
		}

		// Assistant messages need transformation check
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;

			// If message is from the same provider and model, keep as-is
			if (assistantMsg.provider === model.provider && assistantMsg.model === model.id) {
				return msg;
			}

			// Transform message from different provider/model
			const transformedContent = assistantMsg.content.map((block) => {
				if (block.type === "thinking") {
					// Convert thinking block to text block with <thinking> tags
					return {
						type: "text" as const,
						text: `<thinking>\n${block.thinking}\n</thinking>`,
					};
				}
				// All other blocks (text, toolCall) pass through unchanged
				return block;
			});

			// Return transformed assistant message
			return {
				...assistantMsg,
				content: transformedContent,
			};
		}

		// Should not reach here, but return as-is for safety
		return msg;
	});
}
