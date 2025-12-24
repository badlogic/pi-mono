/**
 * Full Context Compaction Hook
 *
 * Replaces the default compaction behavior with a full summary of the entire context.
 * Instead of keeping the last 20k tokens of conversation turns, this hook:
 * 1. Summarizes ALL messages (both messagesToSummarize and messagesToKeep)
 * 2. Discards all old turns completely, keeping only the summary
 *
 * This is useful when you want maximum context window space for new work
 * at the cost of losing exact conversation history.
 *
 * Usage:
 *   pi --hook examples/hooks/full-compaction.ts
 */

import { complete } from "@mariozechner/pi-ai";
import { messageTransformer } from "@mariozechner/pi-coding-agent";
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
	pi.on("session", async (event, ctx) => {
		if (event.reason !== "before_compact") return;

		const { messagesToSummarize, messagesToKeep, previousSummary, tokensBefore, model, resolveApiKey, entries } = event;

		// Combine all messages for full summary
		const allMessages = [...messagesToSummarize, ...messagesToKeep];

		ctx.ui.notify(`Full compaction: summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens)...`, "info");

		// Resolve API key for the model
		const apiKey = await resolveApiKey(model);
		if (!apiKey) {
			ctx.ui.notify(`No API key for ${model.provider}, using default compaction`, "warning");
			return;
		}

		// Transform app messages to LLM-compatible format
		const transformedMessages = messageTransformer(allMessages);

		// Include previous summary context if available
		const previousContext = previousSummary ? `\n\nPrevious session summary for context:\n${previousSummary}` : "";

		// Build messages that ask for a comprehensive summary
		const summaryMessages = [
			...transformedMessages,
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: `You are a conversation summarizer. Create a comprehensive summary of this entire conversation that captures:${previousContext}

1. The main goals and objectives discussed
2. Key decisions made and their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace the ENTIRE conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.`,
					},
				],
				timestamp: Date.now(),
			},
		];

		try {
			// Use the same model with resolved API key
			const response = await complete(model, { messages: summaryMessages }, { apiKey, maxTokens: 8192 });

			const summary = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			if (!summary.trim()) {
				ctx.ui.notify("Compaction summary was empty, using default compaction", "warning");
				return; // Fall back to default compaction
			}

			// Return a compaction entry that discards ALL messages
			// firstKeptEntryIndex points past all current entries
			return {
				compactionEntry: {
					type: "compaction" as const,
					timestamp: new Date().toISOString(),
					summary,
					firstKeptEntryIndex: entries.length,
					tokensBefore,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Compaction failed: ${message}`, "error");
			// Fall back to default compaction on error
			return;
		}
	});
}
