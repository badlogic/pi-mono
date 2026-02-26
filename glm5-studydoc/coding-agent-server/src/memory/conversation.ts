import { complete, getModels, type KnownProvider, type Model, type Api } from "@mariozechner/pi-ai";

export interface MessageContent {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

export interface SessionEntry {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
}

const extractTextParts = (content: unknown): string[] => {
	if (typeof content === "string") {
		return [content];
	}

	if (!Array.isArray(content)) {
		return [];
	}

	const textParts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}

		const block = part as MessageContent;
		if (block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text);
		}
	}

	return textParts;
};

const extractToolCallLines = (content: unknown): string[] => {
	if (!Array.isArray(content)) {
		return [];
	}

	const toolCalls: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}

		const block = part as MessageContent;
		if (block.type !== "toolCall" || typeof block.name !== "string") {
			continue;
		}

		const args = block.arguments ?? {};
		toolCalls.push(`Tool ${block.name} was called with args ${JSON.stringify(args)}`);
	}

	return toolCalls;
};

export const buildConversationText = (entries: SessionEntry[]): string => {
	const sections: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message?.role) {
			continue;
		}

		const role = entry.message.role;
		const isUser = role === "user";
		const isAssistant = role === "assistant";

		if (!isUser && !isAssistant) {
			continue;
		}

		const entryLines: string[] = [];
		const textParts = extractTextParts(entry.message.content);
		if (textParts.length > 0) {
			const roleLabel = isUser ? "User" : "Assistant";
			const messageText = textParts.join("\n").trim();
			if (messageText.length > 0) {
				entryLines.push(`${roleLabel}: ${messageText}`);
			}
		}

		if (isAssistant) {
			entryLines.push(...extractToolCallLines(entry.message.content));
		}

		if (entryLines.length > 0) {
			sections.push(entryLines.join("\n"));
		}
	}

	return sections.join("\n\n");
};

const buildSummaryPrompt = (conversationText: string): string =>
	[
		"Summarize this conversation so I can resume it later.",
		"Include goals, key decisions, progress, open questions, and next steps.",
		"Keep it concise and structured with headings.",
		"",
		"<conversation>",
		conversationText,
		"</conversation>",
	].join("\n");

export interface SummarizeOptions {
	provider?: string;
	modelId?: string;
	apiKey?: string;
	baseUrl?: string;
}

export async function summarizeConversation(
	entries: SessionEntry[],
	options: SummarizeOptions,
): Promise<string> {
	const conversationText = buildConversationText(entries);

	if (!conversationText.trim()) {
		return "No conversation text found";
	}

	const { provider = "anthropic", modelId = "claude-sonnet-4-20250514", apiKey, baseUrl } = options;

	let model: Model<Api> | undefined;

	if (baseUrl) {
		model = {
			id: modelId,
			name: modelId,
			api: "openai-completions" as Api,
			provider: "openai",
			baseUrl: baseUrl,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
			compat: {
				maxTokensField: "max_completion_tokens",
				supportsReasoningEffort: false,
				supportsDeveloperRole: false,
			},
		};
	} else {
		const models = getModels(provider as KnownProvider);
		model = models.find((m) => m.id === modelId);
	}

	if (!model) {
		throw new Error(`Model not found: ${provider}/${modelId}`);
	}

	const summaryMessages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: buildSummaryPrompt(conversationText) }],
			timestamp: Date.now(),
		},
	];

	const response = await complete(model, { messages: summaryMessages }, { apiKey });

	const summary = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return summary;
}
