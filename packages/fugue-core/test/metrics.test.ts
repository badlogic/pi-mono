import { beforeEach, describe, expect, it } from "vitest";
import { createTestCaller, TEST_SESSION } from "./helpers.js";

let caller: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
	caller = await createTestCaller();
});

describe("metrics.record", () => {
	it("requires authentication", async () => {
		const anon = await createTestCaller(null);
		await expect(anon.metrics.record({ name: "coverage", value: 80 })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("records a metric", async () => {
		const metric = await caller.metrics.record({ name: "test_coverage", value: 94.2, unit: "%" });

		expect(metric.id).toBeTruthy();
		expect(metric.name).toBe("test_coverage");
		expect(metric.value).toBeCloseTo(94.2);
		expect(metric.unit).toBe("%");
		expect(metric.measuredBy).toBe(TEST_SESSION.userId);
		expect(metric.graphNodeId).toBeNull();
	});

	it("records metric linked to a graph node", async () => {
		const node = await caller.nodes.create({ type: "metric", title: "Coverage goal" });
		const metric = await caller.metrics.record({ name: "coverage", value: 90, graphNodeId: node.id });
		expect(metric.graphNodeId).toBe(node.id);
	});

	it("rejects empty name", async () => {
		await expect(caller.metrics.record({ name: "", value: 42 })).rejects.toThrow();
	});
});

describe("metrics.forNode", () => {
	it("returns metrics for a node", async () => {
		const node = await caller.nodes.create({ type: "metric", title: "Goal node" });
		await caller.metrics.record({ name: "velocity", value: 12, graphNodeId: node.id });
		await caller.metrics.record({ name: "quality", value: 0.95, graphNodeId: node.id });

		const metrics = await caller.metrics.forNode({ graphNodeId: node.id });
		expect(metrics.length).toBe(2);
		expect(metrics.every((m) => m.graphNodeId === node.id)).toBe(true);
	});

	it("returns empty array for node with no metrics", async () => {
		const node = await caller.nodes.create({ type: "idea", title: "No metrics" });
		const metrics = await caller.metrics.forNode({ graphNodeId: node.id });
		expect(metrics).toEqual([]);
	});
});

describe("metrics.list", () => {
	it("lists all metrics", async () => {
		await caller.metrics.record({ name: "a", value: 1 });
		await caller.metrics.record({ name: "b", value: 2 });

		const all = await caller.metrics.list();
		expect(all.length).toBe(2);
	});

	it("filters by name", async () => {
		await caller.metrics.record({ name: "velocity", value: 10 });
		await caller.metrics.record({ name: "coverage", value: 80 });

		const velocity = await caller.metrics.list({ name: "velocity" });
		expect(velocity.length).toBe(1);
		expect(velocity[0]!.name).toBe("velocity");
	});
});
