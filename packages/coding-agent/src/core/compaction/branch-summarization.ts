/**
 * Branch summarization for tree navigation.
 *
 * When navigating to a different point in the session tree, this generates
 * a summary of the branch being left so context isn't lost.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createHookMessage } from "../messages.js";
import type { ReadonlySessionManager, SessionEntry } from "../session-manager.js";
import { estimateTokens } from "./compaction.js";

// ============================================================================
// Types
// ============================================================================

export interface BranchSummaryResult {
	summary?: string;
	aborted?: boolean;
	error?: string;
}

export interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export interface BranchPreparation {
	/** Messages extracted for summarization, in chronological order */
	messages: AgentMessage[];
	/** File operations extracted from tool calls */
	fileOps: FileOperations;
	/** Total estimated tokens in messages */
	totalTokens: number;
}

export interface CollectEntriesResult {
	/** Entries to summarize, in chronological order */
	entries: SessionEntry[];
	/** Common ancestor between old and new position, if any */
	commonAncestorId: string | null;
}

export interface GenerateBranchSummaryOptions {
	/** Model to use for summarization */
	model: Model<any>;
	/** API key for the model */
	apiKey: string;
	/** Abort signal for cancellation */
	signal: AbortSignal;
	/** Optional custom instructions for summarization */
	customInstructions?: string;
	/** Tokens reserved for prompt + LLM response (default 16384) */
	reserveTokens?: number;
}

// ============================================================================
// Entry Collection
// ============================================================================

/**
 * Collect entries that should be summarized when navigating from one position to another.
 *
 * Walks from oldLeafId back to the common ancestor with targetId, collecting entries
 * along the way. Does NOT stop at compaction boundaries - those are included and their
 * summaries become context.
 *
 * @param session - Session manager (read-only access)
 * @param oldLeafId - Current position (where we're navigating from)
 * @param targetId - Target position (where we're navigating to)
 * @returns Entries to summarize and the common ancestor
 */
export function collectEntriesForBranchSummary(
	session: ReadonlySessionManager,
	oldLeafId: string | null,
	targetId: string,
): CollectEntriesResult {
	// If no old position, nothing to summarize
	if (!oldLeafId) {
		return { entries: [], commonAncestorId: null };
	}

	// Find common ancestor
	const oldPath = new Set(session.getPath(oldLeafId).map((e) => e.id));
	const targetPath = session.getPath(targetId);

	let commonAncestorId: string | null = null;
	for (const entry of targetPath) {
		if (oldPath.has(entry.id)) {
			commonAncestorId = entry.id;
			break;
		}
	}

	// Collect entries from old leaf back to common ancestor
	const entries: SessionEntry[] = [];
	let current: string | null = oldLeafId;

	while (current && current !== commonAncestorId) {
		const entry = session.getEntry(current);
		if (!entry) break;
		entries.push(entry);
		current = entry.parentId;
	}

	// Reverse to get chronological order
	entries.reverse();

	return { entries, commonAncestorId };
}

// ============================================================================
// Entry to Message Conversion
// ============================================================================

/**
 * Extract AgentMessage from a session entry.
 * Similar to getMessageFromEntry in compaction.ts but also handles compaction entries.
 */
function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
	switch (entry.type) {
		case "message":
			// Skip tool results - context is in assistant's tool call
			if (entry.message.role === "toolResult") return undefined;
			return entry.message;

		case "custom_message":
			return createHookMessage(entry.customType, entry.content, entry.display, entry.details, entry.timestamp);

		case "branch_summary":
			return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);

		case "compaction":
			return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);

		// These don't contribute to conversation content
		case "thinking_level_change":
		case "model_change":
		case "custom":
		case "label":
			return undefined;
	}
}

/**
 * Extract file operations from tool calls in an assistant message.
 */
function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
	if (message.role !== "assistant") return;
	if (!("content" in message) || !Array.isArray(message.content)) return;

	for (const block of message.content) {
		if (typeof block !== "object" || block === null) continue;
		if (!("type" in block) || block.type !== "toolCall") continue;
		if (!("arguments" in block) || !("name" in block)) continue;

		const args = block.arguments as Record<string, unknown> | undefined;
		if (!args) continue;

		const path = typeof args.path === "string" ? args.path : undefined;
		if (!path) continue;

		switch (block.name) {
			case "read":
				fileOps.read.add(path);
				break;
			case "write":
				fileOps.written.add(path);
				break;
			case "edit":
				fileOps.edited.add(path);
				break;
		}
	}
}

/**
 * Prepare entries for summarization with token budget.
 *
 * Walks entries from NEWEST to OLDEST, adding messages until we hit the token budget.
 * This ensures we keep the most recent context when the branch is too long.
 *
 * @param entries - Entries in chronological order
 * @param tokenBudget - Maximum tokens to include (0 = no limit)
 */
export function prepareBranchEntries(entries: SessionEntry[], tokenBudget: number = 0): BranchPreparation {
	const messages: AgentMessage[] = [];
	const fileOps: FileOperations = {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
	let totalTokens = 0;

	// Walk from newest to oldest to prioritize recent context
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		const message = getMessageFromEntry(entry);
		if (!message) continue;

		// Extract file ops from assistant messages
		extractFileOpsFromMessage(message, fileOps);

		const tokens = estimateTokens(message);

		// Check budget before adding
		if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
			// If this is a summary entry, try to fit it anyway as it's important context
			if (entry.type === "compaction" || entry.type === "branch_summary") {
				if (totalTokens < tokenBudget * 0.9) {
					messages.unshift(message);
					totalTokens += tokens;
				}
			}
			// Stop - we've hit the budget
			break;
		}

		messages.unshift(message);
		totalTokens += tokens;
	}

	return { messages, fileOps, totalTokens };
}

// ============================================================================
// Summary Generation
// ============================================================================

const BRANCH_SUMMARY_PROMPT = `Summarize this conversation branch concisely for context when returning later:
- Key decisions made and actions taken
- Important context, constraints, or preferences discovered
- Current state and any pending work
- Critical information needed to continue from a different point

Be brief and focused on what matters for future reference.`;

/**
 * Format file operations as a static section to append to summary.
 */
function formatFileOperations(fileOps: FileOperations): string {
	// Combine edited and written into "modified"
	const modified = new Set([...fileOps.edited, ...fileOps.written]);

	// Read-only = read but not modified
	const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort();

	const sections: string[] = [];

	if (readOnly.length > 0) {
		sections.push(`<read-files>\n${readOnly.join("\n")}\n</read-files>`);
	}

	if (modified.size > 0) {
		const files = [...modified].sort();
		sections.push(`<modified-files>\n${files.join("\n")}\n</modified-files>`);
	}

	if (sections.length === 0) return "";

	return `\n\n${sections.join("\n\n")}`;
}

/**
 * Convert messages to text for the summarization prompt.
 */
function messagesToText(messages: AgentMessage[]): string {
	const parts: string[] = [];

	for (const msg of messages) {
		let text = "";

		if (msg.role === "user" && typeof msg.content === "string") {
			text = msg.content;
		} else if (msg.role === "user" && Array.isArray(msg.content)) {
			text = msg.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
		} else if (msg.role === "assistant" && "content" in msg && Array.isArray(msg.content)) {
			text = msg.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
		} else if (msg.role === "branchSummary" && "summary" in msg) {
			text = `[Branch summary: ${msg.summary}]`;
		} else if (msg.role === "compactionSummary" && "summary" in msg) {
			text = `[Session summary: ${msg.summary}]`;
		} else if (msg.role === "hookMessage" && "content" in msg) {
			if (typeof msg.content === "string") {
				text = msg.content;
			} else if (Array.isArray(msg.content)) {
				text = msg.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("");
			}
		}

		if (text) {
			parts.push(`${msg.role}: ${text}`);
		}
	}

	return parts.join("\n\n");
}

/**
 * Generate a summary of abandoned branch entries.
 *
 * @param entries - Session entries to summarize (chronological order)
 * @param options - Generation options
 */
export async function generateBranchSummary(
	entries: SessionEntry[],
	options: GenerateBranchSummaryOptions,
): Promise<BranchSummaryResult> {
	const { model, apiKey, signal, customInstructions, reserveTokens = 16384 } = options;

	// Token budget = context window minus reserved space for prompt + response
	const contextWindow = model.contextWindow || 128000;
	const tokenBudget = contextWindow - reserveTokens;

	const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);

	if (messages.length === 0) {
		return { summary: "No content to summarize" };
	}

	// Build prompt
	const conversationText = messagesToText(messages);
	const instructions = customInstructions || BRANCH_SUMMARY_PROMPT;
	const prompt = `${instructions}\n\nConversation:\n${conversationText}`;

	// Call LLM for summarization
	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey, signal, maxTokens: 2048 },
	);

	// Check if aborted or errored
	if (response.stopReason === "aborted") {
		return { aborted: true };
	}
	if (response.stopReason === "error") {
		return { error: response.errorMessage || "Summarization failed" };
	}

	let summary = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	// Append static file operations section
	summary += formatFileOperations(fileOps);

	return { summary: summary || "No summary generated" };
}
