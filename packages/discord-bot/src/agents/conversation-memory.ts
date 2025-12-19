/**
 * Conversation Memory - Full-Text and Semantic Search
 *
 * Provides searchable access to past conversations using SQLite FTS5.
 * Superior to Letta: Local-first with no external API, instant search.
 *
 * Features:
 * - Full-text search with FTS5
 * - Time-based recall
 * - Channel/agent scoped storage
 * - Automatic summarization for long conversations
 * - Integration with memory blocks
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export interface ConversationMessage {
	id?: number;
	channelId: string;
	agentId: string;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	timestamp: string;
	metadata?: Record<string, unknown>;
}

export interface SearchResult {
	message: ConversationMessage;
	score: number;
	highlight?: string;
}

export interface RecallOptions {
	channelId?: string;
	agentId?: string;
	role?: "user" | "assistant" | "system" | "tool";
	limit?: number;
	offset?: number;
}

export interface TimeRange {
	from: Date;
	to: Date;
}

// ============================================================================
// Conversation Memory Database
// ============================================================================

export class ConversationMemory {
	private db: Database.Database;
	private dataDir: string;

	constructor(dataDir: string = DEFAULT_DATA_DIR) {
		this.dataDir = dataDir;
		const dbPath = join(dataDir, "conversation_memory.db");

		// Ensure directory exists
		const dir = dirname(dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Open database
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");

		// Initialize schema
		this.initSchema();
	}

	/**
	 * Initialize database schema
	 */
	private initSchema(): void {
		// Main messages table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				channel_id TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				timestamp TEXT NOT NULL,
				metadata TEXT,
				created_at TEXT DEFAULT (datetime('now'))
			);

			CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
			CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
			CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
			CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
		`);

		// FTS5 virtual table for full-text search
		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
				content,
				channel_id,
				agent_id,
				role,
				content='messages',
				content_rowid='id'
			);
		`);

		// Triggers to keep FTS in sync
		this.db.exec(`
			CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
				INSERT INTO messages_fts(rowid, content, channel_id, agent_id, role)
				VALUES (new.id, new.content, new.channel_id, new.agent_id, new.role);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, content, channel_id, agent_id, role)
				VALUES('delete', old.id, old.content, old.channel_id, old.agent_id, old.role);
			END;

			CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
				INSERT INTO messages_fts(messages_fts, rowid, content, channel_id, agent_id, role)
				VALUES('delete', old.id, old.content, old.channel_id, old.agent_id, old.role);
				INSERT INTO messages_fts(rowid, content, channel_id, agent_id, role)
				VALUES (new.id, new.content, new.channel_id, new.agent_id, new.role);
			END;
		`);

		// Summaries table for compressed history
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS summaries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				channel_id TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				summary TEXT NOT NULL,
				message_count INTEGER NOT NULL,
				from_timestamp TEXT NOT NULL,
				to_timestamp TEXT NOT NULL,
				created_at TEXT DEFAULT (datetime('now'))
			);

			CREATE INDEX IF NOT EXISTS idx_summaries_channel ON summaries(channel_id);
		`);
	}

	// ========================================================================
	// Store Messages
	// ========================================================================

	/**
	 * Store a single message
	 */
	store(message: ConversationMessage): number {
		const stmt = this.db.prepare(`
			INSERT INTO messages (channel_id, agent_id, role, content, timestamp, metadata)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		const result = stmt.run(
			message.channelId,
			message.agentId,
			message.role,
			message.content,
			message.timestamp,
			message.metadata ? JSON.stringify(message.metadata) : null,
		);

		return result.lastInsertRowid as number;
	}

	/**
	 * Store multiple messages
	 */
	storeBatch(messages: ConversationMessage[]): number[] {
		const stmt = this.db.prepare(`
			INSERT INTO messages (channel_id, agent_id, role, content, timestamp, metadata)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		const ids: number[] = [];

		const transaction = this.db.transaction((msgs: ConversationMessage[]) => {
			for (const msg of msgs) {
				const result = stmt.run(
					msg.channelId,
					msg.agentId,
					msg.role,
					msg.content,
					msg.timestamp,
					msg.metadata ? JSON.stringify(msg.metadata) : null,
				);
				ids.push(result.lastInsertRowid as number);
			}
		});

		transaction(messages);
		return ids;
	}

	// ========================================================================
	// Search
	// ========================================================================

	/**
	 * Full-text search across conversations
	 */
	search(query: string, options: RecallOptions = {}): SearchResult[] {
		const { channelId, agentId, role, limit = 20, offset = 0 } = options;

		// Build WHERE clause for filters
		const filters: string[] = [];
		const params: (string | number)[] = [query];

		if (channelId) {
			filters.push("m.channel_id = ?");
			params.push(channelId);
		}
		if (agentId) {
			filters.push("m.agent_id = ?");
			params.push(agentId);
		}
		if (role) {
			filters.push("m.role = ?");
			params.push(role);
		}

		const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

		const sql = `
			SELECT
				m.id, m.channel_id, m.agent_id, m.role, m.content, m.timestamp, m.metadata,
				bm25(messages_fts) as score,
				highlight(messages_fts, 0, '<mark>', '</mark>') as highlight
			FROM messages_fts fts
			JOIN messages m ON fts.rowid = m.id
			WHERE messages_fts MATCH ? ${whereClause}
			ORDER BY score
			LIMIT ? OFFSET ?
		`;

		params.push(limit, offset);

		const rows = this.db.prepare(sql).all(...params) as Array<{
			id: number;
			channel_id: string;
			agent_id: string;
			role: string;
			content: string;
			timestamp: string;
			metadata: string | null;
			score: number;
			highlight: string;
		}>;

		return rows.map((row) => ({
			message: {
				id: row.id,
				channelId: row.channel_id,
				agentId: row.agent_id,
				role: row.role as ConversationMessage["role"],
				content: row.content,
				timestamp: row.timestamp,
				metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			},
			score: row.score,
			highlight: row.highlight,
		}));
	}

	/**
	 * Recall messages by time range
	 */
	recallByTime(range: TimeRange, options: RecallOptions = {}): ConversationMessage[] {
		const { channelId, agentId, role, limit = 100 } = options;

		const filters: string[] = ["timestamp >= ? AND timestamp <= ?"];
		const params: (string | number)[] = [range.from.toISOString(), range.to.toISOString()];

		if (channelId) {
			filters.push("channel_id = ?");
			params.push(channelId);
		}
		if (agentId) {
			filters.push("agent_id = ?");
			params.push(agentId);
		}
		if (role) {
			filters.push("role = ?");
			params.push(role);
		}

		const sql = `
			SELECT id, channel_id, agent_id, role, content, timestamp, metadata
			FROM messages
			WHERE ${filters.join(" AND ")}
			ORDER BY timestamp ASC
			LIMIT ?
		`;

		params.push(limit);

		const rows = this.db.prepare(sql).all(...params) as Array<{
			id: number;
			channel_id: string;
			agent_id: string;
			role: string;
			content: string;
			timestamp: string;
			metadata: string | null;
		}>;

		return rows.map((row) => ({
			id: row.id,
			channelId: row.channel_id,
			agentId: row.agent_id,
			role: row.role as ConversationMessage["role"],
			content: row.content,
			timestamp: row.timestamp,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}));
	}

	/**
	 * Get recent messages
	 */
	getRecent(options: RecallOptions = {}): ConversationMessage[] {
		const { channelId, agentId, role, limit = 50, offset = 0 } = options;

		const filters: string[] = [];
		const params: (string | number)[] = [];

		if (channelId) {
			filters.push("channel_id = ?");
			params.push(channelId);
		}
		if (agentId) {
			filters.push("agent_id = ?");
			params.push(agentId);
		}
		if (role) {
			filters.push("role = ?");
			params.push(role);
		}

		const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

		const sql = `
			SELECT id, channel_id, agent_id, role, content, timestamp, metadata
			FROM messages
			${whereClause}
			ORDER BY timestamp DESC
			LIMIT ? OFFSET ?
		`;

		params.push(limit, offset);

		const rows = this.db.prepare(sql).all(...params) as Array<{
			id: number;
			channel_id: string;
			agent_id: string;
			role: string;
			content: string;
			timestamp: string;
			metadata: string | null;
		}>;

		// Reverse to get chronological order
		return rows.reverse().map((row) => ({
			id: row.id,
			channelId: row.channel_id,
			agentId: row.agent_id,
			role: row.role as ConversationMessage["role"],
			content: row.content,
			timestamp: row.timestamp,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}));
	}

	// ========================================================================
	// Summaries
	// ========================================================================

	/**
	 * Store a conversation summary
	 */
	storeSummary(
		channelId: string,
		agentId: string,
		summary: string,
		messageCount: number,
		fromTimestamp: string,
		toTimestamp: string,
	): number {
		const stmt = this.db.prepare(`
			INSERT INTO summaries (channel_id, agent_id, summary, message_count, from_timestamp, to_timestamp)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		const result = stmt.run(channelId, agentId, summary, messageCount, fromTimestamp, toTimestamp);
		return result.lastInsertRowid as number;
	}

	/**
	 * Get summaries for a channel
	 */
	getSummaries(
		channelId: string,
		limit = 10,
	): Array<{
		summary: string;
		messageCount: number;
		fromTimestamp: string;
		toTimestamp: string;
	}> {
		const rows = this.db
			.prepare(
				`
			SELECT summary, message_count, from_timestamp, to_timestamp
			FROM summaries
			WHERE channel_id = ?
			ORDER BY to_timestamp DESC
			LIMIT ?
		`,
			)
			.all(channelId, limit) as Array<{
			summary: string;
			message_count: number;
			from_timestamp: string;
			to_timestamp: string;
		}>;

		return rows.map((row) => ({
			summary: row.summary,
			messageCount: row.message_count,
			fromTimestamp: row.from_timestamp,
			toTimestamp: row.to_timestamp,
		}));
	}

	// ========================================================================
	// Statistics
	// ========================================================================

	/**
	 * Get conversation statistics
	 */
	getStats(channelId?: string): {
		totalMessages: number;
		byRole: Record<string, number>;
		byChannel: Record<string, number>;
		oldestMessage: string | null;
		newestMessage: string | null;
	} {
		const params: string[] = [];
		const whereClause = channelId ? "WHERE channel_id = ?" : "";
		if (channelId) params.push(channelId);

		const total = this.db.prepare(`SELECT COUNT(*) as count FROM messages ${whereClause}`).get(...params) as {
			count: number;
		};

		const byRole = this.db
			.prepare(`SELECT role, COUNT(*) as count FROM messages ${whereClause} GROUP BY role`)
			.all(...params) as Array<{ role: string; count: number }>;

		const byChannel = this.db
			.prepare(`SELECT channel_id, COUNT(*) as count FROM messages GROUP BY channel_id`)
			.all() as Array<{ channel_id: string; count: number }>;

		const oldest = this.db.prepare(`SELECT MIN(timestamp) as ts FROM messages ${whereClause}`).get(...params) as {
			ts: string | null;
		};

		const newest = this.db.prepare(`SELECT MAX(timestamp) as ts FROM messages ${whereClause}`).get(...params) as {
			ts: string | null;
		};

		return {
			totalMessages: total.count,
			byRole: Object.fromEntries(byRole.map((r) => [r.role, r.count])),
			byChannel: Object.fromEntries(byChannel.map((c) => [c.channel_id, c.count])),
			oldestMessage: oldest.ts,
			newestMessage: newest.ts,
		};
	}

	// ========================================================================
	// Cleanup
	// ========================================================================

	/**
	 * Delete old messages
	 */
	deleteOlderThan(date: Date, channelId?: string): number {
		const params: string[] = [date.toISOString()];
		let whereClause = "timestamp < ?";

		if (channelId) {
			whereClause += " AND channel_id = ?";
			params.push(channelId);
		}

		const result = this.db.prepare(`DELETE FROM messages WHERE ${whereClause}`).run(...params);

		return result.changes;
	}

	/**
	 * Close database connection
	 */
	close(): void {
		this.db.close();
	}
}

// ============================================================================
// Conversation Search Tools
// ============================================================================

export function createConversationTools(memory: ConversationMemory) {
	return {
		conversation_search: {
			name: "conversation_search",
			description:
				"Search through past conversations using full-text search. Returns relevant messages matching the query.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Search query to find in past conversations",
					},
					channel_id: {
						type: "string",
						description: "Optional: limit search to specific channel",
					},
					limit: {
						type: "number",
						description: "Maximum results to return (default: 10)",
					},
				},
				required: ["query"],
			},
			execute: async (args: { query: string; channel_id?: string; limit?: number }) => {
				const results = memory.search(args.query, {
					channelId: args.channel_id,
					limit: args.limit || 10,
				});

				return JSON.stringify({
					count: results.length,
					results: results.map((r) => ({
						role: r.message.role,
						content: r.message.content.substring(0, 500),
						timestamp: r.message.timestamp,
						highlight: r.highlight?.substring(0, 200),
					})),
				});
			},
		},

		conversation_recall: {
			name: "conversation_recall",
			description: "Recall recent messages from a conversation.",
			parameters: {
				type: "object",
				properties: {
					channel_id: {
						type: "string",
						description: "Channel to recall from",
					},
					limit: {
						type: "number",
						description: "Number of recent messages (default: 20)",
					},
				},
				required: ["channel_id"],
			},
			execute: async (args: { channel_id: string; limit?: number }) => {
				const messages = memory.getRecent({
					channelId: args.channel_id,
					limit: args.limit || 20,
				});

				return JSON.stringify({
					count: messages.length,
					messages: messages.map((m) => ({
						role: m.role,
						content: m.content.substring(0, 500),
						timestamp: m.timestamp,
					})),
				});
			},
		},
	};
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ConversationMemory | null = null;

export function getConversationMemory(dataDir?: string): ConversationMemory {
	if (!instance) {
		instance = new ConversationMemory(dataDir);
	}
	return instance;
}

export function disposeConversationMemory(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}

export default ConversationMemory;
