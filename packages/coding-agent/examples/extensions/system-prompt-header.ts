/**
 * System Prompt Header Extension
 *
 * Demonstrates ctx.getSystemPrompt() by displaying system prompt in a styled box
 * with markdown rendering. Shows a preview by default, toggle with /toggle-full-prompt.
 */

import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

const MAX_PREVIEW_LINES = 5;

export default function (pi: ExtensionAPI) {
	// Track expanded state
	let expanded = false;

	// Helper to update the header
	function updateHeader(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		ctx.ui.setHeader((_tui, theme) => {
			// Create a Box with background color (like tool calls)
			const box = new Box(
				1, // paddingX
				1, // paddingY
				(text: string) => theme.bg("customMessageBg", text),
			);

			const prompt = ctx.getSystemPrompt();
			const lines = prompt.split("\n");
			const nonEmptyLines = lines.filter((l) => l.trim().length > 0);

			// Title with stats
			const title = theme.fg("accent", theme.bold(" System Prompt "));
			const stats = theme.fg("muted", ` (${nonEmptyLines.length} lines, ${prompt.length} chars)`);
			const toggle = theme.fg("dim", " [/toggle-full-prompt]");
			box.addChild(new Text(title + stats + toggle, 0, 0));
			box.addChild(new Spacer(1));

			// Content with markdown rendering
			const mdTheme = getMarkdownTheme();

			if (expanded) {
				// Show full prompt with markdown rendering
				box.addChild(new Markdown(prompt, 0, 0, mdTheme));
			} else {
				// Show preview (first N lines) with markdown rendering
				const previewText = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
				box.addChild(new Markdown(previewText, 0, 0, mdTheme));

				if (lines.length > MAX_PREVIEW_LINES) {
					const remaining = lines.length - MAX_PREVIEW_LINES;
					box.addChild(new Spacer(1));
					box.addChild(new Text(theme.fg("dim", `... (${remaining} more lines)`), 0, 0));
				}
			}

			// Add spacer after box
			const container = {
				render(width: number): string[] {
					const boxLines = box.render(width);
					const spacer = new Spacer(1);
					return [...boxLines, ...spacer.render(width)];
				},
				invalidate() {
					box.invalidate();
				},
			};

			return container;
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		updateHeader(ctx);
	});

	// Command to toggle expanded/collapsed
	pi.registerCommand("toggle-full-prompt", {
		description: "Toggle system prompt header between preview and full view",
		handler: async (_args, ctx) => {
			expanded = !expanded;
			updateHeader(ctx);
		},
	});
}
