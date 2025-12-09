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
 * Estimate token count for a message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 * Accepts any message type (AppMessage, ToolResultMessage, etc.)
 */
export function estimateTokens(message: {
	role: string;
	content?: unknown;
	command?: string;
	output?: string;
}): number {
	let chars = 0;

	// Handle custom message types that don't have standard content
	if (message.role === "bashExecution") {
		chars = (message.command?.length || 0) + (message.output?.length || 0);
		return Math.ceil(chars / 4);
	}

	// Standard messages with content
	const content = message.content;
	if (typeof content === "string") {
		chars = content.length;
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (block.type === "text") {
				chars += block.text.length;
			} else if (block.type === "thinking") {
				chars += block.thinking.length;
			}
		}
	}
	return Math.ceil(chars / 4);
}

/**
 * Find valid cut points: indices of user, assistant, or bashExecution messages.
 * Never cut at tool results (they must follow their tool call).
 * When we cut at an assistant message with tool calls, its tool results follow it
 * and will be kept.
 * BashExecutionMessage is treated like a user message (user-initiated context).
 */
function findValidCutPoints(entries: SessionEntry[], startIndex: number, endIndex: number): number[] {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.type === "message") {
			const role = entry.message.role;
			// user, assistant, and bashExecution are valid cut points
			// toolResult must stay with its preceding tool call
			if (role === "user" || role === "assistant" || role === "bashExecution") {
				cutPoints.push(i);
			}
		}
	}
	return cutPoints;
}

/**
 * Find the user message (or bashExecution) that starts the turn containing the given entry index.
 * Returns -1 if no turn start found before the index.
 * BashExecutionMessage is treated like a user message for turn boundaries.
 */
export function findTurnStartIndex(entries: SessionEntry[], entryIndex: number, startIndex: number): number {
	for (let i = entryIndex; i >= startIndex; i--) {
		const entry = entries[i];
		if (entry.type === "message") {
			const role = entry.message.role;
			if (role === "user" || role === "bashExecution") {
				return i;
			}
		}
	}
	return -1;
}

export interface CutPointResult {
	/** Index of first entry to keep */
	firstKeptEntryIndex: number;
	/** Index of user message that starts the turn being split, or -1 if not splitting */
	turnStartIndex: number;
	/** Whether this cut splits a turn (cut point is not a user message) */
	isSplitTurn: boolean;
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 *
 * Can cut at user OR assistant messages (never tool results). When cutting at an
 * assistant message with tool calls, its tool results come after and will be kept.
 *
 * Returns CutPointResult with:
 * - firstKeptEntryIndex: the entry index to start keeping from
 * - turnStartIndex: if cutting mid-turn, the user message that started that turn
 * - isSplitTurn: whether we're cutting in the middle of a turn
 *
 * Only considers entries between `startIndex` and `endIndex` (exclusive).
 */
export function findCutPoint(
	entries: SessionEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens: number,
): CutPointResult {
	const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

	if (cutPoints.length === 0) {
		return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
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
		// No usage info, keep from last cut point
		const lastCutPoint = cutPoints[cutPoints.length - 1];
		const entry = entries[lastCutPoint];
		const isUser = entry.type === "message" && entry.message.role === "user";
		return {
			firstKeptEntryIndex: lastCutPoint,
			turnStartIndex: isUser ? -1 : findTurnStartIndex(entries, lastCutPoint, startIndex),
			isSplitTurn: !isUser,
		};
	}

	// Walk through and find where cumulative token difference exceeds keepRecentTokens
	const newestTokens = assistantUsages[0].tokens;
	let cutIndex = startIndex; // Default: keep everything in range

	for (let i = 1; i < assistantUsages.length; i++) {
		const tokenDiff = newestTokens - assistantUsages[i].tokens;
		if (tokenDiff >= keepRecentTokens) {
			// Find the valid cut point at or after the assistant we want to keep
			const lastKeptAssistantIndex = assistantUsages[i - 1].index;

			// Find closest valid cut point at or before lastKeptAssistantIndex
			for (let c = cutPoints.length - 1; c >= 0; c--) {
				if (cutPoints[c] <= lastKeptAssistantIndex) {
					cutIndex = cutPoints[c];
					break;
				}
			}
			break;
		}
	}

	// Scan backwards from cutIndex to include any non-message entries (bash, settings, etc.)
	while (cutIndex > startIndex) {
		const prevEntry = entries[cutIndex - 1];
		// Stop at compaction boundaries
		if (prevEntry.type === "compaction") {
			break;
		}
		if (prevEntry.type === "message") {
			// Stop if we hit any message
			break;
		}
		// Include this non-message entry (bash, settings change, etc.)
		cutIndex--;
	}

	// Determine if this is a split turn
	const cutEntry = entries[cutIndex];
	const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user";
	const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

	return {
		firstKeptEntryIndex: cutIndex,
		turnStartIndex,
		isSplitTurn: !isUserMessage && turnStartIndex !== -1,
	};
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

const TURN_PREFIX_SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION for a split turn. 
This is the PREFIX of a turn that was too large to keep in full. The SUFFIX (recent work) is being kept.

Create a handoff summary that captures:
- What the user originally asked for in this turn
- Key decisions and progress made early in this turn
- Important context needed to understand the kept suffix

Be concise. Focus on information needed to understand the retained recent work.`;

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
	const cutResult = findCutPoint(entries, boundaryStart, boundaryEnd, settings.keepRecentTokens);

	// Extract messages for history summary (before the turn that contains the cut point)
	const historyEnd = cutResult.isSplitTurn ? cutResult.turnStartIndex : cutResult.firstKeptEntryIndex;
	const historyMessages: AppMessage[] = [];
	for (let i = boundaryStart; i < historyEnd; i++) {
		const entry = entries[i];
		if (entry.type === "message") {
			historyMessages.push(entry.message);
		}
	}

	// Include previous summary if there was a compaction
	if (prevCompactionIndex >= 0) {
		const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
		historyMessages.unshift({
			role: "user",
			content: `Previous session summary:\n${prevCompaction.summary}`,
			timestamp: Date.now(),
		});
	}

	// Extract messages for turn prefix summary (if splitting a turn)
	const turnPrefixMessages: AppMessage[] = [];
	if (cutResult.isSplitTurn) {
		for (let i = cutResult.turnStartIndex; i < cutResult.firstKeptEntryIndex; i++) {
			const entry = entries[i];
			if (entry.type === "message") {
				turnPrefixMessages.push(entry.message);
			}
		}
	}

	// Generate summaries (can be parallel if both needed)
	let summary: string;
	let turnPrefixSummary: string | undefined;

	if (cutResult.isSplitTurn && turnPrefixMessages.length > 0) {
		// Generate both summaries in parallel
		const [historyResult, turnPrefixResult] = await Promise.all([
			historyMessages.length > 0
				? generateSummary(historyMessages, model, settings.reserveTokens, apiKey, signal, customInstructions)
				: Promise.resolve("No prior history."),
			generateTurnPrefixSummary(turnPrefixMessages, model, settings.reserveTokens, apiKey, signal),
		]);
		summary = historyResult;
		turnPrefixSummary = turnPrefixResult;
	} else {
		// Just generate history summary
		summary = await generateSummary(
			historyMessages,
			model,
			settings.reserveTokens,
			apiKey,
			signal,
			customInstructions,
		);
	}

	return {
		type: "compaction",
		timestamp: new Date().toISOString(),
		summary,
		turnPrefixSummary,
		firstKeptEntryIndex: cutResult.firstKeptEntryIndex,
		tokensBefore,
	};
}

/**
 * Generate a summary for a turn prefix (when splitting a turn).
 */
async function generateTurnPrefixSummary(
	messages: AppMessage[],
	model: Model<any>,
	reserveTokens: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<string> {
	const maxTokens = Math.floor(0.5 * reserveTokens); // Smaller budget for turn prefix

	const transformedMessages = messageTransformer(messages);
	const summarizationMessages = [
		...transformedMessages,
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: TURN_PREFIX_SUMMARIZATION_PROMPT }],
			timestamp: Date.now(),
		},
	];

	const response = await complete(model, { messages: summarizationMessages }, { maxTokens, signal, apiKey });

	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}
