import { beforeEach, describe, expect, it } from "vitest";
import { createTestCaller, TEST_SESSION } from "./helpers.js";

let caller: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
	caller = await createTestCaller();
});

describe("research.createInvestigation", () => {
	it("requires authentication", async () => {
		const anon = await createTestCaller(null);
		await expect(anon.research.createInvestigation({ question: "Q?" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("creates an investigation", async () => {
		const inv = await caller.research.createInvestigation({ question: "Is TypeScript worth it?" });

		expect(inv.id).toBeTruthy();
		expect(inv.question).toBe("Is TypeScript worth it?");
		expect(inv.investigatorId).toBe(TEST_SESSION.userId);
		expect(inv.status).toBe("open");
	});

	it("links to a graph node when graphNodeId provided", async () => {
		const node = await caller.nodes.create({ type: "investigation", title: "Research node" });

		const inv = await caller.research.createInvestigation({
			question: "Linked investigation?",
			graphNodeId: node.id,
		});
		expect(inv.graphNodeId).toBe(node.id);
	});

	it("rejects empty question", async () => {
		await expect(caller.research.createInvestigation({ question: "" })).rejects.toThrow();
	});
});

describe("research.conclude", () => {
	it("concludes an investigation", async () => {
		const inv = await caller.research.createInvestigation({ question: "Q?" });
		const concluded = await caller.research.conclude({ id: inv.id, conclusion: "Yes, it is." });

		expect(concluded.status).toBe("concluded");
		expect(concluded.conclusion).toBe("Yes, it is.");
	});

	it("throws NOT_FOUND for unknown id", async () => {
		await expect(caller.research.conclude({ id: "ghost", conclusion: "nothing" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("research.addFinding", () => {
	it("adds a finding to an investigation", async () => {
		const inv = await caller.research.createInvestigation({ question: "Q?" });
		const finding = await caller.research.addFinding({
			investigationId: inv.id,
			claim: "TypeScript reduces runtime errors",
			evidence: "Airbnb case study",
			confidence: 0.85,
		});

		expect(finding.investigationId).toBe(inv.id);
		expect(finding.claim).toBe("TypeScript reduces runtime errors");
		expect(finding.confidence).toBe(0.85);
		expect(finding.authorId).toBe(TEST_SESSION.userId);
	});

	it("validates confidence range", async () => {
		const inv = await caller.research.createInvestigation({ question: "Q?" });
		await expect(
			caller.research.addFinding({ investigationId: inv.id, claim: "X", confidence: 1.5 }),
		).rejects.toThrow();
	});
});

describe("research.findingsFor", () => {
	it("returns findings for an investigation", async () => {
		const inv = await caller.research.createInvestigation({ question: "Q?" });
		await caller.research.addFinding({ investigationId: inv.id, claim: "Finding A", confidence: 0.7 });
		await caller.research.addFinding({ investigationId: inv.id, claim: "Finding B", confidence: 0.9 });

		const findings = await caller.research.findingsFor({ investigationId: inv.id });
		expect(findings.length).toBe(2);
	});

	it("returns empty array for investigation with no findings", async () => {
		const inv = await caller.research.createInvestigation({ question: "Q?" });
		const findings = await caller.research.findingsFor({ investigationId: inv.id });
		expect(findings).toEqual([]);
	});
});

describe("research.list", () => {
	it("filters by status", async () => {
		const inv = await caller.research.createInvestigation({ question: "Open question" });
		await caller.research.conclude({ id: inv.id, conclusion: "Done" });
		await caller.research.createInvestigation({ question: "Still open" });

		const open = await caller.research.list({ status: "open" });
		expect(open.length).toBe(1);
		expect(open[0]!.question).toBe("Still open");
	});
});
