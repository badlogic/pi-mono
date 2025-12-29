/**
 * Branch summarization for tree navigation.
 *
 * When navigating to a different point in the session tree, this generates
 * a summary of the branch being left so context isn't lost.
 */

import type { Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import type { SessionEntry } from "../session-manager.js";

const DEFAULT_INSTRUCTIONS =
	"Summarize this conversation branch concisely, capturing key decisions, actions taken, and outcomes.";

export interface BranchSummaryResult {
	summary?: string;
	aborted?: boolean;
	error?: string;
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
	// Convert entries to messages for summarization
	const messages: Array<{ role: string; content: string }> = [];

	for (const entry of entries) {
		if (entry.type === "message") {
			const text = extractMessageText(entry.message);
			if (text) {
				messages.push({ role: entry.message.role, content: text });
			}
		} else if (entry.type === "custom_message") {
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
		} else if (entry.type === "branch_summary") {
			messages.push({ role: "system", content: `[Previous branch summary: ${entry.summary}]` });
		}
	}

	if (messages.length === 0) {
		return { summary: "No content to summarize" };
	}

	// Build prompt for summarization
	const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
	const instructions = customInstructions ? `${customInstructions}\n\n` : `${DEFAULT_INSTRUCTIONS}\n\n`;
	const prompt = `${instructions}Conversation:\n${conversationText}`;

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

	const summary = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return { summary: summary || "No summary generated" };
}
