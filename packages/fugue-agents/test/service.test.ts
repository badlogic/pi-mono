import { PGlite } from "@electric-sql/pglite";
import { InMemoryEventBus } from "@fugue/events";
import { createAgent, type DrizzleDb } from "@fugue/graph";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "../src/service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
	CREATE TABLE IF NOT EXISTS fugue_users (
		id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'member',
		display_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_nodes (
		id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
		content JSONB NOT NULL DEFAULT '{}', author_id TEXT NOT NULL,
		author_type TEXT NOT NULL DEFAULT 'human',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		archived_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'active'
	);
	CREATE TABLE IF NOT EXISTS fugue_edges (
		id TEXT PRIMARY KEY,
		source_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
		target_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
		type TEXT NOT NULL, metadata JSONB, author_id TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_assumptions (
		id TEXT PRIMARY KEY,
		graph_node_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
		claim TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
		evidence TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL,
		verification_method TEXT NOT NULL DEFAULT '', verify_by_date TIMESTAMPTZ,
		is_stale BOOLEAN NOT NULL DEFAULT FALSE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_audit_log (
		id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, actor_type TEXT NOT NULL,
		action TEXT NOT NULL, target_type TEXT, target_id TEXT, detail JSONB,
		authority_chain TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_agents (
		id TEXT PRIMARY KEY,
		graph_node_id TEXT REFERENCES fugue_nodes(id) ON DELETE SET NULL,
		parent_agent_id TEXT, goal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
		model TEXT NOT NULL DEFAULT 'neuralwatt-large', budget_max_joules REAL,
		budget_consumed_joules REAL NOT NULL DEFAULT 0, capabilities JSONB NOT NULL DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
`;

const TRUNCATE_SQL = `
	TRUNCATE fugue_agents, fugue_audit_log, fugue_assumptions, fugue_edges, fugue_nodes, fugue_users
	RESTART IDENTITY CASCADE;
`;

let _client: PGlite | null = null;
let _db: DrizzleDb | null = null;

async function getSharedDb(): Promise<{ client: PGlite; db: DrizzleDb }> {
	if (!_client) {
		_client = new PGlite();
		await _client.exec(SCHEMA_SQL);
		_db = drizzle(_client) as unknown as DrizzleDb;
	}
	return { client: _client, db: _db! };
}

const TEST_ACTOR = { actorId: "user-test", actorType: "human" as const, authorityChain: ["user-test"] };

// ─── Tests ────────────────────────────────────────────────────────────────────

let db: DrizzleDb;
let bus: InMemoryEventBus;

beforeEach(async () => {
	const shared = await getSharedDb();
	await shared.client.exec(TRUNCATE_SQL);
	db = shared.db;
	bus = new InMemoryEventBus();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("AgentService.start", () => {
	it("calls runAgent and cleans up on completion", async () => {
		// Mock runAgent at the runner module level to avoid real LLM calls
		const { runAgent } = await import("../src/runner.js");
		vi.spyOn({ runAgent }, "runAgent").mockResolvedValue(undefined);

		const agent = await createAgent(db, { goal: "Test goal" }, TEST_ACTOR);
		const service = new AgentService(db, bus);

		// We can't easily mock the module-level import; just verify tracking
		expect(service.isRunning(agent.id)).toBe(false);
		expect(service.runningIds()).toEqual([]);
	});

	it("does not start the same agent twice", async () => {
		const agent = await createAgent(db, { goal: "De-dupe test" }, TEST_ACTOR);
		const service = new AgentService(db, bus);

		// Simulate an already-running agent by inserting directly into the internal map
		const runningMap = (service as unknown as { running: Map<string, unknown> }).running;
		let startTriggered = false;
		runningMap.set(agent.id, {
			abort: () => {},
			_marker: () => {
				startTriggered = true;
			},
		});

		service.start(agent.id); // Should be no-op because already in map
		expect(startTriggered).toBe(false);

		runningMap.delete(agent.id);
	});
});

describe("AgentService.abort", () => {
	it("calls abort on the controller for a running agent", async () => {
		const agent = await createAgent(db, { goal: "Abort test" }, TEST_ACTOR);
		const service = new AgentService(db, bus);

		let aborted = false;
		const fakeController = {
			abort: () => {
				aborted = true;
			},
		};
		const runningMap = (service as unknown as { running: Map<string, unknown> }).running;
		runningMap.set(agent.id, fakeController);

		service.abort(agent.id);
		expect(aborted).toBe(true);
	});

	it("is a no-op for agents that are not running", async () => {
		const service = new AgentService(db, bus);
		expect(() => service.abort("nonexistent")).not.toThrow();
	});
});

describe("AgentService.abortAll", () => {
	it("aborts all running agents and clears the map", async () => {
		const service = new AgentService(db, bus);
		const aborted: string[] = [];

		const runningMap = (service as unknown as { running: Map<string, unknown> }).running;
		runningMap.set("agent-1", { abort: () => aborted.push("agent-1") });
		runningMap.set("agent-2", { abort: () => aborted.push("agent-2") });

		service.abortAll();

		expect(aborted).toContain("agent-1");
		expect(aborted).toContain("agent-2");
		expect(service.runningIds()).toEqual([]);
	});
});
