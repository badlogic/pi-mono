import { completeSimple } from "../../stream.js";
import type { AssistantMessage, Message, Model, TextContent, UserMessage } from "../../types.js";
import { estimateTokens } from "../../utils/token-counter.js";
import {
	COMPACT_BOUNDARY_TAG,
	COMPACT_SUMMARY_TAG,
	type CompactionConfig,
	type CompactionContext,
	type CompactionOptions,
	type CompactionResult,
	type CompactionStats,
} from "./types.js";

const DEFAULT_CONFIG: CompactionConfig = {
	triggerRatio: 0.7,
	hardRatio: 0.9,
	tailMessages: 8,
};

const DEFAULT_SUMMARY_PROMPT = `You are compressing a coding agent's transcript.
Summarize facts only. Capture:
- current goal or task
- key decisions and rationale
- files changed and why
- test or command results
- open TODOs / next steps
Keep it short and concrete.`;

function cloneUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function isBoundaryMessage(m: Message): boolean {
	if (m.role !== "assistant") return false;
	return m.content.some((c) => c.type === "text" && c.text.startsWith(COMPACT_BOUNDARY_TAG));
}

function renderMessageForSummary(m: Message): string {
	const prefix = m.role === "assistant" ? "assistant" : m.role === "toolResult" ? "tool" : "user";
	const parts: string[] = [];
	for (const c of Array.isArray(m.content) ? m.content : []) {
		if (c.type === "text") parts.push(c.text);
		else if (c.type === "thinking") parts.push(`(thinking ${c.thinking.slice(0, 400)})`);
		else if (c.type === "toolCall") parts.push(`tool-call ${c.name} args ${JSON.stringify(c.arguments || {})}`);
		else if (c.type === "image") parts.push(`[image omitted]`);
	}
	if (m.role === "toolResult") {
		const toolName = (m as any).toolName || "tool";
		return `${prefix}:${toolName} ${parts.join("\n")}`;
	}
	return `${prefix} ${parts.join("\n")}`.trim();
}

async function summarizeSlice(
	model: Model<any>,
	slice: Message[],
	options: { signal?: AbortSignal },
	summaryPrompt: string,
): Promise<AssistantMessage> {
	const summaryMessages: UserMessage[] = slice.map((m) => ({
		role: "user",
		content: [{ type: "text", text: renderMessageForSummary(m) } satisfies TextContent],
		timestamp: m.timestamp,
	}));

	const maxTokens = Math.min(512, Math.max(128, Math.floor(model.maxTokens / 4)));
	const summary = await completeSimple(
		model,
		{ systemPrompt: summaryPrompt, messages: summaryMessages },
		{
			temperature: 0,
			maxTokens,
			signal: options.signal,
		},
	);

	// Ensure there is visible text; strip thinking-only replies
	const hasText = summary.content.some((c) => c.type === "text" && c.text.trim().length > 0);
	if (!hasText) {
		summary.content = summary.content
			.filter((c) => c.type === "text")
			.map((c) => ({ ...c, text: c.text.trim() })) as AssistantMessage["content"];
		if (summary.content.length === 0) {
			summary.content = [{ type: "text", text: "(no summary returned)" }];
		}
	}

	// Tag the summary so later compactions can skip it
	const firstText = summary.content.find((c) => c.type === "text") as TextContent | undefined;
	if (firstText && !firstText.text.startsWith(COMPACT_SUMMARY_TAG)) {
		firstText.text = `${COMPACT_SUMMARY_TAG} ${firstText.text}`;
	}

	return summary;
}

function buildBoundaryMessage(
	model: Model<any>,
	trigger: CompactionStats["trigger"],
	tokensBefore: number,
): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "text",
				text: `${COMPACT_BOUNDARY_TAG} trigger=${trigger} tokens_before=${tokensBefore}`,
			},
		],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: cloneUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export class ConversationCompactor {
	private config: CompactionConfig;
	private summaryPrompt: string;

	constructor(config?: Partial<CompactionConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.summaryPrompt = config?.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
	}

	async maybeCompact(
		messages: Message[],
		ctx: CompactionContext,
		options: CompactionOptions = {},
	): Promise<CompactionResult> {
		if (!ctx.model?.contextWindow) {
			return { messages, compacted: false, reason: "no-model" };
		}

		const triggerRatio = options.triggerRatio ?? this.config.triggerRatio;
		const hardRatio = options.hardRatio ?? this.config.hardRatio;
		const tokensBefore = estimateTokens(ctx.systemPrompt, messages);
		const ratio = tokensBefore / ctx.model.contextWindow;

		const mustCompact = ratio >= hardRatio;
		const shouldCompact = ratio >= triggerRatio;
		if (!options.force && !mustCompact && !shouldCompact) {
			return { messages, compacted: false, reason: "under-threshold" };
		}

		const lastBoundary = this.findLastBoundary(messages);
		const start = lastBoundary >= 0 ? lastBoundary + 1 : 0;
		const tailCount = Math.min(this.config.tailMessages, messages.length - start);
		const compactEnd = Math.max(start, messages.length - tailCount);
		const slice = messages.slice(start, compactEnd);
		const tail = messages.slice(compactEnd);

		if (slice.length === 0) {
			return { messages, compacted: false, reason: "nothing-to-compact" };
		}

		const summary = await summarizeSlice(ctx.model, slice, { signal: ctx.signal }, this.summaryPrompt);
		const boundary = buildBoundaryMessage(ctx.model, options.force ? "manual" : "auto", tokensBefore);

		const compactedMessages = [...messages.slice(0, start), boundary, summary, ...tail];
		const tokensAfter = estimateTokens(ctx.systemPrompt, compactedMessages);

		const stats: CompactionStats = {
			tokensBefore,
			tokensAfter,
			trigger: options.force ? "manual" : "auto",
		};

		return {
			messages: compactedMessages,
			compacted: true,
			boundaryMessage: boundary,
			summaryMessage: summary,
			stats,
		};
	}

	private findLastBoundary(messages: Message[]): number {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (isBoundaryMessage(messages[i])) return i;
		}
		return -1;
	}
}
