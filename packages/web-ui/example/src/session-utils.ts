import type { AgentMessage, AgentState, SessionData, SessionMetadata } from "@mariozechner/pi-web-ui";

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		"text" in value &&
		value.type === "text" &&
		typeof value.text === "string"
	);
}

function extractMessageText(message: AgentMessage): string {
	if (
		message.role !== "user" &&
		message.role !== "user-with-attachments" &&
		message.role !== "assistant" &&
		message.role !== "toolResult"
	) {
		return "";
	}

	const { content } = message;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	return content
		.filter(isTextBlock)
		.map((block) => block.text.trim())
		.filter(Boolean)
		.join(" ")
		.trim();
}

export function generateSessionTitle(messages: AgentMessage[]): string {
	const firstPrompt = messages.find((message) => message.role === "user" || message.role === "user-with-attachments");
	if (!firstPrompt) return "New chat";

	const text = extractMessageText(firstPrompt);
	if (!text) return "New chat";

	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 56) {
		return text.slice(0, sentenceEnd + 1);
	}

	return text.length <= 56 ? text : `${text.slice(0, 53)}...`;
}

export function shouldPersistSession(messages: AgentMessage[]): boolean {
	return (
		messages.some((message) => message.role === "user" || message.role === "user-with-attachments") &&
		messages.some((message) => message.role === "assistant")
	);
}

export function buildSessionRecord(
	sessionId: string,
	title: string,
	state: AgentState,
): {
	data: SessionData;
	metadata: SessionMetadata;
} {
	const now = new Date().toISOString();

	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};

	return {
		data: {
			id: sessionId,
			title,
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			messages: state.messages,
			createdAt: now,
			lastModified: now,
		},
		metadata: {
			id: sessionId,
			title,
			createdAt: now,
			lastModified: now,
			messageCount: state.messages.length,
			usage,
			thinkingLevel: state.thinkingLevel,
			preview: generateSessionTitle(state.messages),
		},
	};
}
