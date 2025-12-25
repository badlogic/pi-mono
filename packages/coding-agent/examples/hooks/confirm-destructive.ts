/**
 * Confirm Destructive Actions Hook
 *
 * Prompts for confirmation before destructive session actions (clear, switch, branch).
 * Demonstrates how to cancel session events using the before_* variants.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
	pi.on("session", async (event, ctx) => {
		// Only handle before_* events (the ones that can be cancelled)
		if (event.reason === "before_new") {
			if (!ctx.hasUI) return;

			const confirmed = await ctx.ui.confirm(
				"Clear session?",
				"This will delete all messages in the current session.",
			);

			if (!confirmed) {
				ctx.ui.notify("Clear cancelled", "info");
				return { cancel: true };
			}
		}

		if (event.reason === "before_switch") {
			if (!ctx.hasUI) return;

			// Check if there are unsaved changes (messages since last assistant response)
			const hasUnsavedWork = event.entries.some((e) => e.type === "message" && e.message.role === "user");

			if (hasUnsavedWork) {
				const confirmed = await ctx.ui.confirm(
					"Switch session?",
					"You have messages in the current session. Switch anyway?",
				);

				if (!confirmed) {
					ctx.ui.notify("Switch cancelled", "info");
					return { cancel: true };
				}
			}
		}

		if (event.reason === "before_branch") {
			if (!ctx.hasUI) return;

			const choice = await ctx.ui.select(`Branch from turn ${event.targetTurnIndex}?`, [
				"Yes, create branch",
				"No, stay in current session",
			]);

			if (choice !== "Yes, create branch") {
				ctx.ui.notify("Branch cancelled", "info");
				return { cancel: true };
			}
		}
	});
}
