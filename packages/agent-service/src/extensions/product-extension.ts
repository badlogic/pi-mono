import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { isCommandAllowed } from "../policy.js";
import type { BashPolicyConfig } from "../types.js";

interface PlanMessageDetails {
	goal: string;
	requestedAt: number;
}

interface GuardrailState {
	blockedCount: number;
	lastBlockedCommand?: string;
}

interface PlanStateEntry {
	goal: string;
	requestedAt: number;
}

interface CustomSessionEntry {
	type: string;
	customType?: string;
	data?: GuardrailState | PlanStateEntry;
}

export interface ProductExtensionConfig {
	bashPolicy: BashPolicyConfig;
}

function toPlanText(goal: string, timestamp: number): string {
	return `Plan requested: ${goal} (${new Date(timestamp).toISOString()})`;
}

function extractBashCommand(event: { toolName: string; input: object }): string | undefined {
	if (event.toolName !== "bash") return undefined;
	const input = event.input as { command?: string };
	if (typeof input.command !== "string") return undefined;
	return input.command;
}

function restoreGuardrailState(entries: CustomSessionEntry[]): GuardrailState {
	const latest = [...entries]
		.reverse()
		.find((entry) => entry.type === "custom" && entry.customType === "agent-service-guardrail");
	if (!latest || !latest.data) {
		return { blockedCount: 0 };
	}
	const data = latest.data as GuardrailState;
	return {
		blockedCount: typeof data.blockedCount === "number" ? data.blockedCount : 0,
		lastBlockedCommand: typeof data.lastBlockedCommand === "string" ? data.lastBlockedCommand : undefined,
	};
}

export const productExtension = (config: ProductExtensionConfig): ExtensionFactory => {
	return (pi: ExtensionAPI): void => {
		let state: GuardrailState = { blockedCount: 0 };

		pi.on("session_start", (_event, ctx) => {
			const entries = ctx.sessionManager.getEntries() as CustomSessionEntry[];
			state = restoreGuardrailState(entries);
			if (ctx.hasUI) {
				ctx.ui.setStatus("guardrails", `blocked:${state.blockedCount}`);
			}
		});

		pi.on("tool_call", (event, ctx) => {
			const command = extractBashCommand(event);
			if (!command) return;
			if (isCommandAllowed(command, config.bashPolicy.allowedPrefixes)) return;
			state = {
				blockedCount: state.blockedCount + 1,
				lastBlockedCommand: command,
			};
			pi.appendEntry("agent-service-guardrail", state);
			if (ctx.hasUI) {
				ctx.ui.setStatus("guardrails", `blocked:${state.blockedCount}`);
			}
			return {
				block: true,
				reason: `POLICY_DENIED: command blocked by allowlist: ${command}`,
			};
		});

		pi.on("tool_result", (event) => {
			if (!event.isError) return;
			pi.events.emit("agent-service:tool-error", {
				toolName: event.toolName,
				timestamp: Date.now(),
			});
		});

		const onUserBash = pi.on as (
			event: string,
			handler: (event: { command: string }) => { block: true; reason: string } | undefined,
		) => void;
		onUserBash("user_bash", (event) => {
			if (isCommandAllowed(event.command, config.bashPolicy.allowedPrefixes)) return;
			state = {
				blockedCount: state.blockedCount + 1,
				lastBlockedCommand: event.command,
			};
			pi.appendEntry("agent-service-guardrail", state);
			return {
				block: true,
				reason: `POLICY_DENIED: command blocked by allowlist: ${event.command}`,
			};
		});

		pi.registerMessageRenderer<PlanMessageDetails>("agent-service-plan", (message, options, theme) => {
			const details = message.details;
			const goal = details?.goal ?? (typeof message.content === "string" ? message.content : "plan");
			const requestedAt = details?.requestedAt ?? Date.now();
			const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
			let text = `${theme.fg("accent", "[plan]")} ${goal}`;
			if (options.expanded) {
				text += `\n${theme.fg("dim", new Date(requestedAt).toISOString())}`;
			}
			box.addChild(new Text(text, 0, 0));
			return box;
		});

		pi.registerCommand("plan", {
			description: "Create a plan from the provided goal",
			handler: async (args) => {
				const goal = args.trim().length > 0 ? args.trim() : "current task";
				const requestedAt = Date.now();
				const details: PlanMessageDetails = { goal, requestedAt };
				pi.appendEntry("agent-service-plan", details);
				pi.sendMessage(
					{
						customType: "agent-service-plan",
						content: toPlanText(goal, requestedAt),
						display: true,
						details,
					},
					{ triggerTurn: false },
				);
				pi.sendUserMessage(`Create a concise execution plan for: ${goal}`);
			},
		});
	};
};

export { extractBashCommand, restoreGuardrailState, toPlanText };
