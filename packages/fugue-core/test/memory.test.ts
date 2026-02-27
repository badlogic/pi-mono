import { beforeEach, describe, expect, it } from "vitest";
import { createTestCaller, TEST_SESSION } from "./helpers.js";

let caller: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
	caller = await createTestCaller();
});

describe("memory.recordDecision", () => {
	it("requires authentication", async () => {
		const anon = await createTestCaller(null);
		await expect(anon.memory.recordDecision({ title: "Use pgmq", decision: "pgmq" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("records a decision episode", async () => {
		const episode = await caller.memory.recordDecision({
			title: "Use pgmq over NATS",
			decision: "pgmq",
			context: "Evaluated queue solutions in April 2025",
			optionsConsidered: ["pgmq", "NATS", "Redis Streams"],
			rationale: "Runs inside Postgres, reduces operational complexity",
		});

		expect(episode.id).toBeTruthy();
		expect(episode.title).toBe("Use pgmq over NATS");
		expect(episode.decision).toBe("pgmq");
		expect(episode.optionsConsidered).toEqual(["pgmq", "NATS", "Redis Streams"]);
		expect(episode.authorId).toBe(TEST_SESSION.userId);
	});

	it("rejects empty title", async () => {
		await expect(caller.memory.recordDecision({ title: "", decision: "X" })).rejects.toThrow();
	});
});

describe("memory.list", () => {
	it("returns episodes in reverse chronological order", async () => {
		await caller.memory.recordDecision({ title: "First decision", decision: "A" });
		await caller.memory.recordDecision({ title: "Second decision", decision: "B" });

		const episodes = await caller.memory.list();
		expect(episodes.length).toBe(2);
		expect(episodes[0]!.title).toBe("Second decision");
	});

	it("returns empty array when no decisions", async () => {
		const episodes = await caller.memory.list();
		expect(episodes).toEqual([]);
	});
});

describe("memory.search", () => {
	it("finds decisions by title keyword", async () => {
		await caller.memory.recordDecision({ title: "Use pgmq over NATS", decision: "pgmq" });
		await caller.memory.recordDecision({ title: "Choose React for frontend", decision: "React" });

		const results = await caller.memory.search({ q: "pgmq" });
		expect(results.length).toBe(1);
		expect(results[0]!.title).toBe("Use pgmq over NATS");
	});

	it("finds decisions by rationale keyword", async () => {
		await caller.memory.recordDecision({
			title: "Backend framework",
			decision: "Hono",
			rationale: "minimal overhead and edge-compatible",
		});

		const results = await caller.memory.search({ q: "edge-compatible" });
		expect(results.length).toBe(1);
	});

	it("is case-insensitive", async () => {
		await caller.memory.recordDecision({ title: "Use PostgreSQL", decision: "postgres" });
		const results = await caller.memory.search({ q: "POSTGRESQL" });
		expect(results.length).toBe(1);
	});

	it("returns empty array for no matches", async () => {
		const results = await caller.memory.search({ q: "xyznotfound99" });
		expect(results).toEqual([]);
	});
});

describe("memory.catchUp", () => {
	it("returns recent activity", async () => {
		await caller.memory.recordDecision({ title: "Recent decision", decision: "X" });

		const items = await caller.memory.catchUp({ sinceDays: 1 });
		const decisions = items.filter((i) => i.type === "decision");
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		expect(decisions.some((d) => d.title === "Recent decision")).toBe(true);
	});

	it("returns items with correct structure", async () => {
		await caller.memory.recordDecision({ title: "Structured check", decision: "Y" });

		const items = await caller.memory.catchUp({ sinceDays: 1 });
		expect(items.length).toBeGreaterThan(0);

		for (const item of items) {
			expect(item.id).toBeTruthy();
			expect(item.title).toBeTruthy();
			expect(item.actorId).toBeTruthy();
			expect(item.timestamp).toBeInstanceOf(Date);
			expect(["node", "assumption", "investigation", "finding", "decision"]).toContain(item.type);
		}
	});
});
