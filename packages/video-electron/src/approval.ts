import { MUTATING_COMMANDS } from "./config.js";
import type { ApprovalDecision, VotgoInvocation } from "./types.js";

export interface ApprovalRequest {
	invocation: VotgoInvocation;
	reason: string;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;

export function requiresApproval(invocation: VotgoInvocation): boolean {
	return MUTATING_COMMANDS.has(invocation.command);
}

export function defaultApprovalReason(invocation: VotgoInvocation): string {
	if (requiresApproval(invocation)) {
		return `Command "${invocation.command}" can mutate or render media files`;
	}
	return `Command "${invocation.command}" does not require explicit approval`;
}
