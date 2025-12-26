import type { HookAPI } from "@mariozechner/pi-coding-agent";

interface ChainStepResult {
	agent: string;
	output: string;
	success: boolean;
}

interface SubagentResult {
	id: string | null;
	agent: string | null;
	success: boolean;
	summary: string;
	exitCode: number;
	timestamp: number;
	results?: ChainStepResult[];
}

export default function (pi: HookAPI) {
	pi.events.on("subagent:complete", (data: unknown) => {
		const result = data as SubagentResult;
		const agent = result.agent ?? "unknown";
		const status = result.success ? "completed" : "failed";

		pi.send(`Background task ${status}: **${agent}**\n\n${result.summary}`);
	});
}
