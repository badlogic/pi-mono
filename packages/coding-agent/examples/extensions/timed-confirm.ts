/**
 * Example extension demonstrating AbortSignal for auto-dismissing dialogs.
 *
 * Commands:
 * - /timed - Shows confirm dialog that auto-cancels after 5 seconds
 * - /timed-select - Shows select dialog that auto-cancels after 10 seconds
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("timed", {
		description: "Show a timed confirmation dialog (auto-cancels in 5s)",
		handler: async (_args, ctx) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000);

			ctx.ui.notify("Dialog will auto-cancel in 5 seconds...", "info");

			const confirmed = await ctx.ui.confirm(
				"Timed Confirmation",
				"This dialog will auto-cancel in 5 seconds. Confirm?",
				{ signal: controller.signal },
			);

			clearTimeout(timeoutId);

			if (confirmed) {
				ctx.ui.notify("Confirmed by user!", "info");
			} else if (controller.signal.aborted) {
				ctx.ui.notify("Dialog timed out (auto-cancelled)", "warning");
			} else {
				ctx.ui.notify("Cancelled by user", "info");
			}
		},
	});

	pi.registerCommand("timed-select", {
		description: "Show a timed select dialog (auto-cancels in 10s)",
		handler: async (_args, ctx) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000);

			ctx.ui.notify("Select dialog will auto-cancel in 10 seconds...", "info");

			const choice = await ctx.ui.select(
				"Pick an option (auto-cancels in 10s)",
				["Option A", "Option B", "Option C"],
				{ signal: controller.signal },
			);

			clearTimeout(timeoutId);

			if (choice) {
				ctx.ui.notify(`Selected: ${choice}`, "info");
			} else if (controller.signal.aborted) {
				ctx.ui.notify("Selection timed out", "warning");
			} else {
				ctx.ui.notify("Selection cancelled", "info");
			}
		},
	});
}
