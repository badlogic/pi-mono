/**
 * Git Checkpoint Hook
 *
 * Creates git stash checkpoints at each turn so /branch can restore code state.
 * When branching, offers to restore code to that point in history.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
	const checkpoints = new Map<number, string>();

	pi.on("turn_start", async (event) => {
		// Create a git stash entry before LLM makes changes
		const { stdout } = await pi.exec("git", ["stash", "create"]);
		const ref = stdout.trim();
		if (ref) {
			checkpoints.set(event.turnIndex, ref);
		}
	});

	pi.on("session", async (event, ctx) => {
		// Only handle before_branch events
		if (event.reason !== "before_branch") return;

		const ref = checkpoints.get(event.targetTurnIndex);
		if (!ref) return;

		if (!ctx.hasUI) {
			// In non-interactive mode, don't restore automatically
			return;
		}

		const choice = await ctx.ui.select("Restore code state?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);

		if (choice?.startsWith("Yes")) {
			await pi.exec("git", ["stash", "apply", ref]);
			ctx.ui.notify("Code restored to checkpoint", "info");
		}
	});

	pi.on("agent_end", async () => {
		// Clear checkpoints after agent completes
		checkpoints.clear();
	});
}
