import type { Message } from "../types.js";

/**
 * Infer whether the current request to Copilot is user-initiated or agent-initiated.
 * Accepts `unknown[]` because providers may pass pre-converted message shapes.
 */
export function inferCopilotInitiator(messages: unknown[]): "user" | "agent" {
	if (messages.length === 0) return "user";

	const last = messages[messages.length - 1] as Record<string, unknown>;
	const role = last.role as string | undefined;
	if (!role) return "user";

	if (role !== "user") return "agent";

	// Check if last content block is a tool_result (Anthropic-converted shape)
	const content = last.content;
	if (Array.isArray(content) && content.length > 0) {
		const lastBlock = content[content.length - 1] as Record<string, unknown>;
		if (lastBlock.type === "tool_result") {
			return "agent";
		}
	}

	return "user";
}

/** Check whether any message in the conversation contains image content. */
export function hasCopilotVisionInput(messages: Message[]): boolean {
	return messages.some((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) {
			return msg.content.some((c) => c.type === "image");
		}
		if (msg.role === "toolResult" && Array.isArray(msg.content)) {
			return msg.content.some((c) => c.type === "image");
		}
		return false;
	});
}

/**
 * Build dynamic Copilot headers that vary per-request.
 * Static headers (User-Agent, Editor-Version, etc.) come from model.headers.
 */
export function buildCopilotDynamicHeaders(params: {
	messages: unknown[];
	hasImages: boolean;
}): Record<string, string> {
	const headers: Record<string, string> = {
		"X-Initiator": inferCopilotInitiator(params.messages),
		"Openai-Intent": "conversation-edits",
	};

	if (params.hasImages) {
		headers["Copilot-Vision-Request"] = "true";
	}

	return headers;
}
