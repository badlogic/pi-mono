/**
 * Command Pipeline Extension
 *
 * Demonstrates the command pipeline API with realistic use cases:
 * - PII redaction: removes sensitive data from exports/shares
 * - Audit logging: logs all shares to an external endpoint
 * - Metadata injection: adds warning when content was redacted
 *
 * This example shows how multiple handlers chain together - the audit logger
 * receives entries that have already been redacted by the PII handler.
 *
 * Usage:
 *   pi -e ./command-pipeline
 *
 * Then run /export or /share to see the pipeline in action.
 * Run /pipeline to inspect registered handlers.
 */

import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

// Patterns for detecting PII in text content
const PII_PATTERNS = [
	{ name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
	{ name: "api_key", pattern: /(?:api[_-]?key|token|secret)[=:\s]["']?[\w-]{20,}/gi },
	{ name: "ssh_key", pattern: /-----BEGIN [A-Z]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z]+ PRIVATE KEY-----/g },
	{ name: "phone", pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
];

function redactText(text: string): { text: string; redactedTypes: Set<string> } {
	const redactedTypes = new Set<string>();
	let result = text;
	for (const { name, pattern } of PII_PATTERNS) {
		const newPattern = new RegExp(pattern.source, pattern.flags);
		if (newPattern.test(result)) {
			result = result.replace(pattern, `[REDACTED:${name}]`);
			redactedTypes.add(name);
		}
	}
	return { text: result, redactedTypes };
}

function redactEntries(entries: SessionEntry[]): { entries: SessionEntry[]; redactedTypes: string[] } {
	const allRedacted = new Set<string>();

	const redactedEntries = entries.map((entry) => {
		if (entry.type !== "message") return entry;

		const message = entry.message;
		if (message.role !== "assistant" && message.role !== "user") return entry;

		// Deep clone to avoid mutating original - cast to mutable for modification
		const cloned = JSON.parse(JSON.stringify(entry)) as typeof entry;
		const clonedMessage = (cloned as { message: { content: unknown[] } }).message;

		// Redact text content in message
		for (let i = 0; i < clonedMessage.content.length; i++) {
			const part = clonedMessage.content[i] as { type?: string; text?: string } | string;
			if (typeof part === "string") {
				const { text, redactedTypes } = redactText(part);
				clonedMessage.content[i] = text;
				for (const t of redactedTypes) allRedacted.add(t);
			} else if (part.type === "text" && typeof part.text === "string") {
				const { text, redactedTypes } = redactText(part.text);
				part.text = text;
				for (const t of redactedTypes) allRedacted.add(t);
			}
		}

		return cloned;
	});

	return { entries: redactedEntries, redactedTypes: [...allRedacted] };
}

// Simulated audit endpoint - in production this would call an external service
async function sendToAuditSystem(_event: {
	timestamp: string;
	user: string;
	action: "export" | "share";
	sessionId: string;
	destination?: string;
	entryCount: number;
	redacted: boolean;
}): Promise<void> {
	// In a real extension, this would POST to an audit endpoint:
	// await fetch(process.env.AUDIT_ENDPOINT!, { method: "POST", body: JSON.stringify(event) });
}

export default function (pi: ExtensionAPI) {
	// =========================================================================
	// Handler 1: PII Redaction (before export/share)
	// =========================================================================
	// Runs first, transforms entries to remove sensitive data.
	// The next handler in the chain receives the redacted entries.

	pi.beforeCommand(
		"export",
		{
			id: "pii-redactor",
			label: "PII Redactor",
			transforms: ["entries"],
		},
		async (data, ctx) => {
			const { entries, redactedTypes } = redactEntries(data.entries);

			if (redactedTypes.length > 0 && ctx.hasUI) {
				ctx.ui.notify(`Redacted PII: ${redactedTypes.join(", ")}`, "warning");
			}

			return {
				data: { entries },
				metadata: redactedTypes.length > 0 ? { warning: `PII redacted: ${redactedTypes.join(", ")}` } : {},
			};
		},
	);

	pi.beforeCommand(
		"share",
		{
			id: "pii-redactor",
			label: "PII Redactor",
			transforms: ["entries"],
		},
		async (data, ctx) => {
			const { entries, redactedTypes } = redactEntries(data.entries);

			if (redactedTypes.length > 0 && ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Sensitive content",
					`Redacted PII: ${redactedTypes.join(", ")}. Share anyway?`,
				);
				if (!ok) {
					return { cancel: true };
				}
				ctx.ui.notify(`Redacted PII: ${redactedTypes.join(", ")}`, "warning");
			}

			// For share, we also need to rebuild the HTML if entries changed
			// In practice, the built-in share command re-renders HTML after before handlers
			return {
				data: { entries },
				metadata: redactedTypes.length > 0 ? { warning: `PII redacted: ${redactedTypes.join(", ")}` } : {},
			};
		},
	);

	// =========================================================================
	// Handler 2: Audit Logger (after export/share)
	// =========================================================================
	// Runs after the command completes. Receives the final result including
	// any metadata from before handlers (e.g., redaction warnings).

	pi.afterCommand(
		"export",
		{
			id: "audit-logger",
			label: "Audit Logger",
		},
		async (data, ctx) => {
			const auditEvent: Parameters<typeof sendToAuditSystem>[0] = {
				timestamp: new Date().toISOString(),
				user: process.env.USER ?? "unknown",
				action: "export",
				sessionId: ctx.sessionManager.getSessionFile() ?? "ephemeral",
				destination: data.result.filePath,
				entryCount: data.entries.length,
				redacted: !!data.metadata.warning,
			};
			await sendToAuditSystem(auditEvent);
			if (ctx.hasUI) {
				ctx.ui.notify(`Audit logged: export → ${auditEvent.destination ?? "unknown"}`, "info");
			} else {
				console.log("[audit]", JSON.stringify(auditEvent));
			}
		},
	);

	pi.afterCommand(
		"share",
		{
			id: "audit-logger",
			label: "Audit Logger",
		},
		async (data, ctx) => {
			const auditEvent: Parameters<typeof sendToAuditSystem>[0] = {
				timestamp: new Date().toISOString(),
				user: process.env.USER ?? "unknown",
				action: "share",
				sessionId: ctx.sessionManager.getSessionFile() ?? "ephemeral",
				destination: data.result.gistUrl ?? data.result.viewerUrl,
				entryCount: data.entries.length,
				redacted: !!data.metadata.warning,
			};
			await sendToAuditSystem(auditEvent);
			if (ctx.hasUI) {
				ctx.ui.notify(`Audit logged: share → ${auditEvent.destination ?? "unknown"}`, "info");
			} else {
				console.log("[audit]", JSON.stringify(auditEvent));
			}
		},
	);

	// =========================================================================
	// Command: /pipeline - Inspect registered handlers
	// =========================================================================

	pi.registerCommand("pipeline", {
		description: "Show command pipeline stages for /export or /share",
		handler: async (args, ctx) => {
			const command = args.trim() || "export";
			if (command !== "export" && command !== "share") {
				if (ctx.hasUI) ctx.ui.notify("Usage: /pipeline [export|share]", "error");
				return;
			}

			const stages = pi.getPipeline(command);
			if (stages.length === 0) {
				if (ctx.hasUI) ctx.ui.notify(`No handlers registered for /${command}`, "info");
				return;
			}

			const lines = [
				`Pipeline for /${command}:`,
				"",
				"Before handlers (chained, sequential):",
				...stages
					.filter((s) => s.phase === "before")
					.map((s, i) => {
						const status = s.enabled ? "enabled" : "DISABLED";
						const transforms = s.transforms.length > 0 ? s.transforms.join(", ") : "none";
						return `  [${i + 1}] ${s.id} (${status}) - transforms: ${transforms}`;
					}),
				"",
				"After handlers (parallel, observe only):",
				...stages
					.filter((s) => s.phase === "after")
					.map((s, i) => {
						const status = s.enabled ? "enabled" : "DISABLED";
						return `  [${i + 1}] ${s.id} (${status})`;
					}),
			];

			if (ctx.hasUI) {
				ctx.ui.notify(lines.join("\n"), "info");
			} else {
				console.log(lines.join("\n"));
			}
		},
	});
}
