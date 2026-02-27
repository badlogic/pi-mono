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
	{
		id: "003_agents",
		sql: `
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

			CREATE INDEX IF NOT EXISTS idx_fugue_agents_status ON fugue_agents(status);
			CREATE INDEX IF NOT EXISTS idx_fugue_agents_parent ON fugue_agents(parent_agent_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_agents_node ON fugue_agents(graph_node_id);
		`,
	},
	{
		id: "004_research_and_memory",
		sql: `
			CREATE TABLE IF NOT EXISTS fugue_investigations (
				id TEXT PRIMARY KEY,
				graph_node_id TEXT REFERENCES fugue_nodes(id) ON DELETE SET NULL,
				question TEXT NOT NULL,
				methodology TEXT NOT NULL DEFAULT '',
				status TEXT NOT NULL DEFAULT 'open',
				conclusion TEXT NOT NULL DEFAULT '',
				investigator_id TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE INDEX IF NOT EXISTS idx_fugue_inv_status ON fugue_investigations(status);
			CREATE INDEX IF NOT EXISTS idx_fugue_inv_investigator ON fugue_investigations(investigator_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_inv_created ON fugue_investigations(created_at DESC);

			CREATE TABLE IF NOT EXISTS fugue_findings (
				id TEXT PRIMARY KEY,
				investigation_id TEXT NOT NULL REFERENCES fugue_investigations(id) ON DELETE CASCADE,
				graph_node_id TEXT REFERENCES fugue_nodes(id) ON DELETE SET NULL,
				claim TEXT NOT NULL,
				evidence TEXT NOT NULL DEFAULT '',
				confidence REAL NOT NULL DEFAULT 0.5,
				author_id TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE INDEX IF NOT EXISTS idx_fugue_findings_inv ON fugue_findings(investigation_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_findings_node ON fugue_findings(graph_node_id);

			CREATE TABLE IF NOT EXISTS fugue_decision_episodes (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				context TEXT NOT NULL DEFAULT '',
				options_considered JSONB NOT NULL DEFAULT '[]',
				decision TEXT NOT NULL,
				rationale TEXT NOT NULL DEFAULT '',
				outcome TEXT NOT NULL DEFAULT '',
				graph_node_id TEXT REFERENCES fugue_nodes(id) ON DELETE SET NULL,
				author_id TEXT NOT NULL,
				decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE INDEX IF NOT EXISTS idx_fugue_decisions_author ON fugue_decision_episodes(author_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_decisions_created ON fugue_decision_episodes(created_at DESC);
		`,
	},
	{
		id: "005_metrics_and_competitions",
		sql: `
			CREATE TABLE IF NOT EXISTS fugue_metrics (
				id TEXT PRIMARY KEY,
				graph_node_id TEXT REFERENCES fugue_nodes(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				value REAL NOT NULL,
				unit TEXT NOT NULL DEFAULT '',
				measured_by TEXT NOT NULL,
				measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE INDEX IF NOT EXISTS idx_fugue_metrics_node ON fugue_metrics(graph_node_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_metrics_name ON fugue_metrics(name);
			CREATE INDEX IF NOT EXISTS idx_fugue_metrics_measured ON fugue_metrics(measured_at DESC);

			CREATE TABLE IF NOT EXISTS fugue_competitions (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				status TEXT NOT NULL DEFAULT 'active',
				criteria JSONB NOT NULL DEFAULT '{}',
				winner_node_id TEXT REFERENCES fugue_nodes(id) ON DELETE SET NULL,
				author_id TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				concluded_at TIMESTAMPTZ
			);

			CREATE INDEX IF NOT EXISTS idx_fugue_competitions_status ON fugue_competitions(status);
			CREATE INDEX IF NOT EXISTS idx_fugue_competitions_created ON fugue_competitions(created_at DESC);

			CREATE TABLE IF NOT EXISTS fugue_competition_entries (
				id TEXT PRIMARY KEY,
				competition_id TEXT NOT NULL REFERENCES fugue_competitions(id) ON DELETE CASCADE,
				graph_node_id TEXT NOT NULL REFERENCES fugue_nodes(id) ON DELETE CASCADE,
				score REAL,
				notes TEXT NOT NULL DEFAULT '',
				author_id TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE INDEX IF NOT EXISTS idx_fugue_entries_competition ON fugue_competition_entries(competition_id);
			CREATE INDEX IF NOT EXISTS idx_fugue_entries_node ON fugue_competition_entries(graph_node_id);
		`,
	},
];
