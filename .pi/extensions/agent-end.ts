import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function agentEndExtension(pi: ExtensionAPI): void {
	pi.on("agent_end", async (_event, ctx) => {
		ctx.ui.notify("agent_end received");
	});
}
