/**
 * Dirty Repo Guard Hook
 *
 * Prevents session changes when there are uncommitted git changes.
 * Useful to ensure work is committed before switching context.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
	pi.on("session", async (event, ctx) => {
		// Only guard destructive actions
		if (event.reason !== "before_new" && event.reason !== "before_switch" && event.reason !== "before_branch") {
			return;
		}

		// Check for uncommitted changes
		const { stdout, code } = await ctx.exec("git", ["status", "--porcelain"]);

		if (code !== 0) {
			// Not a git repo, allow the action
			return;
		}

		const hasChanges = stdout.trim().length > 0;
		if (!hasChanges) {
			return;
		}

		if (!ctx.hasUI) {
			// In non-interactive mode, block by default
			return { cancel: true };
		}

		// Count changed files
		const changedFiles = stdout.trim().split("\n").filter(Boolean).length;

		const action =
			event.reason === "before_new" ? "new session" : event.reason === "before_switch" ? "switch session" : "branch";

		const choice = await ctx.ui.select(`You have ${changedFiles} uncommitted file(s). ${action} anyway?`, [
			"Yes, proceed anyway",
			"No, let me commit first",
		]);

		if (choice !== "Yes, proceed anyway") {
			ctx.ui.notify("Commit your changes first", "warning");
			return { cancel: true };
		}
	});
}
