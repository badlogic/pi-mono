import { beforeEach, describe, expect, it } from "vitest";
import { createTestCaller, TEST_SESSION } from "./helpers.js";

let caller: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
	caller = await createTestCaller();
});

describe("competitions.create", () => {
	it("requires authentication", async () => {
		const anon = await createTestCaller(null);
		await expect(anon.competitions.create({ title: "Best DB" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("creates an active competition", async () => {
		const comp = await caller.competitions.create({
			title: "Best routing approach",
			description: "Compare three routing strategies",
			criteria: { speed: 0.4, reliability: 0.6 },
		});

		expect(comp.id).toBeTruthy();
		expect(comp.title).toBe("Best routing approach");
		expect(comp.status).toBe("active");
		expect(comp.winnerNodeId).toBeNull();
		expect(comp.authorId).toBe(TEST_SESSION.userId);
		expect(comp.criteria).toEqual({ speed: 0.4, reliability: 0.6 });
	});

	it("rejects empty title", async () => {
		await expect(caller.competitions.create({ title: "" })).rejects.toThrow();
	});
});

describe("competitions.get", () => {
	it("returns a competition by id", async () => {
		const comp = await caller.competitions.create({ title: "Find me" });
		const found = await caller.competitions.get({ id: comp.id });
		expect(found.id).toBe(comp.id);
	});

	it("throws NOT_FOUND for unknown id", async () => {
		await expect(caller.competitions.get({ id: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("competitions.addEntry and scoreEntry", () => {
	it("adds entries and scores them", async () => {
		const comp = await caller.competitions.create({ title: "DB Competition" });
		const nodeA = await caller.nodes.create({ type: "competition", title: "Approach A" });
		const nodeB = await caller.nodes.create({ type: "competition", title: "Approach B" });

		await caller.competitions.addEntry({ competitionId: comp.id, graphNodeId: nodeA.id, notes: "Fast" });
		const entryB = await caller.competitions.addEntry({
			competitionId: comp.id,
			graphNodeId: nodeB.id,
			notes: "Reliable",
		});

		await caller.competitions.scoreEntry({ entryId: entryB.id, score: 0.9 });

		const entries = await caller.competitions.entries({ competitionId: comp.id });
		expect(entries.length).toBe(2);
		const scored = entries.find((e) => e.id === entryB.id);
		expect(scored!.score).toBeCloseTo(0.9);
	});

	it("scoreEntry throws NOT_FOUND for unknown entry", async () => {
		await expect(caller.competitions.scoreEntry({ entryId: "ghost", score: 0.5 })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("rejects score outside 0-1", async () => {
		const comp = await caller.competitions.create({ title: "Comp" });
		const node = await caller.nodes.create({ type: "competition", title: "Entry" });
		const entry = await caller.competitions.addEntry({ competitionId: comp.id, graphNodeId: node.id });
		await expect(caller.competitions.scoreEntry({ entryId: entry.id, score: 1.5 })).rejects.toThrow();
	});
});

describe("competitions.conclude", () => {
	it("concludes a competition with a winner", async () => {
		const comp = await caller.competitions.create({ title: "Final showdown" });
		const winner = await caller.nodes.create({ type: "competition", title: "The winner" });

		const concluded = await caller.competitions.conclude({ id: comp.id, winnerNodeId: winner.id });

		expect(concluded.status).toBe("concluded");
		expect(concluded.winnerNodeId).toBe(winner.id);
		expect(concluded.concludedAt).toBeTruthy();
	});

	it("throws NOT_FOUND for unknown competition", async () => {
		await expect(caller.competitions.conclude({ id: "ghost", winnerNodeId: "x" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("competitions.list", () => {
	it("lists all competitions", async () => {
		await caller.competitions.create({ title: "Comp 1" });
		await caller.competitions.create({ title: "Comp 2" });

		const all = await caller.competitions.list();
		expect(all.length).toBe(2);
	});

	it("filters by status", async () => {
		const comp = await caller.competitions.create({ title: "To conclude" });
		await caller.competitions.create({ title: "Active one" });
		const winner = await caller.nodes.create({ type: "competition", title: "Winner" });
		await caller.competitions.conclude({ id: comp.id, winnerNodeId: winner.id });

		const active = await caller.competitions.list({ status: "active" });
		expect(active.length).toBe(1);
		expect(active[0]!.title).toBe("Active one");

		const concluded = await caller.competitions.list({ status: "concluded" });
		expect(concluded.length).toBe(1);
	});
});

describe("competitions.entries", () => {
	it("returns empty array for competition with no entries", async () => {
		const comp = await caller.competitions.create({ title: "Empty comp" });
		const entries = await caller.competitions.entries({ competitionId: comp.id });
		expect(entries).toEqual([]);
	});
});
