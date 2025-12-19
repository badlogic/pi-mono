/**
 * Archival Memory - Long-Term Storage with Semantic Search
 *
 * Provides agent-managed archival memory with semantic retrieval.
 * Superior to Letta: Local embeddings, no external vector DB required.
 *
 * Features:
 * - Local embedding generation (via API or transformers.js)
 * - SQLite-based vector storage
 * - Semantic search with cosine similarity
 * - Tagging and metadata
 * - Agent self-archival tools
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

export interface ArchivalEntry {
	id: number;
	agentId: string;
	content: string;
	embedding?: number[];
	tags: string[];
	metadata: Record<string, unknown>;
	createdAt: string;
}

export interface ArchivalSearchResult {
	entry: ArchivalEntry;
	score: number;
}

export interface EmbeddingProvider {
	embed(text: string): Promise<number[]>;
	embedBatch(texts: string[]): Promise<number[][]>;
	dimensions: number;
}

// ============================================================================
// Simple Local Embedding (TF-IDF based fallback)
// ============================================================================

/**
 * Simple TF-IDF based embedding for local use without external APIs
 * Not as good as neural embeddings but works offline
 */
export class LocalTFIDFEmbedding implements EmbeddingProvider {
	dimensions = 384; // Fixed dimension
	private vocabulary: Map<string, number> = new Map();
	private idf: Map<string, number> = new Map();
	private documents: string[] = [];

	/**
	 * Tokenize text
	 */
	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 2);
	}

	/**
	 * Update vocabulary and IDF from documents
	 */
	updateVocabulary(documents: string[]): void {
		this.documents = documents;
		const docFreq = new Map<string, number>();

		// Build vocabulary and document frequency
		for (const doc of documents) {
			const tokens = new Set(this.tokenize(doc));
			for (const token of tokens) {
				if (!this.vocabulary.has(token)) {
					this.vocabulary.set(token, this.vocabulary.size);
				}
				docFreq.set(token, (docFreq.get(token) || 0) + 1);
			}
		}

		// Calculate IDF
		const N = documents.length;
		for (const [token, freq] of docFreq) {
			this.idf.set(token, Math.log(N / freq));
		}
	}

	/**
	 * Generate embedding for text
	 */
	async embed(text: string): Promise<number[]> {
		const tokens = this.tokenize(text);
		const tf = new Map<string, number>();

		// Calculate term frequency
		for (const token of tokens) {
			tf.set(token, (tf.get(token) || 0) + 1);
		}

		// Create sparse TF-IDF vector
		const vector = new Array(this.dimensions).fill(0);

		for (const [token, freq] of tf) {
			const idx = this.vocabulary.get(token);
			if (idx !== undefined && idx < this.dimensions) {
				const tfidf = freq * (this.idf.get(token) || 1);
				vector[idx % this.dimensions] += tfidf;
			}
		}

		// Normalize
		const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
		if (magnitude > 0) {
			for (let i = 0; i < vector.length; i++) {
				vector[i] /= magnitude;
			}
		}

		return vector;
	}

	/**
	 * Batch embedding
	 */
	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((t) => this.embed(t)));
	}
}

// ============================================================================
// OpenAI-Compatible Embedding Provider
// ============================================================================

export class OpenAIEmbedding implements EmbeddingProvider {
	dimensions = 1536; // text-embedding-3-small
	private apiKey: string;
	private baseUrl: string;
	private model: string;

	constructor(apiKey: string, options: { baseUrl?: string; model?: string; dimensions?: number } = {}) {
		this.apiKey = apiKey;
		this.baseUrl = options.baseUrl || "https://api.openai.com/v1";
		this.model = options.model || "text-embedding-3-small";
		if (options.dimensions) this.dimensions = options.dimensions;
	}

	async embed(text: string): Promise<number[]> {
		const response = await fetch(`${this.baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				input: text,
				model: this.model,
			}),
		});

		if (!response.ok) {
			throw new Error(`Embedding API error: ${response.statusText}`);
		}

		const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
		return data.data[0].embedding;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const response = await fetch(`${this.baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				input: texts,
				model: this.model,
			}),
		});

		if (!response.ok) {
			throw new Error(`Embedding API error: ${response.statusText}`);
		}

		const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
		return data.data.map((d) => d.embedding);
	}
}

// ============================================================================
// Cosine Similarity
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;

	let dotProduct = 0;
	let magnitudeA = 0;
	let magnitudeB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		magnitudeA += a[i] * a[i];
		magnitudeB += b[i] * b[i];
	}

	const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
	return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ============================================================================
// Archival Memory Database
// ============================================================================

export class ArchivalMemory {
	private db: Database.Database;
	private embedder: EmbeddingProvider;
	private dataDir: string;

	constructor(dataDir: string = DEFAULT_DATA_DIR, embedder?: EmbeddingProvider) {
		this.dataDir = dataDir;
		this.embedder = embedder || new LocalTFIDFEmbedding();

		const dbPath = join(dataDir, "archival_memory.db");

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

		// Initialize local embedder vocabulary if needed
		if (this.embedder instanceof LocalTFIDFEmbedding) {
			this.initializeLocalEmbedder();
		}
	}

	/**
	 * Initialize database schema
	 */
	private initSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS archival_entries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				agent_id TEXT NOT NULL,
				content TEXT NOT NULL,
				embedding BLOB,
				tags TEXT DEFAULT '[]',
				metadata TEXT DEFAULT '{}',
				created_at TEXT DEFAULT (datetime('now'))
			);

			CREATE INDEX IF NOT EXISTS idx_archival_agent ON archival_entries(agent_id);
			CREATE INDEX IF NOT EXISTS idx_archival_created ON archival_entries(created_at);

			-- FTS for keyword search fallback
			CREATE VIRTUAL TABLE IF NOT EXISTS archival_fts USING fts5(
				content,
				agent_id,
				tags,
				content='archival_entries',
				content_rowid='id'
			);

			CREATE TRIGGER IF NOT EXISTS archival_ai AFTER INSERT ON archival_entries BEGIN
				INSERT INTO archival_fts(rowid, content, agent_id, tags)
				VALUES (new.id, new.content, new.agent_id, new.tags);
			END;

			CREATE TRIGGER IF NOT EXISTS archival_ad AFTER DELETE ON archival_entries BEGIN
				INSERT INTO archival_fts(archival_fts, rowid, content, agent_id, tags)
				VALUES('delete', old.id, old.content, old.agent_id, old.tags);
			END;
		`);
	}

	/**
	 * Initialize local TF-IDF embedder with existing documents
	 */
	private initializeLocalEmbedder(): void {
		if (!(this.embedder instanceof LocalTFIDFEmbedding)) return;

		const rows = this.db.prepare("SELECT content FROM archival_entries LIMIT 1000").all() as Array<{
			content: string;
		}>;

		if (rows.length > 0) {
			this.embedder.updateVocabulary(rows.map((r) => r.content));
		}
	}

	// ========================================================================
	// Archive Operations
	// ========================================================================

	/**
	 * Archive a new entry
	 */
	async archive(
		agentId: string,
		content: string,
		options: { tags?: string[]; metadata?: Record<string, unknown> } = {},
	): Promise<ArchivalEntry> {
		// Generate embedding
		const embedding = await this.embedder.embed(content);

		const stmt = this.db.prepare(`
			INSERT INTO archival_entries (agent_id, content, embedding, tags, metadata)
			VALUES (?, ?, ?, ?, ?)
		`);

		const result = stmt.run(
			agentId,
			content,
			Buffer.from(new Float32Array(embedding).buffer),
			JSON.stringify(options.tags || []),
			JSON.stringify(options.metadata || {}),
		);

		// Update local embedder vocabulary
		if (this.embedder instanceof LocalTFIDFEmbedding) {
			const docs = this.db.prepare("SELECT content FROM archival_entries LIMIT 1000").all() as Array<{
				content: string;
			}>;
			this.embedder.updateVocabulary(docs.map((r) => r.content));
		}

		return {
			id: result.lastInsertRowid as number,
			agentId,
			content,
			embedding,
			tags: options.tags || [],
			metadata: options.metadata || {},
			createdAt: new Date().toISOString(),
		};
	}

	/**
	 * Semantic search in archival memory
	 */
	async search(
		query: string,
		options: { agentId?: string; tags?: string[]; limit?: number } = {},
	): Promise<ArchivalSearchResult[]> {
		const { agentId, tags, limit = 10 } = options;

		// Generate query embedding
		const queryEmbedding = await this.embedder.embed(query);

		// Build WHERE clause
		const filters: string[] = [];
		const params: string[] = [];

		if (agentId) {
			filters.push("agent_id = ?");
			params.push(agentId);
		}

		const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

		// Get all entries (we'll filter by similarity in memory)
		const rows = this.db
			.prepare(
				`
			SELECT id, agent_id, content, embedding, tags, metadata, created_at
			FROM archival_entries
			${whereClause}
		`,
			)
			.all(...params) as Array<{
			id: number;
			agent_id: string;
			content: string;
			embedding: Buffer | null;
			tags: string;
			metadata: string;
			created_at: string;
		}>;

		// Calculate similarity scores
		const results: ArchivalSearchResult[] = [];

		for (const row of rows) {
			let score = 0;

			if (row.embedding) {
				const embedding = Array.from(new Float32Array(row.embedding.buffer));
				score = cosineSimilarity(queryEmbedding, embedding);
			}

			const entry: ArchivalEntry = {
				id: row.id,
				agentId: row.agent_id,
				content: row.content,
				tags: JSON.parse(row.tags),
				metadata: JSON.parse(row.metadata),
				createdAt: row.created_at,
			};

			// Filter by tags if specified
			if (tags && tags.length > 0) {
				const hasAllTags = tags.every((t) => entry.tags.includes(t));
				if (!hasAllTags) continue;
			}

			results.push({ entry, score });
		}

		// Sort by score and limit
		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	/**
	 * Keyword search (FTS5 fallback)
	 */
	searchKeyword(query: string, options: { agentId?: string; limit?: number } = {}): ArchivalEntry[] {
		const { agentId, limit = 10 } = options;

		const filters: string[] = [];
		const params: (string | number)[] = [query];

		if (agentId) {
			filters.push("e.agent_id = ?");
			params.push(agentId);
		}

		const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

		const rows = this.db
			.prepare(
				`
			SELECT e.id, e.agent_id, e.content, e.tags, e.metadata, e.created_at
			FROM archival_fts fts
			JOIN archival_entries e ON fts.rowid = e.id
			WHERE archival_fts MATCH ? ${whereClause}
			ORDER BY rank
			LIMIT ?
		`,
			)
			.all(...params, limit) as Array<{
			id: number;
			agent_id: string;
			content: string;
			tags: string;
			metadata: string;
			created_at: string;
		}>;

		return rows.map((row) => ({
			id: row.id,
			agentId: row.agent_id,
			content: row.content,
			tags: JSON.parse(row.tags),
			metadata: JSON.parse(row.metadata),
			createdAt: row.created_at,
		}));
	}

	/**
	 * Get entry by ID
	 */
	get(id: number): ArchivalEntry | null {
		const row = this.db
			.prepare(
				`
			SELECT id, agent_id, content, tags, metadata, created_at
			FROM archival_entries
			WHERE id = ?
		`,
			)
			.get(id) as
			| {
					id: number;
					agent_id: string;
					content: string;
					tags: string;
					metadata: string;
					created_at: string;
			  }
			| undefined;

		if (!row) return null;

		return {
			id: row.id,
			agentId: row.agent_id,
			content: row.content,
			tags: JSON.parse(row.tags),
			metadata: JSON.parse(row.metadata),
			createdAt: row.created_at,
		};
	}

	/**
	 * Delete entry
	 */
	delete(id: number): boolean {
		const result = this.db.prepare("DELETE FROM archival_entries WHERE id = ?").run(id);
		return result.changes > 0;
	}

	/**
	 * Get statistics
	 */
	getStats(agentId?: string): {
		totalEntries: number;
		byAgent: Record<string, number>;
		recentEntries: number;
	} {
		const params: string[] = [];
		const whereClause = agentId ? "WHERE agent_id = ?" : "";
		if (agentId) params.push(agentId);

		const total = this.db.prepare(`SELECT COUNT(*) as count FROM archival_entries ${whereClause}`).get(...params) as {
			count: number;
		};

		const byAgent = this.db
			.prepare("SELECT agent_id, COUNT(*) as count FROM archival_entries GROUP BY agent_id")
			.all() as Array<{ agent_id: string; count: number }>;

		const recent = this.db
			.prepare(
				`
			SELECT COUNT(*) as count FROM archival_entries
			WHERE created_at > datetime('now', '-24 hours')
			${agentId ? "AND agent_id = ?" : ""}
		`,
			)
			.get(...params) as { count: number };

		return {
			totalEntries: total.count,
			byAgent: Object.fromEntries(byAgent.map((r) => [r.agent_id, r.count])),
			recentEntries: recent.count,
		};
	}

	/**
	 * Close database
	 */
	close(): void {
		this.db.close();
	}
}

// ============================================================================
// Archival Memory Tools
// ============================================================================

export function createArchivalTools(memory: ArchivalMemory, agentId: string) {
	return {
		archival_insert: {
			name: "archival_insert",
			description:
				"Store information in long-term archival memory for future retrieval. Use for important facts, learnings, or context that should be remembered.",
			parameters: {
				type: "object",
				properties: {
					content: {
						type: "string",
						description: "Content to archive",
					},
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Tags for categorization",
					},
				},
				required: ["content"],
			},
			execute: async (args: { content: string; tags?: string[] }) => {
				const entry = await memory.archive(agentId, args.content, { tags: args.tags });
				return JSON.stringify({
					success: true,
					id: entry.id,
					message: "Archived successfully",
				});
			},
		},

		archival_search: {
			name: "archival_search",
			description: "Search archival memory using semantic similarity. Returns relevant past memories.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Search query",
					},
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Filter by tags",
					},
					limit: {
						type: "number",
						description: "Max results (default: 5)",
					},
				},
				required: ["query"],
			},
			execute: async (args: { query: string; tags?: string[]; limit?: number }) => {
				const results = await memory.search(args.query, {
					agentId,
					tags: args.tags,
					limit: args.limit || 5,
				});

				return JSON.stringify({
					count: results.length,
					results: results.map((r) => ({
						id: r.entry.id,
						content: r.entry.content.substring(0, 500),
						score: Math.round(r.score * 100) / 100,
						tags: r.entry.tags,
						created: r.entry.createdAt,
					})),
				});
			},
		},

		archival_delete: {
			name: "archival_delete",
			description: "Delete an entry from archival memory.",
			parameters: {
				type: "object",
				properties: {
					id: {
						type: "number",
						description: "ID of entry to delete",
					},
				},
				required: ["id"],
			},
			execute: async (args: { id: number }) => {
				const success = memory.delete(args.id);
				return JSON.stringify({ success, id: args.id });
			},
		},
	};
}

// ============================================================================
// Singleton Instance
// ============================================================================

let archivalMemoryInstance: ArchivalMemory | null = null;

export function getArchivalMemory(dataDir?: string, embedder?: EmbeddingProvider): ArchivalMemory {
	if (!archivalMemoryInstance) {
		archivalMemoryInstance = new ArchivalMemory(dataDir, embedder);
	}
	return archivalMemoryInstance;
}

export function disposeArchivalMemory(): void {
	if (archivalMemoryInstance) {
		archivalMemoryInstance.close();
		archivalMemoryInstance = null;
	}
}

export default ArchivalMemory;
