import { beforeAll, describe, expect, test } from "vitest";
import type {
	ModelChangeEntry,
	SessionEntry,
	SessionMessageEntry,
	SessionTreeNode,
} from "../src/core/session-manager.js";
import { TreeSelectorComponent } from "../src/modes/interactive/components/tree-selector.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

beforeAll(() => {
	initTheme("dark");
});

// Helper to create a user message entry
function userMessage(id: string, parentId: string | null, content: string): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message: { role: "user", content, timestamp: Date.now() },
	};
}

// Helper to create an assistant message entry
function assistantMessage(id: string, parentId: string | null, text: string): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		},
	};
}

// Helper to create a model_change entry
function modelChange(id: string, parentId: string | null): ModelChangeEntry {
	return {
		type: "model_change",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		provider: "anthropic",
		modelId: "claude-sonnet-4",
	};
}

// Helper to build a tree from entries using parentId relationships
function buildTree(entries: Array<SessionEntry>): SessionTreeNode[] {
	if (entries.length === 0) return [];

	const nodes: SessionTreeNode[] = entries.map((entry) => ({
		entry,
		children: [],
	}));

	const byId = new Map<string, SessionTreeNode>();
	for (const node of nodes) {
		byId.set(node.entry.id, node);
	}

	const roots: SessionTreeNode[] = [];
	for (const node of nodes) {
		if (node.entry.parentId === null) {
			roots.push(node);
		} else {
			const parent = byId.get(node.entry.parentId);
			if (parent) {
				parent.children.push(node);
			}
		}
	}
	return roots;
}

describe("TreeSelectorComponent", () => {
	describe("initial selection with metadata entries", () => {
		test("focuses nearest visible ancestor when currentLeafId is a model_change with sibling branch", () => {
			// Tree structure:
			// user-1
			// └── asst-1
			//     ├── user-2 (active branch)
			//     │   └── model-1 (model_change, CURRENT LEAF)
			//     └── user-3 (sibling branch, added later chronologically)
			const entries = [
				userMessage("user-1", null, "hello"),
				assistantMessage("asst-1", "user-1", "hi"),
				userMessage("user-2", "asst-1", "active branch"), // Active branch
				modelChange("model-1", "user-2"), // Current leaf (metadata)
				userMessage("user-3", "asst-1", "sibling branch"), // Sibling branch
			];
			const tree = buildTree(entries);

			const selector = new TreeSelectorComponent(
				tree,
				"model-1", // currentLeafId is the model_change entry
				24,
				() => {},
				() => {},
			);

			const list = selector.getTreeList();
			// Should focus on user-2 (parent of model-1), not user-3 (last item)
			expect(list.getSelectedNode()?.entry.id).toBe("user-2");
		});

		test("focuses nearest visible ancestor when currentLeafId is a thinking_level_change entry", () => {
			// Similar structure with thinking_level_change instead of model_change
			const entries = [
				userMessage("user-1", null, "hello"),
				assistantMessage("asst-1", "user-1", "hi"),
				userMessage("user-2", "asst-1", "active branch"),
				{
					type: "thinking_level_change" as const,
					id: "thinking-1",
					parentId: "user-2",
					timestamp: new Date().toISOString(),
					thinkingLevel: "high",
				},
				userMessage("user-3", "asst-1", "sibling branch"),
			];
			const tree = buildTree(entries);

			const selector = new TreeSelectorComponent(
				tree,
				"thinking-1",
				24,
				() => {},
				() => {},
			);

			const list = selector.getTreeList();
			expect(list.getSelectedNode()?.entry.id).toBe("user-2");
		});
	});

	describe("filter switching with parent traversal", () => {
		test("switches to nearest visible user message when changing to user-only filter", () => {
			// In user-only filter: [user-1, user-2, user-3]
			const entries = [
				userMessage("user-1", null, "hello"),
				assistantMessage("asst-1", "user-1", "hi"),
				userMessage("user-2", "asst-1", "active branch"),
				assistantMessage("asst-2", "user-2", "response"),
				userMessage("user-3", "asst-1", "sibling branch"),
			];
			const tree = buildTree(entries);

			const selector = new TreeSelectorComponent(
				tree,
				"asst-2",
				24,
				() => {},
				() => {},
			);

			const list = selector.getTreeList();
			expect(list.getSelectedNode()?.entry.id).toBe("asst-2");

			// Simulate Ctrl+U (user-only filter)
			selector.handleInput("\x15");

			// Should now be on user-2 (the parent user message), not user-3
			expect(list.getSelectedNode()?.entry.id).toBe("user-2");
		});

		test("returns to nearest visible ancestor when switching back to default filter", () => {
			// Same branching structure
			const entries = [
				userMessage("user-1", null, "hello"),
				assistantMessage("asst-1", "user-1", "hi"),
				userMessage("user-2", "asst-1", "active branch"),
				assistantMessage("asst-2", "user-2", "response"),
				userMessage("user-3", "asst-1", "sibling branch"),
			];
			const tree = buildTree(entries);

			const selector = new TreeSelectorComponent(
				tree,
				"asst-2",
				24,
				() => {},
				() => {},
			);

			const list = selector.getTreeList();
			expect(list.getSelectedNode()?.entry.id).toBe("asst-2");

			// Switch to user-only
			selector.handleInput("\x15"); // Ctrl+U
			expect(list.getSelectedNode()?.entry.id).toBe("user-2");

			// Switch back to default - should stay on user-2
			// (since that's what we navigated to via parent traversal)
			selector.handleInput("\x04"); // Ctrl+D
			expect(list.getSelectedNode()?.entry.id).toBe("user-2");
		});
	});

	describe("empty filter preservation", () => {
		test("preserves selection when switching to empty labeled filter and back", () => {
			// Tree with no labels
			const entries = [
				userMessage("user-1", null, "hello"),
				assistantMessage("asst-1", "user-1", "hi"),
				userMessage("user-2", "asst-1", "bye"),
				assistantMessage("asst-2", "user-2", "goodbye"),
			];
			const tree = buildTree(entries);

			const selector = new TreeSelectorComponent(
				tree,
				"asst-2",
				24,
				() => {},
				() => {},
			);

			const list = selector.getTreeList();
			expect(list.getSelectedNode()?.entry.id).toBe("asst-2");

			// Switch to labeled-only filter (no labels exist, so empty result)
			selector.handleInput("\x0c"); // Ctrl+L

			// The list should be empty, getSelectedNode returns undefined
			expect(list.getSelectedNode()).toBeUndefined();

			// Switch back to default filter
			selector.handleInput("\x04"); // Ctrl+D

			// Should restore to asst-2 (the selection before we switched to empty filter)
			expect(list.getSelectedNode()?.entry.id).toBe("asst-2");
		});

		test("preserves selection through multiple empty filter switches", () => {
			const entries = [userMessage("user-1", null, "hello"), assistantMessage("asst-1", "user-1", "hi")];
			const tree = buildTree(entries);

			const selector = new TreeSelectorComponent(
				tree,
				"asst-1",
				24,
				() => {},
				() => {},
			);

			const list = selector.getTreeList();
			expect(list.getSelectedNode()?.entry.id).toBe("asst-1");

			// Switch to labeled-only (empty) - Ctrl+L toggles labeled ↔ default
			selector.handleInput("\x0c"); // Ctrl+L -> labeled-only
			expect(list.getSelectedNode()).toBeUndefined();

			// Switch to default, then back to labeled-only
			selector.handleInput("\x0c"); // Ctrl+L -> default (toggle back)
			expect(list.getSelectedNode()?.entry.id).toBe("asst-1");

			selector.handleInput("\x0c"); // Ctrl+L -> labeled-only again
			expect(list.getSelectedNode()).toBeUndefined();

			// Switch back to default with Ctrl+D
			selector.handleInput("\x04"); // Ctrl+D
			expect(list.getSelectedNode()?.entry.id).toBe("asst-1");
		});
	});
});
