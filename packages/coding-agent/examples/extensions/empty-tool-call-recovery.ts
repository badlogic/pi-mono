/**
 * Recover when a provider reports toolUse without returning a toolCall.
 *
 * Usage: pi --extension ./examples/extensions/empty-tool-call-recovery.ts
 *
 * Unlike an orphaned toolCall, this response has no call ID to answer. Append
 * hidden feedback instead of fabricating a toolResult, then request another turn.
 * Allows three recovery requests per consecutive failure sequence. Completed
 * tool exchanges, final text, and new user prompts reset the budget.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_MESSAGE =
	"The previous response indicated tool use but contained no actual tool calls. " +
	"No tool was executed from that response. Continue from the current state with a valid tool call and its arguments, " +
	"or provide a final answer if the task is complete. Do not repeat operations that have already completed.";

export default function (pi: ExtensionAPI) {
	let recoveryAttempts = 0;

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user") recoveryAttempts = 0;
	});

	pi.on("turn_end", (event, ctx) => {
		const message = event.message;
		if (ctx.signal?.aborted || event.outcome !== "completed" || message.role !== "assistant") return;

		const toolCalls = message.content.filter((block) => block.type === "toolCall");
		if (message.stopReason !== "toolUse" || toolCalls.length > 0) {
			const hasFinalText =
				message.stopReason === "stop" &&
				message.content.some((block) => block.type === "text" && block.text.trim().length > 0);
			const hasToolResults =
				message.stopReason !== "length" &&
				toolCalls.length > 0 &&
				toolCalls.every((call) => event.toolResults.some((result) => result.toolCallId === call.id));
			if (hasFinalText || hasToolResults) recoveryAttempts = 0;
			return;
		}

		if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
			ctx.ui.notify(
				`Model response error: toolUse returned no tool calls after ${MAX_RECOVERY_ATTEMPTS} recovery attempts.`,
				"error",
			);
			return;
		}

		recoveryAttempts++;
		return {
			entries: [
				...event.entries,
				{
					type: "custom_message" as const,
					customType: "empty-tool-call-recovery",
					content: RECOVERY_MESSAGE,
					display: false,
					details: { attempt: recoveryAttempts, maxAttempts: MAX_RECOVERY_ATTEMPTS },
				},
			],
			continue: true,
		};
	});
}
