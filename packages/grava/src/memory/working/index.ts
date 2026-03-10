/**
 * Layer 6.1: Working Memory · 工作记忆
 *
 * Current session context — equivalent to the brain's immediate processing buffer.
 * Wraps pi-agent-core's AgentState for context window management.
 *
 * - Context window management
 * - Auto-compaction (summarize / truncate / hybrid)
 */

import type { WorkingMemoryConfig } from "../../types.js";

export interface WorkingMemoryEntry {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	tokenEstimate: number;
}

export class WorkingMemory {
	private entries: WorkingMemoryEntry[] = [];
	private totalTokens = 0;

	constructor(private config: WorkingMemoryConfig = {}) {
		this.config.maxTokens ??= 128_000;
		this.config.compactionStrategy ??= "hybrid";
	}

	get currentTokens(): number {
		return this.totalTokens;
	}

	get maxTokens(): number {
		return this.config.maxTokens!;
	}

	/** Add an entry to working memory */
	add(entry: Omit<WorkingMemoryEntry, "tokenEstimate">): void {
		const tokenEstimate = Math.ceil(entry.content.length / 4);
		const fullEntry = { ...entry, tokenEstimate };
		this.entries.push(fullEntry);
		this.totalTokens += tokenEstimate;

		// Auto-compact if over budget
		if (this.totalTokens > this.config.maxTokens!) {
			this.compact();
		}
	}

	/** Get all current entries */
	getEntries(): WorkingMemoryEntry[] {
		return [...this.entries];
	}

	/** Get entries formatted for LLM context */
	toContext(): { role: string; content: string }[] {
		return this.entries.map((e) => ({ role: e.role, content: e.content }));
	}

	/** Compact the context to fit within token budget */
	compact(): void {
		const strategy = this.config.compactionStrategy!;

		switch (strategy) {
			case "truncate":
				this.truncateOldest();
				break;
			case "summarize":
				// In production, call LLM to summarize older entries
				this.truncateOldest();
				break;
			case "hybrid":
				// Keep system messages and recent entries, truncate middle
				this.hybridCompact();
				break;
		}
	}

	/** Clear all entries */
	clear(): void {
		this.entries = [];
		this.totalTokens = 0;
	}

	private truncateOldest(): void {
		while (this.totalTokens > this.config.maxTokens! && this.entries.length > 1) {
			const removed = this.entries.shift()!;
			this.totalTokens -= removed.tokenEstimate;
		}
	}

	private hybridCompact(): void {
		// Keep system messages and last N entries
		const systemEntries = this.entries.filter((e) => e.role === "system");
		const nonSystem = this.entries.filter((e) => e.role !== "system");

		// Keep the most recent entries that fit
		const kept: WorkingMemoryEntry[] = [...systemEntries];
		let tokens = systemEntries.reduce((sum, e) => sum + e.tokenEstimate, 0);

		for (let i = nonSystem.length - 1; i >= 0; i--) {
			if (tokens + nonSystem[i].tokenEstimate > this.config.maxTokens!) break;
			kept.unshift(nonSystem[i]);
			tokens += nonSystem[i].tokenEstimate;
		}

		this.entries = kept;
		this.totalTokens = tokens;
	}
}
