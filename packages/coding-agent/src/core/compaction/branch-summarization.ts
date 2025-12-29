/**
 * Branch summarization for tree navigation.
 *
 * When navigating to a different point in the session tree, this generates
 * a summary of the branch being left so context isn't lost.
 */

import type { Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import type { ReadonlySessionManager, SessionEntry } from "../session-manager.js";

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
	messages: Array<{ role: string; content: string; tokens: number }>;
	/** File operations extracted from tool calls */
	fileOps: FileOperations;
	/** Total tokens in messages */
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
	/** Reserve this fraction of context window for summary (default 0.2) */
	reserveFraction?: number;
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
// Entry Parsing
// ============================================================================

/**
 * Estimate token count for a string using chars/4 heuristic.
 */
function estimateStringTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Extract text content from any message type.
 */
function extractMessageText(message: any): string {
	if (!message.content) return "";
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		return message.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("");
	}
	return "";
}

/**
 * Extract file operations from tool calls in an assistant message.
 */
function extractFileOpsFromToolCalls(message: any, fileOps: FileOperations): void {
	if (!message.content || !Array.isArray(message.content)) return;

	for (const block of message.content) {
		if (typeof block !== "object" || block === null) continue;
		if (block.type !== "toolCall") continue;

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
 * Handles:
 * - message (user, assistant) - extracts text, counts tokens
 * - custom_message - treated as user message
 * - branch_summary - included as context
 * - compaction - includes summary as context
 *
 * Skips:
 * - toolResult messages (context already in assistant's tool call)
 * - thinking_level_change, model_change, custom, label entries
 *
 * @param entries - Entries in chronological order
 * @param tokenBudget - Maximum tokens to include (0 = no limit)
 */
export function prepareBranchEntries(entries: SessionEntry[], tokenBudget: number = 0): BranchPreparation {
	const messages: Array<{ role: string; content: string; tokens: number }> = [];
	const fileOps: FileOperations = {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
	let totalTokens = 0;

	// Walk from newest to oldest to prioritize recent context
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		let role: string | undefined;
		let content: string | undefined;

		switch (entry.type) {
			case "message": {
				const msgRole = entry.message.role;

				// Skip tool results - context is in assistant's tool call
				if (msgRole === "toolResult") continue;

				// Extract file ops from assistant tool calls
				if (msgRole === "assistant") {
					extractFileOpsFromToolCalls(entry.message, fileOps);
				}

				const text = extractMessageText(entry.message);
				if (text) {
					role = msgRole;
					content = text;
				}
				break;
			}

			case "custom_message": {
				const text =
					typeof entry.content === "string"
						? entry.content
						: entry.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("");
				if (text) {
					role = "user";
					content = text;
				}
				break;
			}

			case "branch_summary": {
				role = "context";
				content = `[Branch summary: ${entry.summary}]`;
				break;
			}

			case "compaction": {
				role = "context";
				content = `[Session summary: ${entry.summary}]`;
				break;
			}

			// Skip these - don't contribute to conversation content
			case "thinking_level_change":
			case "model_change":
			case "custom":
			case "label":
				continue;
		}

		if (role && content) {
			const tokens = estimateStringTokens(content);

			// Check budget before adding
			if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
				// If this is a summary entry, try to fit it anyway as it's important context
				if (entry.type === "compaction" || entry.type === "branch_summary") {
					// Add truncated version or skip
					if (totalTokens < tokenBudget * 0.9) {
						// Still have some room, add it
						messages.unshift({ role, content, tokens });
						totalTokens += tokens;
					}
				}
				// Stop - we've hit the budget
				break;
			}

			messages.unshift({ role, content, tokens });
			totalTokens += tokens;
		}
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
	const sections: string[] = [];

	if (fileOps.read.size > 0) {
		const files = [...fileOps.read].sort();
		sections.push(`**Read:** ${files.join(", ")}`);
	}

	if (fileOps.edited.size > 0) {
		const files = [...fileOps.edited].sort();
		sections.push(`**Edited:** ${files.join(", ")}`);
	}

	if (fileOps.written.size > 0) {
		// Exclude files that were also edited (edit implies write)
		const writtenOnly = [...fileOps.written].filter((f) => !fileOps.edited.has(f)).sort();
		if (writtenOnly.length > 0) {
			sections.push(`**Created:** ${writtenOnly.join(", ")}`);
		}
	}

	if (sections.length === 0) return "";

	return `\n\n---\n**Files:**\n${sections.join("\n")}`;
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
	const { model, apiKey, signal, customInstructions, reserveFraction = 0.2 } = options;

	// Calculate token budget (leave room for summary generation)
	const contextWindow = model.contextWindow || 128000;
	const tokenBudget = Math.floor(contextWindow * (1 - reserveFraction));

	const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);

	if (messages.length === 0) {
		return { summary: "No content to summarize" };
	}

	// Build conversation text
	const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
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
