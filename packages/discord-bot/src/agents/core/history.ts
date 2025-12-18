/**
 * PAI History System - Principle 9: History Preserves Work
 *
 * Implements UOCS (User-Owned Coding System) pattern for capturing
 * and compounding work over time.
 *
 * Based on TAC Lesson 14: Personal AI Infrastructure
 *
 * Key concepts:
 * - Automatic capture of significant work
 * - Structured format for compound learning
 * - Query-able history for context retrieval
 * - Pruning to prevent unbounded growth
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * History entry types
 */
export type HistoryEntryType =
	| "task" // User task execution
	| "learning" // Insight/learning captured
	| "error" // Error encountered
	| "success" // Successful outcome
	| "context" // Context/state snapshot
	| "decision"; // Decision point

/**
 * Single history entry
 */
export interface HistoryEntry {
	id: string;
	timestamp: string;
	type: HistoryEntryType;
	component: string; // Which component created this
	title: string; // Brief summary
	content: string; // Full details
	metadata?: {
		userId?: string;
		sessionId?: string;
		duration?: number;
		tokensUsed?: number;
		confidence?: number;
		tags?: string[];
		parentId?: string; // Link to related entry
		outcome?: "success" | "failure" | "partial";
		[key: string]: unknown;
	};
}

/**
 * History query options
 */
export interface HistoryQuery {
	type?: HistoryEntryType | HistoryEntryType[];
	component?: string;
	userId?: string;
	sessionId?: string;
	tags?: string[];
	after?: string; // ISO timestamp
	before?: string; // ISO timestamp
	limit?: number;
	searchText?: string; // Full-text search
	outcome?: "success" | "failure" | "partial";
}

/**
 * History statistics
 */
export interface HistoryStats {
	total: number;
	byType: Record<HistoryEntryType, number>;
	byComponent: Record<string, number>;
	byOutcome: Record<string, number>;
	oldestEntry?: string;
	newestEntry?: string;
	averageDuration?: number;
	totalTokens?: number;
}

/**
 * History Manager - UOCS implementation
 */
export class HistoryManager {
	private historyDir: string;
	private historyFile: string;
	private entries: HistoryEntry[] = [];
	private maxEntries: number;
	private autoSave: boolean;

	constructor(
		dataDir: string,
		options: {
			maxEntries?: number;
			autoSave?: boolean;
		} = {},
	) {
		this.historyDir = dataDir;
		this.historyFile = join(dataDir, "history.jsonl");
		this.maxEntries = options.maxEntries || 1000;
		this.autoSave = options.autoSave !== false;

		this.ensureHistoryDir();
		this.load();
	}

	private ensureHistoryDir(): void {
		if (!existsSync(this.historyDir)) {
			mkdirSync(this.historyDir, { recursive: true });
		}
	}

	/**
	 * Generate unique ID
	 */
	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
	}

	/**
	 * Add entry to history
	 */
	add(
		entry: Omit<HistoryEntry, "id" | "timestamp"> & {
			timestamp?: string;
		},
	): string {
		const id = this.generateId();
		const timestamp = entry.timestamp || new Date().toISOString();

		const fullEntry: HistoryEntry = {
			id,
			timestamp,
			...entry,
		};

		this.entries.push(fullEntry);

		// Prune if needed
		if (this.entries.length > this.maxEntries) {
			this.prune();
		}

		// Auto-save
		if (this.autoSave) {
			this.save();
		}

		return id;
	}

	/**
	 * Query history
	 */
	query(query: HistoryQuery = {}): HistoryEntry[] {
		let results = [...this.entries];

		// Filter by type
		if (query.type) {
			const types = Array.isArray(query.type) ? query.type : [query.type];
			results = results.filter((e) => types.includes(e.type));
		}

		// Filter by component
		if (query.component) {
			results = results.filter((e) => e.component === query.component);
		}

		// Filter by userId
		if (query.userId) {
			results = results.filter((e) => e.metadata?.userId === query.userId);
		}

		// Filter by sessionId
		if (query.sessionId) {
			results = results.filter((e) => e.metadata?.sessionId === query.sessionId);
		}

		// Filter by tags
		if (query.tags?.length) {
			results = results.filter((e) => query.tags?.some((tag) => e.metadata?.tags?.includes(tag)));
		}

		// Filter by time range
		if (query.after) {
			results = results.filter((e) => e.timestamp >= query.after!);
		}

		if (query.before) {
			results = results.filter((e) => e.timestamp <= query.before!);
		}

		// Filter by outcome
		if (query.outcome) {
			results = results.filter((e) => e.metadata?.outcome === query.outcome);
		}

		// Full-text search
		if (query.searchText) {
			const searchLower = query.searchText.toLowerCase();
			results = results.filter(
				(e) => e.title.toLowerCase().includes(searchLower) || e.content.toLowerCase().includes(searchLower),
			);
		}

		// Sort by timestamp (newest first)
		results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

		// Apply limit
		if (query.limit) {
			results = results.slice(0, query.limit);
		}

		return results;
	}

	/**
	 * Get entry by ID
	 */
	get(id: string): HistoryEntry | undefined {
		return this.entries.find((e) => e.id === id);
	}

	/**
	 * Get recent entries
	 */
	recent(limit: number = 10, type?: HistoryEntryType): HistoryEntry[] {
		return this.query({ limit, type });
	}

	/**
	 * Get statistics
	 */
	getStats(): HistoryStats {
		const byType: Record<string, number> = {};
		const byComponent: Record<string, number> = {};
		const byOutcome: Record<string, number> = {};

		let totalDuration = 0;
		let durationCount = 0;
		let totalTokens = 0;

		let oldestEntry: string | undefined;
		let newestEntry: string | undefined;

		for (const entry of this.entries) {
			// Count by type
			byType[entry.type] = (byType[entry.type] || 0) + 1;

			// Count by component
			byComponent[entry.component] = (byComponent[entry.component] || 0) + 1;

			// Count by outcome
			if (entry.metadata?.outcome) {
				byOutcome[entry.metadata.outcome] = (byOutcome[entry.metadata.outcome] || 0) + 1;
			}

			// Track duration
			if (entry.metadata?.duration) {
				totalDuration += entry.metadata.duration;
				durationCount++;
			}

			// Track tokens
			if (entry.metadata?.tokensUsed) {
				totalTokens += entry.metadata.tokensUsed;
			}

			// Track timestamps
			if (!oldestEntry || entry.timestamp < oldestEntry) {
				oldestEntry = entry.timestamp;
			}
			if (!newestEntry || entry.timestamp > newestEntry) {
				newestEntry = entry.timestamp;
			}
		}

		return {
			total: this.entries.length,
			byType: byType as Record<HistoryEntryType, number>,
			byComponent,
			byOutcome,
			oldestEntry,
			newestEntry,
			averageDuration: durationCount > 0 ? totalDuration / durationCount : undefined,
			totalTokens: totalTokens > 0 ? totalTokens : undefined,
		};
	}

	/**
	 * Build context from relevant history
	 */
	buildContext(query: HistoryQuery, maxLength: number = 2000): string {
		const relevant = this.query(query);

		if (relevant.length === 0) {
			return "";
		}

		const lines: string[] = ["## Relevant History\n"];

		let currentLength = lines[0].length;

		for (const entry of relevant) {
			const line = `**[${entry.timestamp}]** ${entry.title}\n${entry.content.substring(0, 200)}...\n`;

			if (currentLength + line.length > maxLength) {
				break;
			}

			lines.push(line);
			currentLength += line.length;
		}

		return lines.join("\n");
	}

	/**
	 * Prune old entries (FIFO)
	 */
	prune(targetSize?: number): number {
		const target = targetSize || this.maxEntries;

		if (this.entries.length <= target) {
			return 0;
		}

		// Sort by timestamp (oldest first)
		this.entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		// Calculate how many to remove
		const toRemove = this.entries.length - target;

		// Remove oldest entries
		this.entries.splice(0, toRemove);

		// Save after pruning
		if (this.autoSave) {
			this.save();
		}

		return toRemove;
	}

	/**
	 * Smart prune - keep important entries, remove less important
	 */
	smartPrune(targetSize?: number): number {
		const target = targetSize || this.maxEntries;

		if (this.entries.length <= target) {
			return 0;
		}

		// Calculate importance score
		const scored = this.entries.map((entry) => {
			let score = 0;

			// Successful outcomes are more important
			if (entry.metadata?.outcome === "success") score += 10;

			// Learnings are very important
			if (entry.type === "learning") score += 15;

			// Recent entries are more important
			const age = Date.now() - new Date(entry.timestamp).getTime();
			const daysSince = age / (1000 * 60 * 60 * 24);
			score += Math.max(0, 10 - daysSince);

			// High confidence entries are important
			if (entry.metadata?.confidence) {
				score += entry.metadata.confidence * 5;
			}

			return { entry, score };
		});

		// Sort by score (lowest first) and remove
		scored.sort((a, b) => a.score - b.score);
		const toRemove = this.entries.length - target;
		const removed = scored.slice(0, toRemove);

		// Remove from entries
		const removedIds = new Set(removed.map((r) => r.entry.id));
		this.entries = this.entries.filter((e) => !removedIds.has(e.id));

		// Save after pruning
		if (this.autoSave) {
			this.save();
		}

		return toRemove;
	}

	/**
	 * Save history to disk (JSONL format)
	 */
	save(): void {
		try {
			// Write as JSONL (one JSON object per line)
			const lines = this.entries.map((entry) => JSON.stringify(entry));
			writeFileSync(this.historyFile, lines.join("\n"));
		} catch (error) {
			console.error("[HistoryManager] Failed to save history:", error);
		}
	}

	/**
	 * Load history from disk
	 */
	load(): void {
		try {
			if (!existsSync(this.historyFile)) {
				return;
			}

			const content = readFileSync(this.historyFile, "utf-8");
			const lines = content.split("\n").filter((line) => line.trim());

			this.entries = lines.map((line) => JSON.parse(line));

			// Sort by timestamp
			this.entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		} catch (error) {
			console.error("[HistoryManager] Failed to load history:", error);
			this.entries = [];
		}
	}

	/**
	 * Clear all history
	 */
	clear(): void {
		this.entries = [];
		if (this.autoSave) {
			this.save();
		}
	}

	/**
	 * Export history as markdown
	 */
	exportMarkdown(): string {
		const stats = this.getStats();

		const lines: string[] = [
			"# Agent History Report",
			"",
			`Generated: ${new Date().toISOString()}`,
			"",
			"## Statistics",
			"",
			`- **Total Entries:** ${stats.total}`,
			`- **Date Range:** ${stats.oldestEntry || "N/A"} to ${stats.newestEntry || "N/A"}`,
			`- **Average Duration:** ${stats.averageDuration ? `${Math.round(stats.averageDuration)}ms` : "N/A"}`,
			`- **Total Tokens:** ${stats.totalTokens || "N/A"}`,
			"",
			"### By Type",
			"",
		];

		for (const [type, count] of Object.entries(stats.byType)) {
			lines.push(`- **${type}:** ${count}`);
		}

		lines.push("", "### By Outcome", "");

		for (const [outcome, count] of Object.entries(stats.byOutcome)) {
			lines.push(`- **${outcome}:** ${count}`);
		}

		lines.push("", "## Recent Entries", "");

		const recent = this.recent(20);

		for (const entry of recent) {
			lines.push(`### ${entry.title}`);
			lines.push("");
			lines.push(`**Type:** ${entry.type} | **Component:** ${entry.component} | **Time:** ${entry.timestamp}`);

			if (entry.metadata?.outcome) {
				lines.push(`**Outcome:** ${entry.metadata.outcome}`);
			}

			lines.push("");
			lines.push(entry.content);
			lines.push("");
			lines.push("---");
			lines.push("");
		}

		return lines.join("\n");
	}
}

/**
 * Convenience functions for common history operations
 */
export const History = {
	/**
	 * Create a task entry
	 */
	task: (
		component: string,
		title: string,
		content: string,
		metadata?: HistoryEntry["metadata"],
	): Omit<HistoryEntry, "id" | "timestamp"> => ({
		type: "task",
		component,
		title,
		content,
		metadata,
	}),

	/**
	 * Create a learning entry
	 */
	learning: (
		component: string,
		title: string,
		content: string,
		metadata?: HistoryEntry["metadata"],
	): Omit<HistoryEntry, "id" | "timestamp"> => ({
		type: "learning",
		component,
		title,
		content,
		metadata,
	}),

	/**
	 * Create an error entry
	 */
	error: (
		component: string,
		title: string,
		content: string,
		metadata?: HistoryEntry["metadata"],
	): Omit<HistoryEntry, "id" | "timestamp"> => ({
		type: "error",
		component,
		title,
		content,
		metadata: { ...metadata, outcome: "failure" },
	}),

	/**
	 * Create a success entry
	 */
	success: (
		component: string,
		title: string,
		content: string,
		metadata?: HistoryEntry["metadata"],
	): Omit<HistoryEntry, "id" | "timestamp"> => ({
		type: "success",
		component,
		title,
		content,
		metadata: { ...metadata, outcome: "success" },
	}),

	/**
	 * Create a decision entry
	 */
	decision: (
		component: string,
		title: string,
		content: string,
		metadata?: HistoryEntry["metadata"],
	): Omit<HistoryEntry, "id" | "timestamp"> => ({
		type: "decision",
		component,
		title,
		content,
		metadata,
	}),
};
