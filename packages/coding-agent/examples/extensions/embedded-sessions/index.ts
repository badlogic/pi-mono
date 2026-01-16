/**
 * Embedded Sessions Extension
 *
 * Child agent sessions that run in an overlay within the parent session.
 * Useful for focused subtasks, exploration, or read-only review.
 *
 * Commands:
 *   /embed [message]   - Open embedded session with optional initial message
 *   /embed-context     - Open embedded session with parent context included
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { EmbeddedSessionComponent } from "./embedded-session-component.js";
import type { EmbeddedSessionOptions, EmbeddedSessionResult } from "./types.js";

export default function embeddedSessions(pi: ExtensionAPI) {
	/**
	 * Create an embedded session in an overlay.
	 */
	async function createEmbeddedSession(
		ctx: ExtensionCommandContext,
		options: EmbeddedSessionOptions = {},
	): Promise<EmbeddedSessionResult> {
		const session = ctx.session;

		const result = await ctx.ui.custom<EmbeddedSessionResult>(
			async (tui, _theme, keybindings, done) => {
				const component = await EmbeddedSessionComponent.create({
					tui,
					parentSession: session,
					options,
					keybindings,
					onClose: done,
				});
				return component;
			},
			{
				overlay: true,
				overlayOptions: {
					width: options.width ?? "90%",
					maxHeight: options.maxHeight ?? "85%",
					anchor: "center",
				},
			},
		);

		// Persist reference to parent session (if session had any activity)
		if (!result.cancelled || result.messageCount > 0) {
			session.sessionManager.appendEmbeddedSessionRef({
				embeddedSessionId: result.sessionId,
				embeddedSessionFile: result.sessionFile,
				title: options.title,
				summary: result.summary,
				durationMs: result.durationMs,
				messageCount: result.messageCount,
				model: {
					provider: (options.model ?? session.model)?.provider ?? "unknown",
					modelId: (options.model ?? session.model)?.id ?? "unknown",
				},
				thinkingLevel: options.thinkingLevel ?? session.thinkingLevel,
				cancelled: result.cancelled,
				filesRead: result.filesRead,
				filesModified: result.filesModified,
				tokens: result.tokens,
			});
		}

		return result;
	}

	// Basic embedded session
	pi.registerCommand("embed", {
		description: "Open an embedded session (optional: initial message)",
		handler: async (args, ctx) => {
			const title = args.trim() ? "Embedded Task" : "Embedded Session";
			const result = await createEmbeddedSession(ctx, {
				title,
				initialMessage: args.trim() || undefined,
				generateSummary: true,
			});

			if (!result.cancelled && result.summary) {
				pi.sendMessage(
					{
						customType: "embedded_session_summary",
						content: `Embedded session "${title}" completed.\n\nSummary:\n${result.summary}\n\nFiles read: ${result.filesRead.length > 0 ? result.filesRead.join(", ") : "none"}\nFiles modified: ${result.filesModified.length > 0 ? result.filesModified.join(", ") : "none"}`,
						display: true,
					},
					{ triggerTurn: false },
				);
				ctx.ui.notify("Embedded session completed", "info");
			} else if (result.cancelled) {
				ctx.ui.notify("Embedded session cancelled", "warning");
			}
		},
	});

	// Embedded session with parent context
	pi.registerCommand("embed-context", {
		description: "Open embedded session with parent context forked in",
		handler: async (args, ctx) => {
			const title = "Context-Aware Session";
			const result = await createEmbeddedSession(ctx, {
				title,
				includeParentContext: true,
				parentContextDepth: 3,
				initialMessage: args.trim() || "I have context from the parent session. How can I help?",
				generateSummary: true,
			});

			if (!result.cancelled && result.summary) {
				pi.sendMessage(
					{
						customType: "embedded_session_summary",
						content: `Context-aware session completed.\n\nSummary:\n${result.summary}`,
						display: true,
					},
					{ triggerTurn: false },
				);
				ctx.ui.notify("Embedded session completed", "info");
			} else if (result.cancelled) {
				ctx.ui.notify("Embedded session cancelled", "warning");
			}
		},
	});
}

export type { EmbeddedSessionComponentConfig } from "./embedded-session-component.js";
// Re-export for programmatic use by other extensions
export { EmbeddedSessionComponent } from "./embedded-session-component.js";
export type { EmbeddedSessionOptions, EmbeddedSessionResult } from "./types.js";
