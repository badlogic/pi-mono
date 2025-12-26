import { spawn } from "node:child_process";
import type { CustomToolFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const Params = Type.Object({
	command: Type.String({ description: "Shell command to run in background" }),
});

const factory: CustomToolFactory = (pi) => ({
	name: "background_command",
	label: "Background Command",
	description: "Run a shell command in the background. Emits 'command:complete' event when done.",
	parameters: Params,

	async execute(_id, params) {
		const { command } = params;

		const proc = spawn("sh", ["-c", command], {
			cwd: pi.cwd,
			detached: true,
			stdio: "ignore",
		});

		proc.on("close", (code) => {
			pi.events.emit("command:complete", { command, success: code === 0, exitCode: code });
		});

		proc.unref();

		return {
			content: [{ type: "text", text: `Running in background: ${command}` }],
			details: { command },
		};
	},
});

export default factory;
