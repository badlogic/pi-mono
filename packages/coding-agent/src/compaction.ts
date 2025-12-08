/**
 * Context compaction for long sessions.
 *
 * Pure functions for compaction logic. The session manager handles I/O,
 * and after compaction the session is reloaded.
 */

import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model, Usage } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import { messageTransformer } from "./messages.js";
import type { CompactionEntry, SessionEntry } from "./session-manager.js";

// ============================================================================
// Types
// ============================================================================

export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
};

// ============================================================================
// Token calculation
// ============================================================================

/**
 * Calculate total context tokens from usage.
 * Uses the native totalTokens field when available, falls back to computing from components.
 */
export function calculateContextTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/**
 * Get usage from an assistant message if available.
 */
function getAssistantUsage(msg: AppMessage): Usage | null {
	if (msg.role === "assistant" && "usage" in msg) {
		const assistantMsg = msg as AssistantMessage;
		if (assistantMsg.stopReason !== "aborted" && assistantMsg.usage) {
			return assistantMsg.usage;
		}
	}
	return null;
}

/**
 * Find the last non-aborted assistant message usage from session entries.
 */
export function getLastAssistantUsage(entries: SessionEntry[]): Usage | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message") {
			const usage = getAssistantUsage(entry.message);
			if (usage) return usage;
		}
	}
	return null;
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// Cut point detection
// ============================================================================

/**
 * Find indices of message entries that are user messages (turn boundaries).
 */
function findTurnBoundaries(entries: SessionEntry[], startIndex: number, endIndex: number): number[] {
	const boundaries: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message.role === "user") {
			boundaries.push(i);
		}
	}
	return boundaries;
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 * Returns the entry index of the first message to keep (a user message for turn integrity).
 *
 * Only considers entries between `startIndex` and `endIndex` (exclusive).
 */
export function findCutPoint(
	entries: SessionEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens: number,
): number {
	const boundaries = findTurnBoundaries(entries, startIndex, endIndex);

	if (boundaries.length === 0) {
		return startIndex; // No user messages, keep everything in range
	}

	// Collect assistant usages walking backwards from endIndex
	const assistantUsages: Array<{ index: number; tokens: number }> = [];
	for (let i = endIndex - 1; i >= startIndex; i--) {
		const entry = entries[i];
		if (entry.type === "message") {
			const usage = getAssistantUsage(entry.message);
			if (usage) {
				assistantUsages.push({
					index: i,
					tokens: calculateContextTokens(usage),
				});
			}
		}
	}

	if (assistantUsages.length === 0) {
		// No usage info, keep last turn only
		return boundaries[boundaries.length - 1];
	}

	// Walk through and find where cumulative token difference exceeds keepRecentTokens
	const newestTokens = assistantUsages[0].tokens;
	let cutIndex = startIndex; // Default: keep everything in range

	for (let i = 1; i < assistantUsages.length; i++) {
		const tokenDiff = newestTokens - assistantUsages[i].tokens;
		if (tokenDiff >= keepRecentTokens) {
			// Find the turn boundary at or before the assistant we want to keep
			const lastKeptAssistantIndex = assistantUsages[i - 1].index;

			for (let b = boundaries.length - 1; b >= 0; b--) {
				if (boundaries[b] <= lastKeptAssistantIndex) {
					cutIndex = boundaries[b];
					break;
				}
			}
			break;
		}
	}

	return cutIndex;
}

// ============================================================================
// Summarization
// ============================================================================

const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

/**
 * Generate a summary of the conversation using the LLM.
 */
export async function generateSummary(
	currentMessages: AppMessage[],
	model: Model<any>,
	reserveTokens: number,
	apiKey: string,
	signal?: AbortSignal,
	customInstructions?: string,
): Promise<string> {
	const maxTokens = Math.floor(0.8 * reserveTokens);

	const prompt = customInstructions
		? `${SUMMARIZATION_PROMPT}\n\nAdditional focus: ${customInstructions}`
		: SUMMARIZATION_PROMPT;

	// Transform custom messages (like bashExecution) to LLM-compatible messages
	const transformedMessages = messageTransformer(currentMessages);

	const summarizationMessages = [
		...transformedMessages,
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: prompt }],
			timestamp: Date.now(),
		},
	];

	const response = await complete(model, { messages: summarizationMessages }, { maxTokens, signal, apiKey });

	const textContent = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return textContent;
}

// ============================================================================
// Main compaction function
// ============================================================================

/**
 * Calculate compaction and generate summary.
 * Returns the CompactionEntry to append to the session file.
 *
 * @param entries - All session entries
 * @param model - Model to use for summarization
 * @param settings - Compaction settings
 * @param apiKey - API key for LLM
 * @param signal - Optional abort signal
 * @param customInstructions - Optional custom focus for the summary
 */
export async function compact(
	entries: SessionEntry[],
	model: Model<any>,
	settings: CompactionSettings,
	apiKey: string,
	signal?: AbortSignal,
	customInstructions?: string,
): Promise<CompactionEntry> {
	// Don't compact if the last entry is already a compaction
	if (entries.length > 0 && entries[entries.length - 1].type === "compaction") {
		throw new Error("Already compacted");
	}

	// Find previous compaction boundary
	let prevCompactionIndex = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") {
			prevCompactionIndex = i;
			break;
		}
	}
	const boundaryStart = prevCompactionIndex + 1;
	const boundaryEnd = entries.length;

	// Get token count before compaction
	const lastUsage = getLastAssistantUsage(entries);
	const tokensBefore = lastUsage ? calculateContextTokens(lastUsage) : 0;

	// Find cut point (entry index) within the valid range
	const firstKeptEntryIndex = findCutPoint(entries, boundaryStart, boundaryEnd, settings.keepRecentTokens);

	// Extract messages to summarize (before the cut point)
	const messagesToSummarize: AppMessage[] = [];
	for (let i = boundaryStart; i < firstKeptEntryIndex; i++) {
		const entry = entries[i];
		if (entry.type === "message") {
			messagesToSummarize.push(entry.message);
		}
	}

	// Also include the previous summary if there was a compaction
	if (prevCompactionIndex >= 0) {
		const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
		// Prepend the previous summary as context
		messagesToSummarize.unshift({
			role: "user",
			content: `Previous session summary:\n${prevCompaction.summary}`,
			timestamp: Date.now(),
		});
	}

	// Generate summary from messages before the cut point
	const summary = await generateSummary(
		messagesToSummarize,
		model,
		settings.reserveTokens,
		apiKey,
		signal,
		customInstructions,
	);

	return {
		type: "compaction",
		timestamp: new Date().toISOString(),
		summary,
		firstKeptEntryIndex,
		tokensBefore,
	};
}
