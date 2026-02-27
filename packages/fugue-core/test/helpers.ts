import { PGlite } from "@electric-sql/pglite";
import { InMemoryEventBus } from "@fugue/events";
import type { DrizzleDb } from "@fugue/graph";
import { drizzle } from "drizzle-orm/pglite";
import type { AppContext, Session } from "../src/context.js";
import { appRouter } from "../src/router/index.js";

const SCHEMA_SQL = `
	CREATE TABLE IF NOT EXISTS fugue_users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		role TEXT NOT NULL DEFAULT 'member',
		display_name TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_nodes (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		content JSONB NOT NULL DEFAULT '{}',
		author_id TEXT NOT NULL,
		author_type TEXT NOT NULL DEFAULT 'human',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		archived_at TIMESTAMPTZ,
		status TEXT NOT NULL DEFAULT 'active'
	);
	CREATE TABLE IF NOT EXISTS fugue_edges (
		id TEXT PRIMARY KEY,
		source_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
		target_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
		type TEXT NOT NULL,
		metadata JSONB,
		author_id TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_assumptions (
		id TEXT PRIMARY KEY,
		graph_node_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
		claim TEXT NOT NULL,
		confidence REAL NOT NULL DEFAULT 0.5,
		evidence TEXT NOT NULL DEFAULT '',
		owner_id TEXT NOT NULL,
		verification_method TEXT NOT NULL DEFAULT '',
		verify_by_date TIMESTAMPTZ,
		is_stale BOOLEAN NOT NULL DEFAULT FALSE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_audit_log (
		id BIGSERIAL PRIMARY KEY,
		actor_id TEXT NOT NULL,
		actor_type TEXT NOT NULL,
		action TEXT NOT NULL,
		target_type TEXT,
		target_id TEXT,
		detail JSONB,
		authority_chain TEXT[] NOT NULL DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE TABLE IF NOT EXISTS fugue_agents (
		id TEXT PRIMARY KEY,
		graph_node_id TEXT REFERENCES fugue_nodes(id) ON DELETE SET NULL,
		parent_agent_id TEXT,
		goal TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		model TEXT NOT NULL DEFAULT 'neuralwatt-large',
		budget_max_joules REAL,
		budget_consumed_joules REAL NOT NULL DEFAULT 0,
		capabilities JSONB NOT NULL DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

export const TEST_SESSION: Session = {
	userId: "user-test-123",
	email: "test@fugue.dev",
	role: "member",
};

export async function createTestCaller(session: Session | null = TEST_SESSION) {
	const { client, db } = await getSharedDb();
	await client.exec(TRUNCATE_SQL);

	const bus = new InMemoryEventBus();
	// pool is not used in unit tests (traversal is tested separately with mocks)
	const ctx: AppContext = {
		db,
		pool: null as unknown as AppContext["pool"],
		bus,
		session,
	};

	return appRouter.createCaller(ctx);
}
