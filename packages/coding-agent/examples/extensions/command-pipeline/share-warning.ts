/**
 * Share Warning Demo
 *
 * Demonstrates that /share re-renders HTML after beforeCommand handlers.
 * This handler redacts "secret" from user/assistant messages and adds a
 * warning banner via pipeline metadata.
 *
 * Usage:
 *   pi -e ./command-pipeline
 *
 * Then add a message containing "secret" and run /share.
 */

import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

const SECRET_PATTERN = /secret/gi;

function redactText(text: string): { text: string; redacted: boolean } {
	const updated = text.replace(SECRET_PATTERN, "[REDACTED]");
	return { text: updated, redacted: updated !== text };
}

function redactEntries(entries: SessionEntry[]): { entries: SessionEntry[]; redacted: boolean } {
	let redacted = false;

	const redactedEntries = entries.map((entry) => {
		if (entry.type !== "message") return entry;

		const message = entry.message;
		if (message.role !== "assistant" && message.role !== "user") return entry;

		const cloned = JSON.parse(JSON.stringify(entry)) as typeof entry;
		const clonedMessage = (cloned as { message: { content: unknown[] } }).message;

		for (let i = 0; i < clonedMessage.content.length; i++) {
			const part = clonedMessage.content[i] as { type?: string; text?: string } | string;
			if (typeof part === "string") {
				const result = redactText(part);
				clonedMessage.content[i] = result.text;
				redacted ||= result.redacted;
			} else if (part.type === "text" && typeof part.text === "string") {
				const result = redactText(part.text);
				part.text = result.text;
				redacted ||= result.redacted;
			}
		}

		return cloned;
	});

	return { entries: redactedEntries, redacted };
}

export default function (pi: ExtensionAPI) {
	pi.beforeCommand(
		"share",
		{
			id: "share-warning",
			label: "Share Warning",
			transforms: ["entries"],
		},
		async (data, ctx) => {
			const { entries, redacted } = redactEntries(data.entries);

			if (redacted && ctx.hasUI) {
				ctx.ui.notify("Redacted 'secret' from share output", "warning");
			}

			return {
				data: { entries },
				metadata: redacted ? { warning: "Share output was redacted by a pipeline handler." } : {},
			};
		},
	);
}
