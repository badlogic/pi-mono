import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { DrizzleDb } from "../src/graph.js";

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
`;

const TRUNCATE_SQL = `
	TRUNCATE fugue_audit_log, fugue_assumptions, fugue_edges, fugue_nodes, fugue_users
	RESTART IDENTITY CASCADE;
`;

// Singleton PGlite instance shared across all tests in a file for speed.
// Tables are truncated between tests via resetDb().
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

/**
 * Returns the shared test database, with all tables truncated.
 * Sharing the PGlite instance avoids the ~800ms startup cost per test.
 *
 * Call in beforeEach:
 *   beforeEach(async () => { ({ db } = await createTestDb()); });
 */
export async function createTestDb(): Promise<{ db: DrizzleDb; cleanup: () => Promise<void> }> {
	const { client, db } = await getSharedDb();
	await client.exec(TRUNCATE_SQL);
	return {
		db,
		cleanup: async () => {
			// No-op: we keep the instance alive between tests; final teardown is
			// handled automatically when the process exits.
		},
	};
}

export const TEST_ACTOR = {
	actorId: "user-test-123",
	actorType: "human" as const,
	authorityChain: ["user-test-123"],
};
