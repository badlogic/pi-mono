import { resolve } from "node:path";
import type { BranchSummaryEntry, SessionInfo } from "../../core/session-manager.js";
import type { RpcNavigateTreeResult, RpcSessionListItem } from "./rpc-types.js";

function toSafeIso(date: Date): string {
	return Number.isNaN(date.getTime()) ? "1970-01-01T00:00:00.000Z" : date.toISOString();
}

/** Convert SessionInfo to RPC transport shape. */
export function toRpcSessionListItem(sessionInfo: SessionInfo): RpcSessionListItem {
	return {
		path: resolve(sessionInfo.path),
		id: sessionInfo.id,
		cwd: sessionInfo.cwd,
		name: sessionInfo.name,
		parentSessionPath: sessionInfo.parentSessionPath,
		created: toSafeIso(sessionInfo.created),
		modified: toSafeIso(sessionInfo.modified),
		messageCount: sessionInfo.messageCount,
		firstMessage: sessionInfo.firstMessage,
		allMessagesText: sessionInfo.allMessagesText,
	};
}

/** Convert navigateTree core result to RPC transport shape. */
export function toRpcNavigateTreeResult(result: {
	cancelled: boolean;
	aborted?: boolean;
	editorText?: string;
	summaryEntry?: Pick<BranchSummaryEntry, "id" | "summary" | "fromHook">;
}): RpcNavigateTreeResult {
	return {
		cancelled: result.cancelled,
		aborted: result.aborted,
		editorText: result.editorText,
		summaryEntry: result.summaryEntry
			? {
					id: result.summaryEntry.id,
					summary: result.summaryEntry.summary,
					fromExtension: result.summaryEntry.fromHook === true,
				}
			: undefined,
	};
}

/** Normalize RPC label input: empty/whitespace values clear the label. */
export function normalizeRpcLabel(label: string | undefined): string | undefined {
	const normalized = label?.trim();
	return normalized ? normalized : undefined;
}
