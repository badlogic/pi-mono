import { beforeEach, describe, expect, it } from "vitest";
import { createTestCaller } from "./helpers.js";

let caller: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
	caller = await createTestCaller();
});

describe("assumptions.create", () => {
	it("creates an assumption on a node", async () => {
		const node = await caller.nodes.create({ type: "decision", title: "Decision" });
		const assumption = await caller.assumptions.create({
			graphNodeId: node.id,
			claim: "Users will pay for this",
		});

		expect(assumption.id).toBeTruthy();
		expect(assumption.graphNodeId).toBe(node.id);
		expect(assumption.claim).toBe("Users will pay for this");
		expect(assumption.confidence).toBe(0.5);
		expect(assumption.ownerId).toBe("user-test-123");
	});

	it("accepts full input", async () => {
		const node = await caller.nodes.create({ type: "decision", title: "D" });
		const assumption = await caller.assumptions.create({
			graphNodeId: node.id,
			claim: "Market is large",
			confidence: 0.8,
			evidence: "Industry report",
			verificationMethod: "survey",
			verifyByDays: 30,
		});

		expect(assumption.confidence).toBe(0.8);
		expect(assumption.evidence).toBe("Industry report");
		expect(assumption.verificationMethod).toBe("survey");
		expect(assumption.verifyByDate).toBeInstanceOf(Date);
	});
});

describe("assumptions.updateConfidence", () => {
	it("updates confidence on an assumption", async () => {
		const node = await caller.nodes.create({ type: "decision", title: "D" });
		const assumption = await caller.assumptions.create({
			graphNodeId: node.id,
			claim: "Claim",
		});

		const updated = await caller.assumptions.updateConfidence({
			id: assumption.id,
			confidence: 0.95,
		});
		expect(updated.confidence).toBe(0.95);
	});

	it("throws NOT_FOUND for ghost id", async () => {
		await expect(caller.assumptions.updateConfidence({ id: "ghost", confidence: 0.5 })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("assumptions.forNode", () => {
	it("returns all assumptions for a node", async () => {
		const node = await caller.nodes.create({ type: "decision", title: "D" });
		await caller.assumptions.create({ graphNodeId: node.id, claim: "A1" });
		await caller.assumptions.create({ graphNodeId: node.id, claim: "A2" });

		const assumptions = await caller.assumptions.forNode({ graphNodeId: node.id });
		expect(assumptions).toHaveLength(2);
	});

	it("does not return assumptions from other nodes", async () => {
		const n1 = await caller.nodes.create({ type: "decision", title: "N1" });
		const n2 = await caller.nodes.create({ type: "decision", title: "N2" });
		await caller.assumptions.create({ graphNodeId: n1.id, claim: "For N1" });
		await caller.assumptions.create({ graphNodeId: n2.id, claim: "For N2" });

		const n1Assumptions = await caller.assumptions.forNode({ graphNodeId: n1.id });
		expect(n1Assumptions).toHaveLength(1);
		expect(n1Assumptions[0]!.claim).toBe("For N1");
	});
});

describe("assumptions.markStale", () => {
	it("returns count of marked stale assumptions", async () => {
		const result = await caller.assumptions.markStale();
		expect(result.markedStale).toBeGreaterThanOrEqual(0);
	});
});
