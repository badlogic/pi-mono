/**
 * Summary cache for instant compaction.
 * Pure functions for cache file operations.
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import type { CompactionEntry, SessionEntry } from "./session-manager.js";

// ============================================================================
// Types
// ============================================================================

export interface SummaryCache {
	version: 1;
	firstKeptEntryIndex: number;
	generatedAt: string;
	summary: string;
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Get cache file path for a session file.
 */
export function getCacheFilePath(sessionFile: string): string {
	return sessionFile.replace(/\.jsonl$/, ".summary.json");
}

/**
 * Load cache from file. Returns null if missing or invalid.
 */
export function loadSummaryCache(sessionFile: string): SummaryCache | null {
	const cacheFile = getCacheFilePath(sessionFile);
	if (!existsSync(cacheFile)) return null;

	try {
		const content = readFileSync(cacheFile, "utf8");
		const cache = JSON.parse(content) as SummaryCache;

		// Validate
		if (cache.version !== 1) return null;
		if (typeof cache.firstKeptEntryIndex !== "number") return null;
		if (typeof cache.summary !== "string") return null;

		return cache;
	} catch {
		return null;
	}
}

/**
 * Save cache to file (atomic write via temp file).
 */
export function saveSummaryCache(sessionFile: string, cache: SummaryCache): void {
	const cacheFile = getCacheFilePath(sessionFile);
	const tempFile = cacheFile + ".tmp";

	writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf8");
	renameSync(tempFile, cacheFile);
}

/**
 * Delete cache file if it exists.
 */
export function deleteSummaryCache(sessionFile: string): void {
	const cacheFile = getCacheFilePath(sessionFile);
	if (existsSync(cacheFile)) {
		try {
			unlinkSync(cacheFile);
		} catch {
			// Ignore errors (file may have been deleted concurrently)
		}
	}
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if cache is valid for current session state.
 *
 * Cache is invalid if:
 * - Entry count decreased (branch/reset happened)
 * - A compaction entry exists after the cached cut point
 */
export function isCacheValid(cache: SummaryCache, entries: SessionEntry[]): boolean {
	// Entry count decreased means branch or reset
	if (entries.length < cache.firstKeptEntryIndex) {
		return false;
	}

	// Check for compaction after the cached cut point
	for (let i = cache.firstKeptEntryIndex; i < entries.length; i++) {
		if (entries[i].type === "compaction") {
			return false;
		}
	}

	return true;
}

/**
 * Check if cache covers enough to skip LLM summarization.
 *
 * Cache is sufficient if firstKeptEntryIndex matches or is close to
 * what a fresh compaction would calculate.
 */
export function isCacheSufficient(cache: SummaryCache, currentCutPoint: number): boolean {
	// Cache is sufficient if it covers at least as much as current cut point
	// (or within a small margin - a few new messages since cache was generated is OK)
	const margin = 3; // Allow up to 3 new entries since cache generation
	return cache.firstKeptEntryIndex >= currentCutPoint - margin;
}

// ============================================================================
// Compaction Helper
// ============================================================================

/**
 * Create a CompactionEntry from cached summary.
 */
export function createCompactionFromCache(cache: SummaryCache, tokensBefore: number): CompactionEntry {
	return {
		type: "compaction",
		timestamp: new Date().toISOString(),
		summary: cache.summary,
		firstKeptEntryIndex: cache.firstKeptEntryIndex,
		tokensBefore,
	};
}
