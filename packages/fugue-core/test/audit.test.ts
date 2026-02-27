import { beforeEach, describe, expect, it } from "vitest";
import { createTestCaller } from "./helpers.js";

let caller: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
	caller = await createTestCaller();
});

describe("audit.query", () => {
	it("returns all log entries", async () => {
		await caller.nodes.create({ type: "idea", title: "I1" });
		await caller.nodes.create({ type: "idea", title: "I2" });

		const log = await caller.audit.query();
		expect(log.length).toBe(2);
	});

	it("filters by action", async () => {
		const node = await caller.nodes.create({ type: "idea", title: "I" });
		await caller.nodes.update({ id: node.id, title: "Updated" });

		const creates = await caller.audit.query({ action: "node.create" });
		const updates = await caller.audit.query({ action: "node.update" });

		expect(creates.length).toBe(1);
		expect(updates.length).toBe(1);
	});

	it("filters by targetId", async () => {
		const n1 = await caller.nodes.create({ type: "idea", title: "N1" });
		await caller.nodes.create({ type: "idea", title: "N2" });

		const log = await caller.audit.query({ targetId: n1.id });
		expect(log.length).toBe(1);
		expect(log[0]!.targetId).toBe(n1.id);
	});

	it("respects limit", async () => {
		for (let i = 0; i < 5; i++) {
			await caller.nodes.create({ type: "idea", title: `N${i}` });
		}

		const log = await caller.audit.query({ limit: 3 });
		expect(log.length).toBe(3);
	});
});
