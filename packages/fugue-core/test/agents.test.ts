import { describe, expect, it } from "vitest";
import { createTestCaller } from "./helpers.js";

// ─── agents.spawn ─────────────────────────────────────────────────────────────

describe("agents.spawn", () => {
	it("creates an agent with a goal", async () => {
		const caller = await createTestCaller();
		const agent = await caller.agents.spawn({ goal: "Analyze the codebase" });

		expect(agent.id).toBeTruthy();
		expect(agent.goal).toBe("Analyze the codebase");
		expect(agent.status).toBe("pending");
		expect(agent.model).toBe("neuralwatt-large");
	});

	it("accepts optional fields", async () => {
		const caller = await createTestCaller();
		const agent = await caller.agents.spawn({
			goal: "Research competitors",
			model: "neuralwatt-small",
			budgetMaxJoules: 250,
			capabilities: { github: true },
		});

		expect(agent.model).toBe("neuralwatt-small");
		expect(agent.budgetMaxJoules).toBe(250);
		expect(agent.capabilities).toEqual({ github: true });
	});

	it("requires authentication", async () => {
		const caller = await createTestCaller(null);
		await expect(caller.agents.spawn({ goal: "Unauthorized" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("rejects empty goal", async () => {
		const caller = await createTestCaller();
		await expect(caller.agents.spawn({ goal: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

// ─── agents.getState ──────────────────────────────────────────────────────────

describe("agents.getState", () => {
	it("returns agent by id", async () => {
		const caller = await createTestCaller();
		const spawned = await caller.agents.spawn({ goal: "Fetch me" });
		const fetched = await caller.agents.getState({ id: spawned.id });

		expect(fetched.id).toBe(spawned.id);
		expect(fetched.goal).toBe("Fetch me");
	});

	it("throws NOT_FOUND for unknown id", async () => {
		const caller = await createTestCaller();
		await expect(caller.agents.getState({ id: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("requires authentication", async () => {
		const caller = await createTestCaller(null);
		await expect(caller.agents.getState({ id: "any" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

// ─── agents.list ──────────────────────────────────────────────────────────────

describe("agents.list", () => {
	it("returns all agents when no filter", async () => {
		const caller = await createTestCaller();
		await caller.agents.spawn({ goal: "Agent 1" });
		await caller.agents.spawn({ goal: "Agent 2" });

		const agents = await caller.agents.list();
		expect(agents.length).toBe(2);
	});

	it("filters by status", async () => {
		const caller = await createTestCaller();
		await caller.agents.spawn({ goal: "Pending" });
		const agent = await caller.agents.spawn({ goal: "To abort" });
		await caller.agents.abort({ id: agent.id });

		const pending = await caller.agents.list({ status: "pending" });
		expect(pending.length).toBe(1);
		expect(pending[0]!.goal).toBe("Pending");
	});

	it("requires authentication", async () => {
		const caller = await createTestCaller(null);
		await expect(caller.agents.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

// ─── agents.abort ─────────────────────────────────────────────────────────────

describe("agents.abort", () => {
	it("transitions agent to aborted", async () => {
		const caller = await createTestCaller();
		const agent = await caller.agents.spawn({ goal: "To be aborted" });
		const aborted = await caller.agents.abort({ id: agent.id });

		expect(aborted.status).toBe("aborted");
	});

	it("throws NOT_FOUND for unknown id", async () => {
		const caller = await createTestCaller();
		await expect(caller.agents.abort({ id: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("requires authentication", async () => {
		const caller = await createTestCaller(null);
		await expect(caller.agents.abort({ id: "any" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
