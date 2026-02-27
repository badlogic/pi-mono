import { beforeEach, describe, expect, it } from "vitest";
import { createTestCaller } from "./helpers.js";

let caller: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
	caller = await createTestCaller();
});

describe("nodes.create", () => {
	it("creates a node and returns it", async () => {
		const node = await caller.nodes.create({ type: "idea", title: "My first idea" });

		expect(node.id).toBeTruthy();
		expect(node.type).toBe("idea");
		expect(node.title).toBe("My first idea");
		expect(node.authorId).toBe("user-test-123");
		expect(node.status).toBe("active");
	});

	it("stores content", async () => {
		const node = await caller.nodes.create({
			type: "decision",
			title: "Use Postgres",
			content: { rationale: "ACID" },
		});
		expect(node.content).toEqual({ rationale: "ACID" });
	});

	it("throws UNAUTHORIZED when no session", async () => {
		const unauthCaller = await createTestCaller(null);
		await expect(unauthCaller.nodes.create({ type: "idea", title: "x" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});

describe("nodes.get", () => {
	it("returns an existing node", async () => {
		const created = await caller.nodes.create({ type: "idea", title: "Fetch me" });
		const found = await caller.nodes.get({ id: created.id });
		expect(found.id).toBe(created.id);
		expect(found.title).toBe("Fetch me");
	});

	it("throws NOT_FOUND for missing id", async () => {
		await expect(caller.nodes.get({ id: "ghost" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("nodes.update", () => {
	it("updates title", async () => {
		const node = await caller.nodes.create({ type: "idea", title: "Old" });
		const updated = await caller.nodes.update({ id: node.id, title: "New" });
		expect(updated.title).toBe("New");
	});

	it("updates content", async () => {
		const node = await caller.nodes.create({ type: "idea", title: "I" });
		const updated = await caller.nodes.update({ id: node.id, content: { key: "val" } });
		expect(updated.content).toEqual({ key: "val" });
	});

	it("throws NOT_FOUND for missing node", async () => {
		await expect(caller.nodes.update({ id: "ghost", title: "x" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("nodes.archive", () => {
	it("archives a node", async () => {
		const node = await caller.nodes.create({ type: "idea", title: "Archive me" });
		const archived = await caller.nodes.archive({ id: node.id });
		expect(archived.status).toBe("archived");
	});
});

describe("nodes.list", () => {
	it("returns all nodes", async () => {
		await caller.nodes.create({ type: "idea", title: "A" });
		await caller.nodes.create({ type: "decision", title: "B" });

		const nodes = await caller.nodes.list();
		expect(nodes.length).toBe(2);
	});

	it("filters by type", async () => {
		await caller.nodes.create({ type: "idea", title: "Idea" });
		await caller.nodes.create({ type: "decision", title: "Decision" });

		const ideas = await caller.nodes.list({ type: "idea" });
		expect(ideas.length).toBe(1);
		expect(ideas[0]!.type).toBe("idea");
	});

	it("filters by status", async () => {
		const n1 = await caller.nodes.create({ type: "idea", title: "Active" });
		const n2 = await caller.nodes.create({ type: "idea", title: "Archived" });
		await caller.nodes.archive({ id: n2.id });

		const active = await caller.nodes.list({ status: "active" });
		expect(active.every((n) => n.status === "active")).toBe(true);
		expect(active.map((n) => n.id)).toContain(n1.id);
		expect(active.map((n) => n.id)).not.toContain(n2.id);
	});
});

describe("nodes.createEdge + deleteEdge", () => {
	it("creates and deletes an edge", async () => {
		const a = await caller.nodes.create({ type: "idea", title: "A" });
		const b = await caller.nodes.create({ type: "idea", title: "B" });

		const edge = await caller.nodes.createEdge({
			sourceId: a.id,
			targetId: b.id,
			type: "supports",
		});

		expect(edge.sourceId).toBe(a.id);
		expect(edge.targetId).toBe(b.id);

		const from = await caller.nodes.edgesFrom({ sourceId: a.id });
		expect(from.length).toBe(1);

		const result = await caller.nodes.deleteEdge({ id: edge.id });
		expect(result.deleted).toBe(true);

		const fromAfter = await caller.nodes.edgesFrom({ sourceId: a.id });
		expect(fromAfter.length).toBe(0);
	});

	it("throws NOT_FOUND deleting nonexistent edge", async () => {
		await expect(caller.nodes.deleteEdge({ id: "ghost" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("nodes.edgesTo + edgesBetween", () => {
	it("returns edges to a node", async () => {
		const a = await caller.nodes.create({ type: "idea", title: "A" });
		const b = await caller.nodes.create({ type: "idea", title: "B" });
		await caller.nodes.createEdge({ sourceId: a.id, targetId: b.id, type: "builds_on" });

		const edges = await caller.nodes.edgesTo({ targetId: b.id });
		expect(edges.length).toBe(1);
		expect(edges[0]!.sourceId).toBe(a.id);
	});

	it("returns edges between two nodes in both directions", async () => {
		const a = await caller.nodes.create({ type: "idea", title: "A" });
		const b = await caller.nodes.create({ type: "idea", title: "B" });
		await caller.nodes.createEdge({ sourceId: a.id, targetId: b.id, type: "challenges" });
		await caller.nodes.createEdge({ sourceId: b.id, targetId: a.id, type: "supports" });

		const edges = await caller.nodes.edgesBetween({ nodeAId: a.id, nodeBId: b.id });
		expect(edges.length).toBe(2);
	});
});
