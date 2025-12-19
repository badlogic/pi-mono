/**
 * Parse model override prefix from message text.
 *
 * Syntax: [model] or [model:thinking] at the start of the message
 * Examples:
 *   [haiku] quick question -> { pattern: "haiku", thinkingLevel: undefined, text: "quick question" }
 *   [opus:high] analyze -> { pattern: "opus", thinkingLevel: "high", text: "analyze" }
 *   [claude-sonnet-4-5] hi -> { pattern: "claude-sonnet-4-5", thinkingLevel: undefined, text: "hi" }
 *   normal message -> null
 */

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { isValidThinkingLevel } from "../cli/args.js";

export interface ModelOverride {
	/** Model pattern (fuzzy matched against available models) */
	pattern: string;
	/** Optional thinking level override */
	thinkingLevel: ThinkingLevel | undefined;
	/** Remaining message text after the prefix */
	text: string;
}

/**
 * Parse a message for model override syntax.
 * Returns null if no override syntax found.
 */
export function parseModelOverride(message: string): ModelOverride | null {
	const trimmed = message.trimStart();

	// Must start with [
	if (!trimmed.startsWith("[")) {
		return null;
	}

	// Find the closing bracket
	const closeBracket = trimmed.indexOf("]");
	if (closeBracket === -1) {
		return null;
	}

	// Extract content inside brackets
	const bracketContent = trimmed.slice(1, closeBracket).trim();
	if (!bracketContent) {
		return null;
	}

	// Parse pattern:level format
	const colonIndex = bracketContent.indexOf(":");
	let pattern: string;
	let thinkingLevel: ThinkingLevel | undefined;

	if (colonIndex !== -1) {
		pattern = bracketContent.slice(0, colonIndex).trim();
		const levelStr = bracketContent.slice(colonIndex + 1).trim();
		if (levelStr && isValidThinkingLevel(levelStr)) {
			thinkingLevel = levelStr;
		} else if (levelStr) {
			// Invalid thinking level - treat as part of pattern (e.g., [provider/model])
			// Actually, colon might be in model name, so let's be more careful
			// If it's not a valid thinking level, treat whole thing as pattern
			pattern = bracketContent;
			thinkingLevel = undefined;
		}
	} else {
		pattern = bracketContent;
	}

	if (!pattern) {
		return null;
	}

	// Extract remaining text
	const text = trimmed.slice(closeBracket + 1).trim();

	return { pattern, thinkingLevel, text };
}
