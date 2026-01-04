/**
 * Async Subagent Notification Hook
 *
 * Listens for completion events from async subagent tools and displays
 * a notification in the TUI. Uses triggerTurn to wake the agent so it
 * can respond to the completed task.
 *
 * Events handled:
 * - subagent:complete (from subagent tool)
 * - async_subagent:complete (from async_subagent tool)
 */

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
	const handleComplete = (data: unknown) => {
		const result = data as SubagentResult;
		const agent = result.agent ?? "unknown";
		const status = result.success ? "completed" : "failed";

		const taskInfo =
			result.taskIndex !== undefined && result.totalTasks !== undefined
				? ` (${result.taskIndex + 1}/${result.totalTasks})`
				: "";

		pi.sendMessage(
			{
				customType: "subagent-notify",
				content: `Background task ${status}: **${agent}**${taskInfo}\n\n${result.summary}`,
				display: true,
			},
			{ triggerTurn: true }, // wake agent to respond to completed task
		);
	};

	// Handle events from both subagent tools
	pi.events.on("subagent:complete", handleComplete);
	pi.events.on("async_subagent:complete", handleComplete);
}
