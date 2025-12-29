/**
 * Branch summarization for tree navigation.
 *
 * When navigating to a different point in the session tree, this generates
 * a summary of the branch being left so context isn't lost.
 */

import type { Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import type { SessionEntry } from "../session-manager.js";

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
	/** Messages extracted for summarization */
	messages: Array<{ role: string; content: string }>;
	/** File operations extracted from tool calls */
	fileOps: FileOperations;
	/** Previous summaries found in entries */
	previousSummaries: string[];
}

// ============================================================================
// Entry Parsing
// ============================================================================

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
 * Prepare entries for summarization.
 *
 * Extracts:
 * - Messages (user, assistant text, custom_message)
 * - File operations from tool calls
 * - Previous branch summaries
 *
 * Skips:
 * - toolResult messages (context already in assistant message)
 * - thinking_level_change, model_change, custom, label entries
 * - compaction entries (these are boundaries, shouldn't be in the input)
 */
export function prepareBranchEntries(entries: SessionEntry[]): BranchPreparation {
	const messages: Array<{ role: string; content: string }> = [];
	const fileOps: FileOperations = {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
	const previousSummaries: string[] = [];

	for (const entry of entries) {
		switch (entry.type) {
			case "message": {
				const role = entry.message.role;

				// Skip tool results - the context is in the assistant's tool call
				if (role === "toolResult") continue;

				// Extract file ops from assistant tool calls
				if (role === "assistant") {
					extractFileOpsFromToolCalls(entry.message, fileOps);
				}

				// Extract text content
				const text = extractMessageText(entry.message);
				if (text) {
					messages.push({ role, content: text });
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
					messages.push({ role: "user", content: text });
				}
				break;
			}

			case "branch_summary": {
				previousSummaries.push(entry.summary);
				break;
			}

			// Skip these entry types - they don't contribute to conversation content
			case "compaction":
			case "thinking_level_change":
			case "model_change":
			case "custom":
			case "label":
				break;
		}
	}

	return { messages, fileOps, previousSummaries };
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
 * @param entries - Session entries to summarize
 * @param model - Model to use for summarization
 * @param apiKey - API key for the model
 * @param signal - Abort signal for cancellation
 * @param customInstructions - Optional custom instructions for summarization
 */
export async function generateBranchSummary(
	entries: SessionEntry[],
	model: Model<any>,
	apiKey: string,
	signal: AbortSignal,
	customInstructions?: string,
): Promise<BranchSummaryResult> {
	const { messages, fileOps, previousSummaries } = prepareBranchEntries(entries);

	if (messages.length === 0) {
		return { summary: "No content to summarize" };
	}

	// Build conversation text
	const parts: string[] = [];

	// Include previous summaries as context
	if (previousSummaries.length > 0) {
		parts.push(`[Previous context: ${previousSummaries.join(" | ")}]`);
	}

	// Add conversation
	parts.push(messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"));

	const conversationText = parts.join("\n\n");
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
		{ apiKey, signal, maxTokens: 1024 },
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
