import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import { calculateContextTokens } from "./compaction.js";

/**
 * Extract total character length from a tool result.
 *
 * We only count text visible to the model (text content blocks or plain strings),
 * ignoring images and opaque detail fields.
 */
function extractTextLength(result: unknown): number {
	if (!result) return 0;

	if (typeof result === "string") {
		return result.length;
	}

	// Some tools may return just an array of content blocks
	if (Array.isArray(result)) {
		let total = 0;
		for (const item of result) {
			if (!item) continue;
			if (typeof item === "string") {
				total += item.length;
			} else if (
				typeof item === "object" &&
				(item as any).type === "text" &&
				typeof (item as any).text === "string"
			) {
				total += (item as any).text.length;
			}
		}
		return total;
	}

	// Standard tool result shape: { content: [...], details?: ... }
	if (typeof result === "object" && result !== null && Array.isArray((result as any).content)) {
		const content = (result as any).content as unknown[];
		let total = 0;
		for (const item of content) {
			if (!item) continue;
			if (typeof item === "string") {
				total += item.length;
			} else if (
				typeof item === "object" &&
				(item as any).type === "text" &&
				typeof (item as any).text === "string"
			) {
				total += (item as any).text.length;
			}
		}
		return total;
	}

	return 0;
}

/**
 * Estimate the number of tokens added to the context by a tool result.
 *
 * Uses a simple chars/4 heuristic which is sufficient for budget checks.
 */
export function estimateToolResultTokens(result: unknown): number {
	const chars = extractTextLength(result);
	if (chars <= 0) return 0;
	return Math.ceil(chars / 4);
}

/**
 * Find the last non-aborted assistant message usage from in-memory messages.
 */
export function getLastAssistantUsageFromMessages(messages: AppMessage[]): Usage | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const assistant = msg as AssistantMessage;
			if (assistant.stopReason !== "aborted") {
				return assistant.usage;
			}
		}
	}
	return null;
}

export interface PostTurnCompactionParams {
	lastUsage: Usage | null;
	estimatedAddedTokens: number;
	contextWindow: number;
	reserveTokens: number;
	enabled: boolean;
}

/**
 * Decide whether we should trigger compaction *before* the next LLM call
 * based on projected context usage after tool outputs.
 */
export function shouldTriggerCompactionAfterTurn(params: PostTurnCompactionParams): boolean {
	const { lastUsage, estimatedAddedTokens, contextWindow, reserveTokens, enabled } = params;
	if (!enabled) return false;
	if (!lastUsage) return false;
	if (estimatedAddedTokens <= 0) return false;
	if (contextWindow <= 0) return false;

	const current = calculateContextTokens(lastUsage);
	const threshold = contextWindow - reserveTokens;
	if (threshold <= 0) return false;

	const projected = current + estimatedAddedTokens;
	return projected > threshold;
}
