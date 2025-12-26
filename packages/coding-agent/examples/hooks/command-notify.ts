import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
	pi.events.on("command:complete", (data: any) => {
		const status = data.success ? "completed" : "failed";
		pi.send(`Command ${status}: \`${data.command}\` (exit ${data.exitCode})`);
	});
}
