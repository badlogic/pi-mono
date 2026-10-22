import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("export HTML deep session trees", () => {
	// Regression test for #11225.
	it("prepares and navigates a deep parent chain without overflowing the call stack", () => {
		const templateJs = readFileSync(new URL("../src/core/export-html/template.js", import.meta.url), "utf-8");
		const dataStructuresStart = templateJs.indexOf("// DATA STRUCTURES");
		const filteringStart = templateJs.indexOf("// FILTERING");
		expect(dataStructuresStart).toBeGreaterThan(-1);
		expect(filteringStart).toBeGreaterThan(dataStructuresStart);

		const depth = 20_000;
		const root = {
			id: "entry-0",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			type: "message",
			message: { role: "user", content: "" },
		};
		const newerSibling = {
			id: "newer-sibling",
			parentId: root.id,
			timestamp: "2026-01-01T00:00:02.000Z",
			type: "message",
			message: { role: "user", content: "" },
		};
		const parentChain = Array.from({ length: depth - 1 }, (_, index) => ({
			id: `entry-${index + 1}`,
			parentId: `entry-${index}`,
			timestamp: "2026-01-01T00:00:01.000Z",
			type: "message",
			message: { role: "user", content: "" },
		}));
		const entries = [root, newerSibling, ...parentChain];
		const treePreparationSource = templateJs.slice(dataStructuresStart, filteringStart);
		const context = { entries };

		runInNewContext(
			`${treePreparationSource}
			const targetId = "entry-${depth - 1}";
			const tree = buildTree();
			const activePathIds = buildActivePathIds(targetId);
			const flatNodes = flattenTree(tree, activePathIds);
			globalThis.result = {
				rootCount: tree.length,
				activeCount: activePathIds.size,
				flatCount: flatNodes.length,
				firstBranchId: flatNodes[1].node.entry.id,
				lastId: flatNodes.at(-1).node.entry.id,
				newestLeafId: findNewestLeaf("entry-0"),
			};`,
			context,
			{ timeout: 10_000 },
		);

		expect(context).toHaveProperty("result", {
			rootCount: 1,
			activeCount: depth,
			flatCount: depth + 1,
			firstBranchId: "entry-1",
			lastId: newerSibling.id,
			newestLeafId: newerSibling.id,
		});
	});
});
