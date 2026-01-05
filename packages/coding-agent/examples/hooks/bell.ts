/**
 * Bell on Agent End Hook
 *
 * Sends a bell notification to the terminal when an agent finishes processing.
 * This is useful for getting an audio alert when the agent completes a task.
 *
 * To enable, place this file in your hooks directory:
 * - Global hooks: ~/.pi/agent/hooks/
 * - Project hooks: .pi/hooks/
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.bell();
		}
	});
}
