/**
 * Unit tests for the RPC tree projection.
 *
 * Tests the pure function logic that maps SessionTreeNode → RpcTreeNode.
 * Uses SessionManager.inMemory() to build realistic tree structures
 * without file I/O or API keys.
 */

import { describe, expect, test } from "vitest";
import { SessionManager } from "../src/core/session-manager.js";
import { buildToolCallMap, extractText, projectTree } from "../src/modes/rpc/rpc-tree-projection.js";
import type { RpcTreeNode } from "../src/modes/rpc/rpc-types.js";
import {
	abortedAssistantMsg,
	assistantMsg,
	assistantToolCallMsg,
	bashExecMsg,
	errorAssistantMsg,
	toolResultMsg,
	userMsg,
} from "./utilities.js";

// ============================================================================
// Typed narrowing helpers for RpcTreeNode discriminated union
// ============================================================================

type RpcMessageNode = Extract<RpcTreeNode, { type: "message" }>;
type RpcToolResultNode = Extract<RpcTreeNode, { type: "tool_result" }>;

/** Narrow an RpcTreeNode to a message node, failing the test if the type is wrong. */
function asMessageNode(node: RpcTreeNode): RpcMessageNode {
	expect(node.type).toBe("message");
	return node as RpcMessageNode;
}

/** Narrow an RpcTreeNode to a tool_result node, failing the test if the type is wrong. */
function asToolResultNode(node: RpcTreeNode): RpcToolResultNode {
	expect(node.type).toBe("tool_result");
	return node as RpcToolResultNode;
}

describe("RPC tree projection", () => {
	test("user message produces type 'message' with role and preview", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Hello world from user"));

		const tree = sm.getTree();
		const toolCallMap = buildToolCallMap(tree);
		const projected = projectTree(tree, toolCallMap, false);

		expect(projected).toHaveLength(1);
		const node = asMessageNode(projected[0]);
		expect(node.role).toBe("user");
		expect(node.preview).toBe("Hello world from user");
	});

	test("assistant message includes stopReason", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Hi"));
		sm.appendMessage(assistantMsg("Hello back"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		expect(projected).toHaveLength(1);
		const assistantNode = asMessageNode(projected[0].children[0]);
		expect(assistantNode.role).toBe("assistant");
		expect(assistantNode.stopReason).toBe("stop");
		expect(assistantNode.preview).toBe("Hello back");
	});

	test("tool result resolves toolName, toolArgs, formattedToolCall from toolCallMap", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Read a file"));
		sm.appendMessage(assistantToolCallMsg("tc-1", "read", { path: "/tmp/test.ts" }));
		sm.appendMessage(toolResultMsg("tc-1"));

		const tree = sm.getTree();
		const toolCallMap = buildToolCallMap(tree);
		const projected = projectTree(tree, toolCallMap, false);

		// user -> assistant -> toolResult
		const tr = asToolResultNode(projected[0].children[0].children[0]);
		expect(tr.toolName).toBe("read");
		expect(tr.toolArgs).toEqual({ path: "/tmp/test.ts" });
		expect(tr.formattedToolCall).toContain("[read:");
		expect(tr.preview).toContain("[read:");
	});

	test("tool result with missing toolCall falls back to message toolName", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Do something"));
		// Tool result without a matching assistant toolCall
		sm.appendMessage(toolResultMsg("nonexistent-tc", "myTool"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		// Falls back to the toolName from the tool result message itself
		const tr = asToolResultNode(projected[0].children[0]);
		expect(tr.toolName).toBe("myTool");
		// No toolArgs or formattedToolCall without the matching assistant toolCall
		expect(tr.toolArgs).toBeUndefined();
		expect(tr.formattedToolCall).toBeUndefined();
		expect(tr.preview).toBe("[myTool]");
	});

	test("includeContent toggle — preview always present, content conditional", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Some user content here"));

		const tree = sm.getTree();
		const toolCallMap = buildToolCallMap(tree);

		// Without content
		const withoutContent = asMessageNode(projectTree(tree, toolCallMap, false)[0]);
		expect(withoutContent.preview).toBe("Some user content here");
		expect(withoutContent.content).toBeUndefined();

		// With content
		const withContent = asMessageNode(projectTree(tree, toolCallMap, true)[0]);
		expect(withContent.preview).toBe("Some user content here");
		expect(withContent.content).toBe("Some user content here");
	});

	test("label entries filtered from output, label resolved on target node", () => {
		const sm = SessionManager.inMemory();
		const userId = sm.appendMessage(userMsg("First message"));
		sm.appendMessage(assistantMsg("Response"));
		sm.appendLabelChange(userId, "checkpoint-1");

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		// label entry should not appear as a tree node
		const allTypes = collectAllTypes(projected);
		expect(allTypes).not.toContain("label");

		// The user message node should have the label
		expect(projected[0].label).toBe("checkpoint-1");
	});

	test("parent links stay consistent when filtered metadata nodes are removed", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Root user"));
		const assistantId = sm.appendMessage(assistantMsg("Root assistant"));
		sm.appendLabelChange(assistantId, "checkpoint");
		sm.appendMessage(userMsg("User under filtered label node"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);
		const violations = collectParentLinkViolations(projected);

		// Regression guard: parentId must align with structural parent after metadata filtering
		expect(violations).toEqual([]);
	});

	test("preview normalizes whitespace (newlines, tabs, leading/trailing spaces)", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Hello\n\tworld\n  with   spaces  "));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		const node = asMessageNode(projected[0]);
		// Newlines/tabs replaced with spaces, then trimmed (matches TUI normalize behavior)
		// Multiple consecutive spaces are preserved — only \n and \t are replaced
		expect(node.preview).toBe("Hello  world   with   spaces");
	});

	test("content is NOT normalized when includeContent is true", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Hello\n\tworld"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), true);

		const node = asMessageNode(projected[0]);
		// Content preserves raw text
		expect(node.content).toBe("Hello\n\tworld");
		// Preview normalizes: \n→space, \t→space (consecutive spaces preserved)
		expect(node.preview).toBe("Hello  world");
	});

	test("aborted assistant message has meaningful preview fallback", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Hi"));
		sm.appendMessage(abortedAssistantMsg());

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		const assistantNode = asMessageNode(projected[0].children[0]);
		expect(assistantNode.role).toBe("assistant");
		expect(assistantNode.stopReason).toBe("aborted");
		// Should show a meaningful fallback, not empty string
		expect(assistantNode.preview).toBe("(aborted)");
	});

	test("error assistant message shows error in preview", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Hi"));
		sm.appendMessage(errorAssistantMsg("Connection timeout after 30s"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		const assistantNode = asMessageNode(projected[0].children[0]);
		expect(assistantNode.role).toBe("assistant");
		expect(assistantNode.errorMessage).toBe("Connection timeout after 30s");
		// Preview should show the error message
		expect(assistantNode.preview).toBe("Connection timeout after 30s");
	});

	test("assistant message with no text and no special state shows fallback", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Hi"));
		sm.appendMessage(assistantToolCallMsg("tc-1", "read", { path: "/tmp/f.ts" }));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		const assistantNode = asMessageNode(projected[0].children[0]);
		expect(assistantNode.role).toBe("assistant");
		// Tool-call-only assistant: no text but not an error — show fallback
		expect(assistantNode.preview).toBe("(no content)");
	});

	test("bashExecution message shows command in preview", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Run a command"));
		sm.appendMessage(bashExecMsg("ls -la /tmp"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		const bashNode = asMessageNode(projected[0].children[0]);
		expect(bashNode.role).toBe("bashExecution");
		expect(bashNode.preview).toBe("[bash]: ls -la /tmp");
	});

	test("bashExecution preview normalizes multiline commands", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("Run"));
		sm.appendMessage(bashExecMsg("echo hello\n\techo world"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		const bashNode = asMessageNode(projected[0].children[0]);
		// Newlines/tabs replaced with spaces (consecutive spaces preserved)
		expect(bashNode.preview).toBe("[bash]: echo hello  echo world");
	});

	test("tree structure preserved — children and depth", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(userMsg("User 1"));
		const a1Id = sm.appendMessage(assistantMsg("Asst 1"));
		sm.appendMessage(userMsg("User 2"));
		sm.appendMessage(assistantMsg("Asst 2"));

		// Branch from a1
		sm.branch(a1Id);
		sm.appendMessage(userMsg("User 3 (branch)"));

		const tree = sm.getTree();
		const projected = projectTree(tree, buildToolCallMap(tree), false);

		// Root: user1
		expect(projected).toHaveLength(1);
		expect(asMessageNode(projected[0]).preview).toBe("User 1");

		// user1 -> asst1, which has 2 children (user2 and user3-branch)
		const asst1 = projected[0].children[0];
		expect(asst1.children).toHaveLength(2);
	});
});

describe("extractText", () => {
	test("returns full string when maxLen is undefined", () => {
		expect(extractText("hello world")).toBe("hello world");
	});

	test("truncates string to maxLen", () => {
		expect(extractText("hello world", 5)).toBe("hello");
	});

	test("returns empty string when maxLen is 0", () => {
		// Regression: maxLen=0 is falsy — must not fall through to "no limit"
		expect(extractText("hello world", 0)).toBe("");
	});

	test("extracts text from content block array", () => {
		const content = [
			{ type: "text", text: "hello " },
			{ type: "text", text: "world" },
		];
		expect(extractText(content)).toBe("hello world");
	});

	test("truncates content block array to maxLen", () => {
		const content = [
			{ type: "text", text: "hello " },
			{ type: "text", text: "world" },
		];
		expect(extractText(content, 8)).toBe("hello wo");
	});

	test("returns empty string for content block array when maxLen is 0", () => {
		const content = [{ type: "text", text: "hello" }];
		// Regression: maxLen=0 is falsy — must not accumulate text
		expect(extractText(content, 0)).toBe("");
	});

	test("skips non-text content blocks", () => {
		const content = [
			{ type: "image", source: "data:..." },
			{ type: "text", text: "hello" },
			{ type: "toolCall", id: "tc-1", name: "read" },
		];
		expect(extractText(content)).toBe("hello");
	});

	test("returns empty string for non-string non-array content", () => {
		// Cast to test defensive behavior against unexpected runtime values
		expect(extractText(42 as never)).toBe("");
		expect(extractText(null)).toBe("");
		expect(extractText(undefined)).toBe("");
	});
});

interface ParentLinkViolation {
	nodeId: string;
	structuralParentId: string | null;
	parentId: string | null;
	reason: "root_parent_not_null" | "parent_mismatch" | "missing_parent";
}

/** Collect parent/child linkage violations from a projected RPC tree. */
function collectParentLinkViolations(nodes: RpcTreeNode[]): ParentLinkViolation[] {
	const allIds = collectAllIds(nodes);
	const violations: ParentLinkViolation[] = [];

	const walk = (currentNodes: RpcTreeNode[], structuralParentId: string | null) => {
		for (const node of currentNodes) {
			if (structuralParentId === null && node.parentId !== null) {
				violations.push({
					nodeId: node.id,
					structuralParentId,
					parentId: node.parentId,
					reason: "root_parent_not_null",
				});
			} else if (structuralParentId !== null && node.parentId !== structuralParentId) {
				violations.push({
					nodeId: node.id,
					structuralParentId,
					parentId: node.parentId,
					reason: "parent_mismatch",
				});
			}

			if (node.parentId !== null && !allIds.has(node.parentId)) {
				violations.push({
					nodeId: node.id,
					structuralParentId,
					parentId: node.parentId,
					reason: "missing_parent",
				});
			}

			walk(node.children, node.id);
		}
	};

	walk(nodes, null);
	return violations;
}

/** Recursively collect all node IDs from a tree */
function collectAllIds(nodes: RpcTreeNode[]): Set<string> {
	const ids = new Set<string>();
	for (const node of nodes) {
		ids.add(node.id);
		for (const childId of collectAllIds(node.children)) {
			ids.add(childId);
		}
	}
	return ids;
}

/** Recursively collect all type values from a tree */
function collectAllTypes(nodes: RpcTreeNode[]): string[] {
	const types: string[] = [];
	for (const node of nodes) {
		types.push(node.type);
		types.push(...collectAllTypes(node.children));
	}
	return types;
}
