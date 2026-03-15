import { describe, expect, test } from "vitest";
import { SessionManager } from "../src/core/session-manager.js";
import {
	buildToolCallMap,
	extractText,
	projectTree,
	resolveProjectedLeafId,
} from "../src/modes/rpc/rpc-tree-projection.js";
import type { RpcTreeNode } from "../src/modes/rpc/rpc-types.js";
import { assistantMsg, userMsg } from "./utilities.js";

type RpcMessageNode = Extract<RpcTreeNode, { type: "message" }>;
type RpcToolResultNode = Extract<RpcTreeNode, { type: "tool_result" }>;

function asMessageNode(node: RpcTreeNode): RpcMessageNode {
	expect(node.type).toBe("message");
	return node as RpcMessageNode;
}

function asToolResultNode(node: RpcTreeNode): RpcToolResultNode {
	expect(node.type).toBe("tool_result");
	return node as RpcToolResultNode;
}

function assistantToolCallMsg(id: string, name: string, args: Record<string, unknown>) {
	return {
		role: "assistant" as const,
		content: [{ type: "toolCall" as const, id, name, arguments: args }],
		api: "anthropic-messages" as const,
		provider: "anthropic",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse" as const,
		timestamp: Date.now(),
	};
}

function toolResultMsg(toolCallId: string, toolName = "read") {
	return {
		role: "toolResult" as const,
		toolCallId,
		toolName,
		content: [{ type: "text" as const, text: "file contents" }],
		isError: false,
		timestamp: Date.now(),
	};
}

describe("rpc tree projection", () => {
	test("filters metadata entries and preserves resolved labels", () => {
		const manager = SessionManager.inMemory();
		const userId = manager.appendMessage(userMsg("First"));
		manager.appendMessage(assistantMsg("Second"));
		manager.appendLabelChange(userId, "checkpoint");

		const rawTree = manager.getTree();
		const projected = projectTree(rawTree, buildToolCallMap(rawTree));

		expect(projected).toHaveLength(1);
		expect(projected[0].label).toBe("checkpoint");
		expect(collectTypes(projected)).not.toContain("label");
	});

	test("keeps structural parent links valid after metadata filtering", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage(userMsg("Root"));
		const assistantId = manager.appendMessage(assistantMsg("A"));
		manager.appendLabelChange(assistantId, "checkpoint");
		manager.appendMessage(userMsg("Branch after label entry"));

		const rawTree = manager.getTree();
		const projected = projectTree(rawTree, buildToolCallMap(rawTree));

		expect(collectParentViolations(projected)).toEqual([]);
	});

	test("resolves tool result metadata from matching assistant tool call", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage(userMsg("Read file"));
		manager.appendMessage(assistantToolCallMsg("tc-1", "read", { path: "/tmp/file.ts" }));
		manager.appendMessage(toolResultMsg("tc-1"));

		const rawTree = manager.getTree();
		const projected = projectTree(rawTree, buildToolCallMap(rawTree));
		const toolResult = asToolResultNode(projected[0].children[0].children[0]);

		expect(toolResult.toolName).toBe("read");
		expect(toolResult.toolArgs).toEqual({ path: "/tmp/file.ts" });
		expect(toolResult.formattedToolCall).toBe("[read: /tmp/file.ts]");
	});

	test("resolves colliding toolCallIds per branch", () => {
		const manager = SessionManager.inMemory();
		const rootId = manager.appendMessage(userMsg("Root"));
		manager.appendMessage(assistantToolCallMsg("same-id", "read", { path: "/tmp/a.ts" }));
		manager.appendMessage(toolResultMsg("same-id"));

		manager.branch(rootId);
		manager.appendMessage(assistantToolCallMsg("same-id", "read", { path: "/tmp/b.ts" }));
		manager.appendMessage(toolResultMsg("same-id"));

		const rawTree = manager.getTree();
		const projected = projectTree(rawTree, buildToolCallMap(rawTree));
		const paths = collectToolResultPaths(projected);

		expect(paths).toContain("/tmp/a.ts");
		expect(paths).toContain("/tmp/b.ts");
	});

	test("handles deep trees without recursive stack overflow", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage(userMsg("root"));
		for (let i = 0; i < 12000; i++) {
			manager.appendMessage(userMsg(`node ${i}`));
		}

		const rawTree = manager.getTree();
		expect(() => {
			const toolCallMap = buildToolCallMap(rawTree);
			projectTree(rawTree, toolCallMap);
		}).not.toThrow();
	});

	test("resolves projected leaf id when raw leaf points to filtered metadata entry", () => {
		const manager = SessionManager.inMemory();
		const userId = manager.appendMessage(userMsg("root"));
		manager.appendLabelChange(userId, "checkpoint");

		const rawTree = manager.getTree();
		projectTree(rawTree, buildToolCallMap(rawTree));
		const projectedLeafId = resolveProjectedLeafId(rawTree, manager.getLeafId());

		expect(projectedLeafId).toBe(userId);
	});

	test("preserves unknown message roles explicitly", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage({
			role: "mysteryRole",
			content: "mystery message",
			timestamp: Date.now(),
		} as never);

		const rawTree = manager.getTree();
		const projected = projectTree(rawTree, buildToolCallMap(rawTree));
		const mysteryNode = asMessageNode(projected[0]);

		expect(mysteryNode.role).toBe("unknown");
		expect(mysteryNode.rawRole).toBe("mysteryRole");
	});

	test("ignores malformed assistant content without throwing", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage(userMsg("root"));
		manager.appendMessage({
			role: "assistant",
			content: null,
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		} as never);

		const rawTree = manager.getTree();
		expect(() => {
			const toolCallMap = buildToolCallMap(rawTree);
			projectTree(rawTree, toolCallMap);
		}).not.toThrow();
	});
});

describe("extractText", () => {
	test("joins text blocks with spaces", () => {
		expect(
			extractText([
				{ type: "text", text: "hello" },
				{ type: "text", text: "world" },
			]),
		).toBe("hello world");
	});

	test("handles maxLen=0 for string and content arrays", () => {
		expect(extractText("hello", 0)).toBe("");
		expect(
			extractText(
				[
					{ type: "text", text: "hello" },
					{ type: "text", text: " world" },
				],
				0,
			),
		).toBe("");
	});
});

describe("projectNonMessageEntry", () => {
	function projectAll(manager: SessionManager): RpcTreeNode[] {
		const rawTree = manager.getTree();
		return projectTree(rawTree, buildToolCallMap(rawTree));
	}

	function findByType<T extends RpcTreeNode["type"]>(
		nodes: RpcTreeNode[],
		type: T,
	): Extract<RpcTreeNode, { type: T }> {
		const stack: RpcTreeNode[] = [...nodes];
		while (stack.length > 0) {
			const node = stack.pop()!;
			if (node.type === type) return node as Extract<RpcTreeNode, { type: T }>;
			for (let i = node.children.length - 1; i >= 0; i--) {
				stack.push(node.children[i]!);
			}
		}
		throw new Error(`No node with type "${type}" found`);
	}

	test("projects compaction entry with tokensBefore", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage(userMsg("hello"));
		manager.appendMessage(assistantMsg("world"));
		const firstEntryId = manager.getEntries()[0].id;
		manager.appendCompaction("summary text", firstEntryId, 50000);

		const node = findByType(projectAll(manager), "compaction");
		expect(node.tokensBefore).toBe(50000);
	});

	test("projects model_change entry with provider and modelId", () => {
		const manager = SessionManager.inMemory();
		manager.appendModelChange("anthropic", "claude-sonnet-4");

		const node = findByType(projectAll(manager), "model_change");
		expect(node.provider).toBe("anthropic");
		expect(node.modelId).toBe("claude-sonnet-4");
	});

	test("projects thinking_level_change entry with thinkingLevel", () => {
		const manager = SessionManager.inMemory();
		manager.appendThinkingLevelChange("high");

		const node = findByType(projectAll(manager), "thinking_level_change");
		expect(node.thinkingLevel).toBe("high");
	});

	test("projects branch_summary entry with summary text", () => {
		const manager = SessionManager.inMemory();
		const rootId = manager.appendMessage(userMsg("root"));
		manager.branchWithSummary(rootId, "abandoned this path");

		const node = findByType(projectAll(manager), "branch_summary");
		expect(node.summary).toBe("abandoned this path");
	});

	test("projects custom_message entry with customType and preview", () => {
		const manager = SessionManager.inMemory();
		manager.appendCustomMessageEntry("my-ext", "custom content here", true);

		const node = findByType(projectAll(manager), "custom_message");
		expect(node.customType).toBe("my-ext");
		expect(node.preview).toBe("custom content here");
	});
});

interface ParentViolation {
	nodeId: string;
	parentId: string | null;
	structuralParentId: string | null;
}

function collectParentViolations(nodes: RpcTreeNode[]): ParentViolation[] {
	const ids = collectIds(nodes);
	const violations: ParentViolation[] = [];
	const stack: Array<{ node: RpcTreeNode; structuralParentId: string | null }> = [];

	for (let i = nodes.length - 1; i >= 0; i--) {
		stack.push({ node: nodes[i], structuralParentId: null });
	}

	while (stack.length > 0) {
		const { node, structuralParentId } = stack.pop()!;
		if (node.parentId !== structuralParentId) {
			violations.push({ nodeId: node.id, parentId: node.parentId, structuralParentId });
		}
		if (node.parentId !== null && !ids.has(node.parentId)) {
			violations.push({ nodeId: node.id, parentId: node.parentId, structuralParentId });
		}
		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push({ node: node.children[i], structuralParentId: node.id });
		}
	}

	return violations;
}

function collectIds(nodes: RpcTreeNode[]): Set<string> {
	const ids = new Set<string>();
	const stack: RpcTreeNode[] = [...nodes];
	while (stack.length > 0) {
		const node = stack.pop()!;
		ids.add(node.id);
		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push(node.children[i]!);
		}
	}
	return ids;
}

function collectTypes(nodes: RpcTreeNode[]): string[] {
	const types: string[] = [];
	const stack: RpcTreeNode[] = [...nodes];
	while (stack.length > 0) {
		const node = stack.pop()!;
		types.push(node.type);
		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push(node.children[i]!);
		}
	}
	return types;
}

function collectToolResultPaths(nodes: RpcTreeNode[]): string[] {
	const paths: string[] = [];
	const stack: RpcTreeNode[] = [...nodes];
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (node.type === "tool_result" && node.toolArgs && typeof node.toolArgs.path === "string") {
			paths.push(node.toolArgs.path);
		}
		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push(node.children[i]!);
		}
	}
	return paths;
}
