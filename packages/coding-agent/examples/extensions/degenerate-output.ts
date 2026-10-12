/**
 * Opt-in guard for long whitespace/asterisk tails in assistant output.
 * Run with: pi -e ./examples/extensions/degenerate-output.ts
 *
 * This deliberately narrow heuristic is not a general repetition detector. Do not
 * enable it when long literal whitespace/asterisk output is part of the task.
 * Context edits preserve the raw transcript and tool calls, and survive compaction
 * and session resume. No retry or additional model request is scheduled.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("turn_end", (event) => {
		if (event.message.role !== "assistant") return;
		if (event.message.stopReason === "error" || event.message.stopReason === "aborted") return;
		const content = event.message.content;
		const lastTextIndex = content.findLastIndex((part) => part.type === "text");
		const part = content[lastTextIndex];
		if (part?.type !== "text") return;

		// Avoid changing fenced code, short Markdown separators, or ordinary spacing.
		if (part.text.includes("```") || part.text.includes("~~~")) return;
		const tail = /[\t\r\n *]+$/.exec(part.text);
		if (!tail || tail[0].length < 1024) return;

		return {
			entries: [
				{
					type: "context_edit",
					targetId: event.messageEntryId,
					replacement: {
						content: content.flatMap((block, index) => {
							if (index !== lastTextIndex) return [block];
							const text = part.text.slice(0, tail.index).trimEnd();
							return text ? [{ type: "text" as const, text }] : [];
						}),
					},
				},
			],
		};
	});
}
