import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
	pi.on("turn_start", async (_event, ctx) => {
		ctx.ui.setStatus("demo", "🔄 Thinking...");
	});

	pi.on("turn_end", async (_event, ctx) => {
		ctx.ui.setStatus("demo", "✓ Ready");
	});
}
