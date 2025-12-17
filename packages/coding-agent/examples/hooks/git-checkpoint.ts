/**
 * Git Checkpoint Hook
 *
 * Creates git stash checkpoints at each turn so /branch can restore code state.
 * When branching, offers to restore code to that point in history.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
	const checkpoints = new Map<number, string>();

	pi.on("turn_start", async (event, ctx) => {
		// Create a git stash entry before LLM makes changes
		const { stdout } = await ctx.exec("git", ["stash", "create"]);
		const ref = stdout.trim();
		if (ref) {
			checkpoints.set(event.turnIndex, ref);
		}
	});

	pi.on("branch", async (event, ctx) => {
		const ref = checkpoints.get(event.targetTurnIndex);
		if (!ref) return undefined;

		if (!ctx.hasUI) {
			// In non-interactive mode, don't restore automatically
			return undefined;
		}

		const choice = await ctx.ui.select("Restore code state?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);

		if (choice?.startsWith("Yes")) {
			await ctx.exec("git", ["stash", "apply", ref]);
			ctx.ui.notify("Code restored to checkpoint", "info");
		}

		return undefined;
	});

	pi.on("agent_end", async () => {
		// Clear checkpoints after agent completes
		checkpoints.clear();
	});
}
