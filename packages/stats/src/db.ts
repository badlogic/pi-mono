import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { getStatsDbPath } from "./config.js";
import type {
	AggregatedStats,
	FolderStats,
	MessageStats,
	ModelPerformancePoint,
	ModelStats,
	ModelTimeSeriesPoint,
	TimeSeriesPoint,
} from "./types.js";

function openDatabase(filePath: string) {
	return new BetterSqlite3(filePath);
}

type SqliteDatabase = ReturnType<typeof openDatabase>;

let db: SqliteDatabase | null = null;
let dbPath: string | null = null;

function getDatabase(): SqliteDatabase {
	const targetPath = getStatsDbPath();
	if (db && dbPath === targetPath) {
		return db;
	}
	if (db) {
		db.close();
		db = null;
		dbPath = null;
	}
	mkdirSync(dirname(targetPath), { recursive: true });
	db = openDatabase(targetPath);
	dbPath = targetPath;
	db.pragma("journal_mode = WAL");
	db.exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			entry_id TEXT NOT NULL,
			folder TEXT NOT NULL,
			model TEXT NOT NULL,
			provider TEXT NOT NULL,
			api TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			duration INTEGER,
			ttft INTEGER,
			stop_reason TEXT NOT NULL,
			error_message TEXT,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_write_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL,
			premium_requests REAL NOT NULL DEFAULT 0,
			cost_input REAL NOT NULL,
			cost_output REAL NOT NULL,
			cost_cache_read REAL NOT NULL,
			cost_cache_write REAL NOT NULL,
			cost_total REAL NOT NULL,
			UNIQUE(session_file, entry_id)
		);

		CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
		CREATE INDEX IF NOT EXISTS idx_messages_model ON messages(model);
		CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(folder);
		CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_file);

		CREATE TABLE IF NOT EXISTS file_offsets (
			session_file TEXT PRIMARY KEY,
			offset INTEGER NOT NULL,
			last_modified INTEGER NOT NULL
		);
	`);
	return db;
}

export function initDb(): void {
	getDatabase();
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
		dbPath = null;
	}
}

export function getFileOffset(sessionFile: string): { offset: number; lastModified: number } | null {
	const row = getDatabase()
		.prepare("SELECT offset, last_modified AS lastModified FROM file_offsets WHERE session_file = ?")
		.get(sessionFile) as { offset: number; lastModified: number } | undefined;
	return row ?? null;
}

export function setFileOffset(sessionFile: string, offset: number, lastModified: number): void {
	getDatabase()
		.prepare(
			`INSERT INTO file_offsets (session_file, offset, last_modified)
			 VALUES (?, ?, ?)
			 ON CONFLICT(session_file) DO UPDATE SET offset = excluded.offset, last_modified = excluded.last_modified`,
		)
		.run(sessionFile, offset, lastModified);
}

export function insertMessageStats(stats: MessageStats[]): number {
	if (stats.length === 0) return 0;
	const database = getDatabase();
	const statement = database.prepare(`
		INSERT OR IGNORE INTO messages (
			session_file, entry_id, folder, model, provider, api, timestamp,
			duration, ttft, stop_reason, error_message,
			input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, premium_requests,
			cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	let inserted = 0;
	const transaction = database.transaction((items: MessageStats[]) => {
		for (const stat of items) {
			const result = statement.run(
				stat.sessionFile,
				stat.entryId,
				stat.folder,
				stat.model,
				stat.provider,
				stat.api,
				stat.timestamp,
				stat.duration,
				stat.ttft,
				stat.stopReason,
				stat.errorMessage,
				stat.usage.input,
				stat.usage.output,
				stat.usage.cacheRead,
				stat.usage.cacheWrite,
				stat.usage.totalTokens,
				stat.usage.premiumRequests ?? 0,
				stat.usage.cost.input,
				stat.usage.cost.output,
				stat.usage.cost.cacheRead,
				stat.usage.cost.cacheWrite,
				stat.usage.cost.total,
			);
			if (result.changes > 0) inserted += 1;
		}
	});
	transaction(stats);
	return inserted;
}

function emptyAggregatedStats(): AggregatedStats {
	return {
		totalRequests: 0,
		successfulRequests: 0,
		failedRequests: 0,
		errorRate: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheReadTokens: 0,
		totalCacheWriteTokens: 0,
		cacheRate: 0,
		totalCost: 0,
		totalPremiumRequests: 0,
		avgDuration: null,
		avgTtft: null,
		avgTokensPerSecond: null,
		firstTimestamp: 0,
		lastTimestamp: 0,
	};
}

interface AggregateRow {
	total_requests: number;
	failed_requests: number;
	total_input_tokens: number;
	total_output_tokens: number;
	total_cache_read_tokens: number;
	total_cache_write_tokens: number;
	total_premium_requests: number;
	total_cost: number;
	avg_duration: number | null;
	avg_ttft: number | null;
	avg_tokens_per_second: number | null;
	first_timestamp: number;
	last_timestamp: number;
}

function buildAggregatedStats(row: AggregateRow | undefined): AggregatedStats {
	if (!row) return emptyAggregatedStats();
	const totalRequests = row.total_requests ?? 0;
	const failedRequests = row.failed_requests ?? 0;
	const successfulRequests = totalRequests - failedRequests;
	const totalInputTokens = row.total_input_tokens ?? 0;
	const totalCacheReadTokens = row.total_cache_read_tokens ?? 0;
	return {
		totalRequests,
		successfulRequests,
		failedRequests,
		errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
		totalInputTokens,
		totalOutputTokens: row.total_output_tokens ?? 0,
		totalCacheReadTokens,
		totalCacheWriteTokens: row.total_cache_write_tokens ?? 0,
		cacheRate:
			totalInputTokens + totalCacheReadTokens > 0
				? totalCacheReadTokens / (totalInputTokens + totalCacheReadTokens)
				: 0,
		totalCost: row.total_cost ?? 0,
		totalPremiumRequests: row.total_premium_requests ?? 0,
		avgDuration: row.avg_duration,
		avgTtft: row.avg_ttft,
		avgTokensPerSecond: row.avg_tokens_per_second,
		firstTimestamp: row.first_timestamp ?? 0,
		lastTimestamp: row.last_timestamp ?? 0,
	};
}

export function getOverallStats(): AggregatedStats {
	const row = getDatabase()
		.prepare(`
			SELECT
				COUNT(*) AS total_requests,
				SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) AS failed_requests,
				SUM(input_tokens) AS total_input_tokens,
				SUM(output_tokens) AS total_output_tokens,
				SUM(cache_read_tokens) AS total_cache_read_tokens,
				SUM(cache_write_tokens) AS total_cache_write_tokens,
				SUM(premium_requests) AS total_premium_requests,
				SUM(cost_total) AS total_cost,
				AVG(duration) AS avg_duration,
				AVG(ttft) AS avg_ttft,
				AVG(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration ELSE NULL END) AS avg_tokens_per_second,
				MIN(timestamp) AS first_timestamp,
				MAX(timestamp) AS last_timestamp
			FROM messages
		`)
		.get() as AggregateRow | undefined;
	return buildAggregatedStats(row);
}

export function getStatsByModel(): ModelStats[] {
	const rows = getDatabase()
		.prepare(`
			SELECT
				model,
				provider,
				COUNT(*) AS total_requests,
				SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) AS failed_requests,
				SUM(input_tokens) AS total_input_tokens,
				SUM(output_tokens) AS total_output_tokens,
				SUM(cache_read_tokens) AS total_cache_read_tokens,
				SUM(cache_write_tokens) AS total_cache_write_tokens,
				SUM(premium_requests) AS total_premium_requests,
				SUM(cost_total) AS total_cost,
				AVG(duration) AS avg_duration,
				AVG(ttft) AS avg_ttft,
				AVG(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration ELSE NULL END) AS avg_tokens_per_second,
				MIN(timestamp) AS first_timestamp,
				MAX(timestamp) AS last_timestamp
			FROM messages
			GROUP BY model, provider
			ORDER BY total_requests DESC, total_cost DESC
		`)
		.all() as Array<AggregateRow & { model: string; provider: string }>;
	return rows.map((row) => ({ model: row.model, provider: row.provider, ...buildAggregatedStats(row) }));
}

export function getStatsByFolder(): FolderStats[] {
	const rows = getDatabase()
		.prepare(`
			SELECT
				folder,
				COUNT(*) AS total_requests,
				SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) AS failed_requests,
				SUM(input_tokens) AS total_input_tokens,
				SUM(output_tokens) AS total_output_tokens,
				SUM(cache_read_tokens) AS total_cache_read_tokens,
				SUM(cache_write_tokens) AS total_cache_write_tokens,
				SUM(premium_requests) AS total_premium_requests,
				SUM(cost_total) AS total_cost,
				AVG(duration) AS avg_duration,
				AVG(ttft) AS avg_ttft,
				AVG(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration ELSE NULL END) AS avg_tokens_per_second,
				MIN(timestamp) AS first_timestamp,
				MAX(timestamp) AS last_timestamp
			FROM messages
			GROUP BY folder
			ORDER BY total_requests DESC, total_cost DESC
		`)
		.all() as Array<AggregateRow & { folder: string }>;
	return rows.map((row) => ({ folder: row.folder, ...buildAggregatedStats(row) }));
}

export function getTimeSeries(hours = 24): TimeSeriesPoint[] {
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	const rows = getDatabase()
		.prepare(`
			SELECT
				(timestamp / 3600000) * 3600000 AS bucket,
				COUNT(*) AS requests,
				SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) AS errors,
				SUM(total_tokens) AS tokens,
				SUM(cost_total) AS cost
			FROM messages
			WHERE timestamp >= ?
			GROUP BY bucket
			ORDER BY bucket ASC
		`)
		.all(cutoff) as Array<{ bucket: number; requests: number; errors: number; tokens: number; cost: number }>;
	return rows.map((row) => ({
		timestamp: row.bucket,
		requests: row.requests,
		errors: row.errors ?? 0,
		tokens: row.tokens ?? 0,
		cost: row.cost ?? 0,
	}));
}

export function getModelTimeSeries(days = 14): ModelTimeSeriesPoint[] {
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	const rows = getDatabase()
		.prepare(`
			SELECT
				(timestamp / 86400000) * 86400000 AS bucket,
				model,
				provider,
				COUNT(*) AS requests
			FROM messages
			WHERE timestamp >= ?
			GROUP BY bucket, model, provider
			ORDER BY bucket ASC, requests DESC
		`)
		.all(cutoff) as Array<{ bucket: number; model: string; provider: string; requests: number }>;
	return rows.map((row) => ({
		timestamp: row.bucket,
		model: row.model,
		provider: row.provider,
		requests: row.requests,
	}));
}

export function getModelPerformanceSeries(days = 14): ModelPerformancePoint[] {
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	const rows = getDatabase()
		.prepare(`
			SELECT
				(timestamp / 86400000) * 86400000 AS bucket,
				model,
				provider,
				COUNT(*) AS requests,
				AVG(ttft) AS avg_ttft,
				AVG(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration ELSE NULL END) AS avg_tokens_per_second
			FROM messages
			WHERE timestamp >= ?
			GROUP BY bucket, model, provider
			ORDER BY bucket ASC, requests DESC
		`)
		.all(cutoff) as Array<{
		bucket: number;
		model: string;
		provider: string;
		requests: number;
		avg_ttft: number | null;
		avg_tokens_per_second: number | null;
	}>;
	return rows.map((row) => ({
		timestamp: row.bucket,
		model: row.model,
		provider: row.provider,
		requests: row.requests,
		avgTtft: row.avg_ttft,
		avgTokensPerSecond: row.avg_tokens_per_second,
	}));
}

function rowToMessageStats(row: {
	id: number;
	session_file: string;
	entry_id: string;
	folder: string;
	model: string;
	provider: string;
	api: string;
	timestamp: number;
	duration: number | null;
	ttft: number | null;
	stop_reason: MessageStats["stopReason"];
	error_message: string | null;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	total_tokens: number;
	premium_requests: number;
	cost_input: number;
	cost_output: number;
	cost_cache_read: number;
	cost_cache_write: number;
	cost_total: number;
}): MessageStats {
	return {
		id: row.id,
		sessionFile: row.session_file,
		entryId: row.entry_id,
		folder: row.folder,
		model: row.model,
		provider: row.provider,
		api: row.api,
		timestamp: row.timestamp,
		duration: row.duration,
		ttft: row.ttft,
		stopReason: row.stop_reason,
		errorMessage: row.error_message,
		usage: {
			input: row.input_tokens,
			output: row.output_tokens,
			cacheRead: row.cache_read_tokens,
			cacheWrite: row.cache_write_tokens,
			totalTokens: row.total_tokens,
			premiumRequests: row.premium_requests,
			cost: {
				input: row.cost_input,
				output: row.cost_output,
				cacheRead: row.cost_cache_read,
				cacheWrite: row.cost_cache_write,
				total: row.cost_total,
			},
		},
	};
}

export function getRecentRequests(limit = 100): MessageStats[] {
	const rows = getDatabase()
		.prepare("SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?")
		.all(limit) as Parameters<typeof rowToMessageStats>[0][];
	return rows.map(rowToMessageStats);
}

export function getRecentErrors(limit = 100): MessageStats[] {
	const rows = getDatabase()
		.prepare("SELECT * FROM messages WHERE stop_reason = 'error' ORDER BY timestamp DESC LIMIT ?")
		.all(limit) as Parameters<typeof rowToMessageStats>[0][];
	return rows.map(rowToMessageStats);
}

export function getMessageById(id: number): MessageStats | null {
	const row = getDatabase().prepare("SELECT * FROM messages WHERE id = ?").get(id) as
		| Parameters<typeof rowToMessageStats>[0]
		| undefined;
	return row ? rowToMessageStats(row) : null;
}

export function getMessageCount(): number {
	const row = getDatabase().prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number };
	return row.count;
}
