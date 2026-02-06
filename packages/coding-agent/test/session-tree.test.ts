import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.js";
import { buildSessionTree, buildTreePrefix, flattenSessionTree } from "../src/core/session-tree.js";

function makeSession(overrides: Partial<SessionInfo> & { id: string; path: string }): SessionInfo {
	return {
		path: overrides.path,
		id: overrides.id,
		cwd: overrides.cwd ?? "",
		name: overrides.name,
		parentSessionPath: overrides.parentSessionPath,
		created: overrides.created ?? new Date(0),
		modified: overrides.modified ?? new Date(0),
		messageCount: overrides.messageCount ?? 1,
		firstMessage: overrides.firstMessage ?? "(no messages)",
		allMessagesText: overrides.allMessagesText ?? "",
	};
}

describe("session tree", () => {
	describe("buildSessionTree", () => {
		it("builds flat list for sessions with no parents", () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "a", path: "/tmp/a.jsonl", modified: new Date("2026-01-03") }),
				makeSession({ id: "b", path: "/tmp/b.jsonl", modified: new Date("2026-01-02") }),
				makeSession({ id: "c", path: "/tmp/c.jsonl", modified: new Date("2026-01-01") }),
			];

			const tree = buildSessionTree(sessions);

			expect(tree).toHaveLength(3);
			expect(tree[0]!.info.id).toBe("a"); // Most recent first
			expect(tree[1]!.info.id).toBe("b");
			expect(tree[2]!.info.id).toBe("c");
			expect(tree[0]!.children).toHaveLength(0);
		});

		it("builds tree with parent-child relationships", () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "parent", path: "/tmp/parent.jsonl", modified: new Date("2026-01-01") }),
				makeSession({
					id: "child1",
					path: "/tmp/child1.jsonl",
					parentSessionPath: "/tmp/parent.jsonl",
					modified: new Date("2026-01-03"),
				}),
				makeSession({
					id: "child2",
					path: "/tmp/child2.jsonl",
					parentSessionPath: "/tmp/parent.jsonl",
					modified: new Date("2026-01-02"),
				}),
			];

			const tree = buildSessionTree(sessions);

			expect(tree).toHaveLength(1); // Only parent is root
			expect(tree[0]!.info.id).toBe("parent");
			expect(tree[0]!.children).toHaveLength(2);
			expect(tree[0]!.children[0]!.info.id).toBe("child1"); // Most recent child first
			expect(tree[0]!.children[1]!.info.id).toBe("child2");
		});

		it("handles orphaned children (parent missing)", () => {
			const sessions: SessionInfo[] = [
				makeSession({
					id: "orphan",
					path: "/tmp/orphan.jsonl",
					parentSessionPath: "/tmp/missing.jsonl",
					modified: new Date("2026-01-01"),
				}),
			];

			const tree = buildSessionTree(sessions);

			expect(tree).toHaveLength(1); // Orphan becomes root
			expect(tree[0]!.info.id).toBe("orphan");
			expect(tree[0]!.children).toHaveLength(0);
		});

		it("builds multi-level tree", () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "root", path: "/tmp/root.jsonl", modified: new Date("2026-01-01") }),
				makeSession({
					id: "child",
					path: "/tmp/child.jsonl",
					parentSessionPath: "/tmp/root.jsonl",
					modified: new Date("2026-01-02"),
				}),
				makeSession({
					id: "grandchild",
					path: "/tmp/grandchild.jsonl",
					parentSessionPath: "/tmp/child.jsonl",
					modified: new Date("2026-01-03"),
				}),
			];

			const tree = buildSessionTree(sessions);

			expect(tree).toHaveLength(1);
			expect(tree[0]!.info.id).toBe("root");
			expect(tree[0]!.children).toHaveLength(1);
			expect(tree[0]!.children[0]!.info.id).toBe("child");
			expect(tree[0]!.children[0]!.children).toHaveLength(1);
			expect(tree[0]!.children[0]!.children[0]!.info.id).toBe("grandchild");
		});
	});

	describe("flattenSessionTree", () => {
		it("flattens single root", () => {
			const sessions: SessionInfo[] = [makeSession({ id: "root", path: "/tmp/root.jsonl" })];
			const tree = buildSessionTree(sessions);
			const flat = flattenSessionTree(tree);

			expect(flat).toHaveLength(1);
			expect(flat[0]!.info.id).toBe("root");
			expect(flat[0]!.depth).toBe(0);
			expect(flat[0]!.isLast).toBe(true);
			expect(flat[0]!.ancestorContinues).toEqual([]);
		});

		it("flattens tree with children", () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "root", path: "/tmp/root.jsonl" }),
				makeSession({ id: "child1", path: "/tmp/child1.jsonl", parentSessionPath: "/tmp/root.jsonl" }),
				makeSession({ id: "child2", path: "/tmp/child2.jsonl", parentSessionPath: "/tmp/root.jsonl" }),
			];
			const tree = buildSessionTree(sessions);
			const flat = flattenSessionTree(tree);

			expect(flat).toHaveLength(3);

			// Root
			expect(flat[0]!.info.id).toBe("root");
			expect(flat[0]!.depth).toBe(0);
			expect(flat[0]!.isLast).toBe(true);

			// Child 1 (first child, not last)
			expect(flat[1]!.info.id).toBe("child1");
			expect(flat[1]!.depth).toBe(1);
			expect(flat[1]!.isLast).toBe(false);

			// Child 2 (last child)
			expect(flat[2]!.info.id).toBe("child2");
			expect(flat[2]!.depth).toBe(1);
			expect(flat[2]!.isLast).toBe(true);
		});

		it("preserves ancestor continuation info", () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "root", path: "/tmp/root.jsonl" }),
				makeSession({ id: "child", path: "/tmp/child.jsonl", parentSessionPath: "/tmp/root.jsonl" }),
				makeSession({ id: "grandchild", path: "/tmp/grandchild.jsonl", parentSessionPath: "/tmp/child.jsonl" }),
			];
			const tree = buildSessionTree(sessions);
			const flat = flattenSessionTree(tree);

			// Grandchild should have continuation info from child
			expect(flat[2]!.info.id).toBe("grandchild");
			expect(flat[2]!.depth).toBe(2);
			expect(flat[2]!.ancestorContinues).toEqual([false, false]);
		});
	});

	describe("buildTreePrefix", () => {
		it("returns empty string for root nodes", () => {
			const node = {
				info: makeSession({ id: "root", path: "/tmp/root.jsonl" }),
				depth: 0,
				isLast: true,
				ancestorContinues: [],
			};

			expect(buildTreePrefix(node)).toBe("");
		});

		it("returns branch for last child", () => {
			const node = {
				info: makeSession({ id: "child", path: "/tmp/child.jsonl" }),
				depth: 1,
				isLast: true,
				ancestorContinues: [false],
			};

			expect(buildTreePrefix(node)).toBe("   └─ ");
		});

		it("returns branch for non-last child", () => {
			const node = {
				info: makeSession({ id: "child", path: "/tmp/child.jsonl" }),
				depth: 1,
				isLast: false,
				ancestorContinues: [false],
			};

			expect(buildTreePrefix(node)).toBe("   ├─ ");
		});

		it("builds prefix with continuation lines", () => {
			const node = {
				info: makeSession({ id: "grandchild", path: "/tmp/grandchild.jsonl" }),
				depth: 2,
				isLast: true,
				ancestorContinues: [true, false],
			};

			expect(buildTreePrefix(node)).toBe("│     └─ ");
		});

		it("builds prefix without continuation lines", () => {
			const node = {
				info: makeSession({ id: "grandchild", path: "/tmp/grandchild.jsonl" }),
				depth: 2,
				isLast: false,
				ancestorContinues: [false, false],
			};

			expect(buildTreePrefix(node)).toBe("      ├─ ");
		});
	});
});
