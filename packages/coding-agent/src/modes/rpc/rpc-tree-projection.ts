/**
 * Projection of SessionTreeNode to RpcTreeNode for RPC transport.
 */

import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { formatToolCall } from "../../core/format-tool-call.js";
import type { BashExecutionMessage } from "../../core/messages.js";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.js";
import type { RpcTreeNode, RpcTreeNodeBase } from "./rpc-types.js";

/** Base fields for a projected node before adding role-specific fields. */
type ProjectedBase = Omit<RpcTreeNodeBase, "type">;

type RpcMessageRole = Extract<RpcTreeNode, { type: "message" }>["role"];

type FilteredMetadataEntry = Extract<SessionEntry, { type: "label" | "session_info" | "custom" }>;
type ProjectableNonMessageEntry = Exclude<SessionEntry, FilteredMetadataEntry | { type: "message" }>;

/** Resolved tool call info keyed by toolCallId. */
export interface ToolCallInfo {
	name: string;
	arguments: Record<string, unknown>;
}

interface ContentBlock {
	type: string;
	text?: string;
}

type ExtractableContent = string | readonly ContentBlock[] | null | undefined;

/**
 * Extract text content from string/array message content.
 *
 * - Strings are returned directly (optionally truncated)
 * - Arrays include only blocks with `{ type: "text", text }`
 * - Unknown values return empty string
 */
export function extractText(content: ExtractableContent, maxLen?: number): string {
	if (maxLen !== undefined && maxLen <= 0) {
		return "";
	}

	if (typeof content === "string") {
		return maxLen === undefined ? content : content.slice(0, maxLen);
	}

	if (!Array.isArray(content)) {
		return "";
	}

	const text = content
		.filter(
			(block): block is ContentBlock & { text: string } => block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join(" ");

	return maxLen === undefined ? text : text.slice(0, maxLen);
}

/** Normalize text for single-line previews. */
function normalizePreview(text: string): string {
	return text.replace(/[\n\t]/g, " ").trim();
}

interface RpcMessageRoleProjection {
	role: RpcMessageRole;
	rawRole?: string;
}

function toRpcMessageRole(role: string): RpcMessageRoleProjection {
	switch (role) {
		case "user":
		case "assistant":
		case "custom":
		case "branchSummary":
		case "compactionSummary":
			return { role };
		default:
			return { role: "unknown", rawRole: role };
	}
}

function isFilteredMetadataEntry(entry: SessionEntry): entry is FilteredMetadataEntry {
	return entry.type === "label" || entry.type === "session_info" || entry.type === "custom";
}

function extractAssistantToolCalls(assistant: AssistantMessage): Array<{ id: string; info: ToolCallInfo }> {
	if (!Array.isArray(assistant.content)) {
		return [];
	}

	const calls: Array<{ id: string; info: ToolCallInfo }> = [];
	for (const block of assistant.content) {
		if (block.type !== "toolCall") {
			continue;
		}
		if (typeof block.id !== "string" || typeof block.name !== "string") {
			continue;
		}
		const args = typeof block.arguments === "object" && block.arguments ? block.arguments : {};
		calls.push({
			id: block.id,
			info: { name: block.name, arguments: args as Record<string, unknown> },
		});
	}
	return calls;
}

/**
 * Build map: toolCallId -> tool call metadata.
 *
 * Scans assistant messages for toolCall content blocks.
 * Uses iterative traversal to avoid stack overflows on deep trees.
 */
export function buildToolCallMap(roots: SessionTreeNode[]): Map<string, ToolCallInfo> {
	const map = new Map<string, ToolCallInfo>();
	const stack: SessionTreeNode[] = [...roots];

	while (stack.length > 0) {
		const node = stack.pop()!;
		const entry = node.entry;

		if (entry.type === "message" && entry.message.role === "assistant") {
			for (const call of extractAssistantToolCalls(entry.message as AssistantMessage)) {
				map.set(call.id, call.info);
			}
		}

		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push(node.children[i]!);
		}
	}

	return map;
}

/**
 * Resolve the nearest visible (projected) leaf ID from a raw session leaf ID.
 *
 * The raw leaf may point to filtered metadata entries like `label` or `session_info`.
 * This walks the raw parent chain until it finds a non-filtered entry, or null.
 */
export function resolveProjectedLeafId(roots: SessionTreeNode[], rawLeafId: string | null): string | null {
	if (!rawLeafId) {
		return null;
	}

	const parentById = new Map<string, string | null>();
	const visibleIds = new Set<string>();
	const stack: SessionTreeNode[] = [...roots];

	while (stack.length > 0) {
		const node = stack.pop()!;
		const entry = node.entry;
		parentById.set(entry.id, entry.parentId);
		if (!isFilteredMetadataEntry(entry)) {
			visibleIds.add(entry.id);
		}
		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push(node.children[i]!);
		}
	}

	let currentId: string | null = rawLeafId;
	while (currentId) {
		if (visibleIds.has(currentId)) {
			return currentId;
		}
		currentId = parentById.get(currentId) ?? null;
	}

	return null;
}

interface ProjectionWorkItem {
	node: SessionTreeNode;
	target: RpcTreeNode[];
	projectedParentId: string | null;
	branchToolCalls: Map<string, ToolCallInfo>;
}

/**
 * Project session tree to RPC transport tree.
 *
 * Metadata-only entries are filtered out and their children are promoted.
 * Uses iterative traversal to avoid stack overflows on deep trees.
 */
export function projectTree(roots: SessionTreeNode[], toolCallMap: Map<string, ToolCallInfo>): RpcTreeNode[] {
	const projectedRoots: RpcTreeNode[] = [];
	const stack: ProjectionWorkItem[] = [];

	for (let i = roots.length - 1; i >= 0; i--) {
		stack.push({
			node: roots[i]!,
			target: projectedRoots,
			projectedParentId: null,
			branchToolCalls: new Map<string, ToolCallInfo>(),
		});
	}

	while (stack.length > 0) {
		const { node, target, projectedParentId, branchToolCalls } = stack.pop()!;
		const entry = node.entry;

		if (isFilteredMetadataEntry(entry)) {
			for (let i = node.children.length - 1; i >= 0; i--) {
				stack.push({
					node: node.children[i]!,
					target,
					projectedParentId,
					branchToolCalls,
				});
			}
			continue;
		}

		const children: RpcTreeNode[] = [];
		const base: ProjectedBase = {
			id: entry.id,
			parentId: projectedParentId,
			timestamp: entry.timestamp,
			label: node.label,
			children,
		};

		let childBranchToolCalls = branchToolCalls;
		if (entry.type === "message" && entry.message.role === "assistant") {
			const assistantCalls = extractAssistantToolCalls(entry.message as AssistantMessage);
			if (assistantCalls.length > 0) {
				childBranchToolCalls = new Map(branchToolCalls);
				for (const call of assistantCalls) {
					childBranchToolCalls.set(call.id, call.info);
				}
			}
		}

		const projectedNode =
			entry.type === "message"
				? projectMessage(base, entry.message, branchToolCalls, toolCallMap)
				: projectNonMessageEntry(base, entry);
		target.push(projectedNode);

		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push({
				node: node.children[i]!,
				target: children,
				projectedParentId: entry.id,
				branchToolCalls: childBranchToolCalls,
			});
		}
	}

	return projectedRoots;
}

function projectMessage(
	base: ProjectedBase,
	message: Extract<SessionEntry, { type: "message" }>["message"],
	branchToolCalls: Map<string, ToolCallInfo>,
	globalToolCallMap: Map<string, ToolCallInfo>,
): RpcTreeNode {
	if (message.role === "toolResult") {
		return projectToolResult(base, message, branchToolCalls, globalToolCallMap);
	}

	if (message.role === "bashExecution") {
		const bashMessage = message as BashExecutionMessage;
		return {
			...base,
			type: "message",
			role: "bashExecution",
			preview: formatToolCall("bash", { command: bashMessage.command }),
		};
	}

	if (message.role === "assistant") {
		return projectAssistant(base, message as AssistantMessage);
	}

	const content = "content" in message ? (message.content as ExtractableContent) : undefined;
	const roleProjection = toRpcMessageRole(message.role);
	return {
		...base,
		type: "message",
		role: roleProjection.role,
		...(roleProjection.rawRole ? { rawRole: roleProjection.rawRole } : {}),
		preview: normalizePreview(extractText(content, 200)),
	};
}

function projectAssistant(base: ProjectedBase, message: AssistantMessage): RpcTreeNode {
	const previewText = extractText(message.content, 200);
	const preview = previewText
		? normalizePreview(previewText)
		: message.stopReason === "aborted"
			? "(aborted)"
			: message.errorMessage
				? normalizePreview(message.errorMessage)
				: "(no content)";

	return {
		...base,
		type: "message",
		role: "assistant",
		preview,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
	};
}

function projectToolResult(
	base: ProjectedBase,
	message: ToolResultMessage,
	branchToolCalls: Map<string, ToolCallInfo>,
	globalToolCallMap: Map<string, ToolCallInfo>,
): RpcTreeNode {
	const toolCall = message.toolCallId
		? (branchToolCalls.get(message.toolCallId) ?? globalToolCallMap.get(message.toolCallId))
		: undefined;
	const formatted = toolCall ? formatToolCall(toolCall.name, toolCall.arguments) : undefined;
	const preview = normalizePreview(formatted ?? `[${message.toolName ?? "tool"}]`);

	return {
		...base,
		type: "tool_result",
		toolName: toolCall?.name ?? message.toolName,
		toolArgs: toolCall?.arguments,
		formattedToolCall: formatted,
		preview,
	};
}

function projectNonMessageEntry(base: ProjectedBase, entry: ProjectableNonMessageEntry): RpcTreeNode {
	switch (entry.type) {
		case "compaction":
			return {
				...base,
				type: "compaction",
				tokensBefore: entry.tokensBefore,
			};
		case "model_change":
			return {
				...base,
				type: "model_change",
				provider: entry.provider,
				modelId: entry.modelId,
			};
		case "thinking_level_change":
			return {
				...base,
				type: "thinking_level_change",
				thinkingLevel: entry.thinkingLevel,
			};
		case "branch_summary":
			return {
				...base,
				type: "branch_summary",
				summary: entry.summary,
			};
		case "custom_message":
			return {
				...base,
				type: "custom_message",
				customType: entry.customType,
				preview: normalizePreview(extractText(entry.content, 200)),
			};
	}
}
