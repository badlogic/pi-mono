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
	taskIndex?: number;
	totalTasks?: number;
}

export default function (pi: HookAPI) {
	pi.events.on("subagent:complete", (data: unknown) => {
		const result = data as SubagentResult;
		const agent = result.agent ?? "unknown";
		const status = result.success ? "completed" : "failed";

		const taskInfo =
			result.taskIndex !== undefined && result.totalTasks !== undefined
				? ` (${result.taskIndex + 1}/${result.totalTasks})`
				: "";

		pi.send(`Background task ${status}: **${agent}**${taskInfo}\n\n${result.summary}`);
	});
}
