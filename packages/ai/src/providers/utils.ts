import type { Api, AssistantMessage, Message, Model } from "../types.js";

export function transformMessages<TApi extends Api>(messages: Message[], model: Model<TApi>): Message[] {
	return messages.map((msg) => {
		// User and toolResult messages pass through unchanged
		if (msg.role === "user" || msg.role === "toolResult") {
			return msg;
		}

		// Assistant messages need transformation check
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;

			// If message is from the same provider and API, keep as is
			if (assistantMsg.provider === model.provider && assistantMsg.api === model.api) {
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
		return msg;
	});
}
