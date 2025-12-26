import type { HookAPI } from "@mariozechner/pi-coding-agent";

interface SubagentResult {
	id: string | null;
	agent: string | null;
	success: boolean;
	summary: string;
	exitCode: number;
	timestamp: number;
}

export default function (pi: HookAPI) {
	pi.events.on("subagent:complete", (data: unknown) => {
		const result = data as SubagentResult;
		const agent = result.agent ?? "unknown";
		const status = result.success ? "completed" : "failed";
		const summary = result.summary.length > 200 ? `${result.summary.slice(0, 200)}...` : result.summary;

		pi.send(`Background task ${status}: **${agent}**\n\n${summary}`);
	});
}
