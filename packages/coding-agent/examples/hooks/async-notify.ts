/**
 * Async Notify Hook
 *
 * Listens for async_subagent:complete events and notifies the user.
 * Uses triggerTurn: true to wake the agent and get a response.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent";

interface AsyncSubagentResult {
	id: string | null;
	agent: string | null;
	success: boolean;
	summary: string;
	exitCode: number;
	timestamp: number;
	results?: Array<{ agent: string; output: string; success: boolean }>;
	taskIndex?: number;
	totalTasks?: number;
}

export default function (pi: HookAPI) {
	pi.events.on("async_subagent:complete", (data: unknown) => {
		const result = data as AsyncSubagentResult;
		const agent = result.agent ?? "unknown";
		const status = result.success ? "completed" : "failed";

		const taskInfo =
			result.taskIndex !== undefined && result.totalTasks !== undefined
				? ` (${result.taskIndex + 1}/${result.totalTasks})`
				: "";

		pi.sendMessage(
			{
				customType: "async-subagent-notify",
				content: `Background task ${status}: **${agent}**${taskInfo}\n\n${result.summary}`,
				display: true,
			},
			{ triggerTurn: true },
		);
	});
}
