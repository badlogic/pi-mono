/**
 * Custom Compaction Hook
 *
 * Replaces the default compaction behavior with a full summary of the entire context.
 * Instead of keeping the last 20k tokens of conversation turns, this hook:
 * 1. Summarizes ALL messages (both messagesToSummarize and messagesToKeep and previousSummary)
 * 2. Discards all old turns completely, keeping only the summary
 *
 * This example also demonstrates using a different model (Gemini Flash) for summarization,
 * which can be cheaper/faster than the main conversation model.
 *
 * Usage:
 *   pi --hook examples/hooks/custom-compaction.ts
 */

import { complete, getModel } from "@mariozechner/pi-ai";
import { messageTransformer } from "@mariozechner/pi-coding-agent";
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
	pi.on("session", async (event, ctx) => {
		if (event.reason !== "before_compact") return;

		ctx.ui.notify("Custom compaction hook triggered", "info");

		const {
			messagesToSummarize,
			messagesToKeep,
			previousSummary,
			tokensBefore,
			resolveApiKey,
			entries: _,
			signal,
		} = event;

		// Use Gemini Flash for summarization (cheaper/faster than most conversation models)
		const model = getModel("google", "gemini-2.5-flash");
		if (!model) {
			ctx.ui.notify(`Could not find Gemini Flash model, using default compaction`, "warning");
			return;
		}

		// Resolve API key for the summarization model
		const apiKey = await resolveApiKey(model);
		if (!apiKey) {
			ctx.ui.notify(`No API key for ${model.provider}, using default compaction`, "warning");
			return;
		}

		// Combine all messages for full summary
		const allMessages = [...messagesToSummarize, ...messagesToKeep];

		ctx.ui.notify(
			`Custom compaction: summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens) with ${model.id}...`,
			"info",
		);

		// Transform app messages to pi-ai package format
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
			// Pass signal to honor abort requests (e.g., user cancels compaction)
			const response = await complete(model, { messages: summaryMessages }, { apiKey, maxTokens: 8192, signal });

			const summary = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			if (!summary.trim()) {
				if (!signal.aborted) ctx.ui.notify("Compaction summary was empty, using default compaction", "warning");
				return;
			}

			// Return compaction content - SessionManager adds id/parentId
			// Use firstKeptEntryId from event to keep recent messages
			return {
				compaction: {
					summary,
					firstKeptEntryId: event.firstKeptEntryId,
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
