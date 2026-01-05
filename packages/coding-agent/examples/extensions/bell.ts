/**
 * Bell on Agent End Extension
 *
 * Sends a bell notification to the terminal when an agent finishes processing.
 * This is useful for getting an audio alert when the agent completes a task.
 *
 * To enable, place this file in your extensions directory:
 * - Global extensions: ~/.pi/agent/extensions/
 * - Project extensions: .pi/extensions/
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.bell();
		}
	});
}
