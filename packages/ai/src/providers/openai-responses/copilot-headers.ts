import type { Context } from "../../types.js";

export function applyCopilotResponsesHeaders(headers: Record<string, string>, context: Context): void {
	const messages = context.messages || [];
	const lastMessage = messages[messages.length - 1];
	const isAgentCall = lastMessage ? lastMessage.role !== "user" : false;

	headers["X-Initiator"] = isAgentCall ? "agent" : "user";
	headers["Openai-Intent"] = "conversation-edits";

	const hasImages = messages.some((msg) => {
		if (msg.role !== "user" && msg.role !== "toolResult") return false;
		if (!Array.isArray(msg.content)) return false;
		return msg.content.some((block) => block.type === "image");
	});

	if (hasImages) {
		headers["Copilot-Vision-Request"] = "true";
	}
}
