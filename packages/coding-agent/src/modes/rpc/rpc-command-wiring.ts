import { resolve } from "node:path";
import type { SessionInfo } from "../../core/session-manager.js";
import type { RpcNavigateTreeResult, RpcSessionListItem } from "./rpc-types.js";

type ListSessionsScope = "current" | "all" | undefined;

interface SessionScopeSource {
	getCwd(): string;
	getSessionDir(): string;
}

export interface NavigateTreeSummaryEntryLike {
	id: string;
	summary: string;
	fromHook?: boolean;
}

export interface NavigateTreeResultLike {
	cancelled: boolean;
	aborted?: boolean;
	editorText?: string;
	summaryEntry?: NavigateTreeSummaryEntryLike;
}

export interface RpcListSessionsContext {
	sessionManager: SessionScopeSource;
}

export interface RpcListSessionsTarget {
	listAll: boolean;
	cwd: string;
	sessionDir: string | undefined;
}

export interface NavigateTreeCommandLike {
	summarize?: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

function normalizeSessionDir(sessionDir: string): string | undefined {
	return sessionDir.trim().length > 0 ? sessionDir : undefined;
}

function toSafeIso(date: Date): string {
	return Number.isNaN(date.getTime()) ? "1970-01-01T00:00:00.000Z" : date.toISOString();
}

/** Resolve list_sessions target semantics across current/all scopes. */
export function resolveListSessionsTarget(
	session: RpcListSessionsContext,
	scope: ListSessionsScope,
): RpcListSessionsTarget {
	if (scope === "all") {
		return {
			listAll: true,
			cwd: session.sessionManager.getCwd(),
			sessionDir: undefined,
		};
	}

	return {
		listAll: false,
		cwd: session.sessionManager.getCwd(),
		sessionDir: normalizeSessionDir(session.sessionManager.getSessionDir()),
	};
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

/** Build navigateTree options for AgentSession with normalized label semantics. */
export function toNavigateTreeOptions(command: NavigateTreeCommandLike): NavigateTreeCommandLike {
	return {
		summarize: command.summarize,
		customInstructions: command.customInstructions,
		replaceInstructions: command.replaceInstructions,
		label: normalizeRpcLabel(command.label),
	};
}

/** Convert navigateTree core result to RPC transport shape. */
export function toRpcNavigateTreeResult(result: NavigateTreeResultLike): RpcNavigateTreeResult {
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

// ============================================================================
// Label
// ============================================================================

interface LabelWriteTarget {
	appendLabelChange(entryId: string, label: string | undefined): string;
}

/** Normalize RPC label input: empty/whitespace values clear the label. */
export function normalizeRpcLabel(label: string | undefined): string | undefined {
	const normalized = label?.trim();
	return normalized ? normalized : undefined;
}

/** Apply a set_label RPC mutation to a session manager-compatible target. */
export function applyRpcLabelChange(target: LabelWriteTarget, entryId: string, label: string | undefined): void {
	target.appendLabelChange(entryId, normalizeRpcLabel(label));
}
