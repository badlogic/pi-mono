/**
 * Layer 6.2: Episodic Memory · 情景记忆
 *
 * "发生过什么" — Session summaries, event logs, timelines.
 * Equivalent to the hippocampus in the brain.
 *
 * - Session persistence and summarization
 * - Timestamp indexing
 * - Time-based retrieval
 */

import type { Episode, EpisodicMemoryConfig } from "../../types.js";

export class EpisodicMemory {
	private episodes: Episode[] = [];

	constructor(private config: EpisodicMemoryConfig = {}) {
		this.config.autoSummarize ??= true;
		this.config.retentionDays ??= 0; // forever
	}

	/** Record a new episode (session summary) */
	record(episode: Episode): void {
		this.episodes.push(episode);
		this.pruneExpired();
	}

	/** Retrieve episodes by time range */
	getByTimeRange(fromTimestamp: number, toTimestamp: number = Date.now()): Episode[] {
		return this.episodes.filter((e) => e.timestamp >= fromTimestamp && e.timestamp <= toTimestamp);
	}

	/** Search episodes by topic */
	searchByTopic(topic: string): Episode[] {
		const lowerTopic = topic.toLowerCase();
		return this.episodes.filter(
			(e) =>
				e.keyTopics.some((t) => t.toLowerCase().includes(lowerTopic)) ||
				e.summary.toLowerCase().includes(lowerTopic),
		);
	}

	/** Get the N most recent episodes */
	getRecent(count: number = 10): Episode[] {
		return this.episodes.slice(-count);
	}

	/** Get all decisions made across episodes */
	getDecisionTrail(): { decision: string; sessionId: string; timestamp: number }[] {
		return this.episodes.flatMap((e) =>
			e.decisions.map((d) => ({
				decision: d,
				sessionId: e.sessionId,
				timestamp: e.timestamp,
			})),
		);
	}

	/** Get all episodes */
	all(): Episode[] {
		return [...this.episodes];
	}

	/** Total episode count */
	get count(): number {
		return this.episodes.length;
	}

	private pruneExpired(): void {
		if (this.config.retentionDays === 0) return;
		const cutoff = Date.now() - this.config.retentionDays! * 86_400_000;
		this.episodes = this.episodes.filter((e) => e.timestamp >= cutoff);
	}
}
