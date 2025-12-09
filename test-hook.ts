import * as fs from "node:fs";
import type { HookAPI } from "./packages/coding-agent/src/index.js";

export default function (pi: HookAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("Test hook loaded!", "info");

		// Set up a file watcher to demonstrate pi.send()
		const triggerFile = "/tmp/pi-trigger.txt";

		// Create empty trigger file if it doesn't exist
		if (!fs.existsSync(triggerFile)) {
			fs.writeFileSync(triggerFile, "");
		}

		fs.watch(triggerFile, () => {
			try {
				const content = fs.readFileSync(triggerFile, "utf-8").trim();
				if (content) {
					pi.send(`[External trigger]: ${content}`);
					fs.writeFileSync(triggerFile, ""); // Clear after reading
				}
			} catch {
				// File might be in flux
			}
		});

		ctx.ui.notify("Watching /tmp/pi-trigger.txt for external messages", "info");
	});

	pi.on("tool_call", async (event, ctx) => {
		console.log(`[test-hook] tool_call: ${event.toolName}`);

		// Example: block dangerous bash commands
		if (event.toolName === "bash") {
			const cmd = event.input.command as string;
			if (/rm\s+-rf/.test(cmd)) {
				const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}?`);
				if (!ok) {
					return { block: true, reason: "User blocked rm -rf" };
				}
			}
		}

		return undefined;
	});

	pi.on("tool_result", async (event, _ctx) => {
		console.log(`[test-hook] tool_result: ${event.toolName} (${event.result.length} chars)`);
		return undefined;
	});

	pi.on("turn_end", async (event, _ctx) => {
		console.log(`[test-hook] turn_end: turn ${event.turnIndex}`);
	});
}
