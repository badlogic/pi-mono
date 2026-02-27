import type { Pool } from "pg";

/**
 * Runs all migrations in order. Safe to call on every startup — idempotent.
 */
export async function runMigrations(pool: Pool): Promise<void> {
	const client = await pool.connect();
	try {
		// Ensure migration tracking table exists
		await client.query(`
			CREATE TABLE IF NOT EXISTS fugue_migrations (
				id TEXT PRIMARY KEY,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		for (const migration of MIGRATIONS) {
			const result = await client.query("SELECT id FROM fugue_migrations WHERE id = $1", [migration.id]);
			if (result.rows.length > 0) continue; // already applied

			await client.query("BEGIN");
			try {
				await client.query(migration.sql);
				await client.query("INSERT INTO fugue_migrations (id) VALUES ($1)", [migration.id]);
				await client.query("COMMIT");
			} catch (err) {
				await client.query("ROLLBACK");
				throw new Error(`Migration ${migration.id} failed: ${err}`);
			}
		}
	} finally {
		client.release();
	}
}

interface Migration {
	id: string;
	sql: string;
}

const MIGRATIONS: Migration[] = [
	{
		id: "001_initial_schema",
		sql: `
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

			CREATE INDEX IF NOT EXISTS idx_fugue_nodes_type ON fugue_nodes(type);
			CREATE INDEX IF NOT EXISTS idx_fugue_nodes_author ON fugue_nodes(author_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_nodes_status ON fugue_nodes(status);
			CREATE INDEX IF NOT EXISTS idx_fugue_nodes_created ON fugue_nodes(created_at DESC);

			CREATE TABLE IF NOT EXISTS fugue_edges (
				id TEXT PRIMARY KEY,
				source_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
				target_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
				type TEXT NOT NULL,
				metadata JSONB,
				author_id TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE INDEX IF NOT EXISTS idx_fugue_edges_source ON fugue_edges(source_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_edges_target ON fugue_edges(target_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_edges_type ON fugue_edges(type);

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

			CREATE INDEX IF NOT EXISTS idx_fugue_audit_actor ON fugue_audit_log(actor_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_audit_target ON fugue_audit_log(target_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_audit_action ON fugue_audit_log(action);
			CREATE INDEX IF NOT EXISTS idx_fugue_audit_created ON fugue_audit_log(created_at DESC);
		`,
	},
	{
		id: "002_fts_search",
		sql: `
			ALTER TABLE fugue_nodes ADD COLUMN IF NOT EXISTS search_vector tsvector
				GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || coalesce(content::text, ''))) STORED;

			CREATE INDEX IF NOT EXISTS idx_fugue_nodes_search ON fugue_nodes USING gin(search_vector);
		`,
	},
];
