/**
 * Custom Footer Extension
 *
 * Demonstrates ctx.ui.setFooter() for replacing the built-in footer
 * with a custom component showing session context usage.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
	let isCustomFooter = false;

	// Toggle custom footer with /footer command
	pi.registerCommand("footer", {
		description: "Toggle custom footer showing context usage",
		handler: async (_args, ctx) => {
			isCustomFooter = !isCustomFooter;

			if (isCustomFooter) {
				ctx.ui.setFooter((_tui, theme) => {
					return {
						render(width: number): string[] {
							// Calculate usage from branch entries
							let totalInput = 0;
							let totalOutput = 0;
							let totalCost = 0;
							let lastAssistant: AssistantMessage | undefined;

							for (const entry of ctx.sessionManager.getBranch()) {
								if (entry.type === "message" && entry.message.role === "assistant") {
									const msg = entry.message as AssistantMessage;
									totalInput += msg.usage.input;
									totalOutput += msg.usage.output;
									totalCost += msg.usage.cost.total;
									lastAssistant = msg;
								}
							}

							// Context percentage from last assistant message
							const contextTokens = lastAssistant
								? lastAssistant.usage.input +
									lastAssistant.usage.output +
									lastAssistant.usage.cacheRead +
									lastAssistant.usage.cacheWrite
								: 0;
							const contextWindow = ctx.model?.contextWindow || 0;
							const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

							// Format tokens
							const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

							// Build footer line
							const left = [
								theme.fg("dim", `↑${fmt(totalInput)}`),
								theme.fg("dim", `↓${fmt(totalOutput)}`),
								theme.fg("dim", `$${totalCost.toFixed(3)}`),
							].join(" ");

							// Color context percentage based on usage
							let contextStr = `${contextPercent.toFixed(1)}%`;
							if (contextPercent > 90) {
								contextStr = theme.fg("error", contextStr);
							} else if (contextPercent > 70) {
								contextStr = theme.fg("warning", contextStr);
							} else {
								contextStr = theme.fg("success", contextStr);
							}

							const right = `${contextStr} ${theme.fg("dim", ctx.model?.id || "no model")}`;
							const padding = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

							return [truncateToWidth(left + padding + right, width)];
						},
						invalidate() {},
					};
				});
				ctx.ui.notify("Custom footer enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Built-in footer restored", "info");
			}
		},
	});
}
