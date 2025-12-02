import type { Message } from "../types.js";

// Very light-weight token estimator: approximate 1 token per 4 characters.
// Images count as a fixed overhead so compaction triggers conservatively.
export function estimateTokens(systemPrompt: string | undefined, messages: Message[]): number {
	let chars = systemPrompt ? systemPrompt.length : 0;

	for (const m of messages) {
		for (const part of Array.isArray(m.content) ? m.content : []) {
			switch (part.type) {
				case "text":
					chars += part.text.length;
					break;
				case "thinking":
					chars += part.thinking.length;
					break;
				case "toolCall":
					chars += part.name.length + JSON.stringify(part.arguments ?? {}).length + 12;
					break;
				case "image":
					// Treat images as a small fixed blob; base64 is not sent to the model directly
					chars += 1200;
					break;
			}
		}
	}

	return Math.ceil(chars / 4);
}
