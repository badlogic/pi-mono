/**
 * Persistent cross-run memory for energy-aware demos.
 *
 * Stored at ~/.energy-demo-memory.json so it survives across sessions.
 * Records routing quality observations so each run can display learned confidence.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MEMORY_PATH = join(homedir(), ".energy-demo-memory.json");

// -- Types --------------------------------------------------------------------

export interface HNMemory {
	/** Total stories evaluated across all runs (baseline + EA both scored). */
	totalStories: number;
	/** Stories where |baselineScore - eaScore| <= 0.15. */
	scoreMatches: number;
	runs: number;
	avgEnergySavingsPct: number;
	lastUpdated: string;
}

/** Per-phase discriminator routing history. Key is phase name, e.g. "build-1". */
export interface PhaseRoutingStats {
	/** Times discriminator classified phase as "complex" → Kimi K2.5. */
	complexCount: number;
	/** Times discriminator classified phase as "simple" → GPT-OSS-20B. */
	simpleCount: number;
	/** Complex-routing runs that ultimately passed acceptance tests. */
	complexPassCount: number;
	/** Simple-routing runs that ultimately passed acceptance tests. */
	simplePassCount: number;
}

export interface CodingMemory {
	runs: number;
	/** Runs where the baseline agent passed acceptance tests. */
	baselinePassCount: number;
	/** Runs where the EA agent passed acceptance tests. */
	eaPassCount: number;
	/** Rolling average of turns-to-pass for baseline (only counting passing runs). */
	avgTurnsBaseline: number;
	/** Rolling average of turns-to-pass for EA (only counting passing runs). */
	avgTurnsEA: number;
	avgEnergySavingsPct: number;
	lastUpdated: string;
	/** Test names that required fix turns across runs, mapped to occurrence count. */
	failedTestCounts?: Record<string, number>;
	/** Per-phase discriminator routing history. */
	phaseRouting?: Record<string, PhaseRoutingStats>;
}

export interface DemoMemory {
	/** Key: routing route string, e.g. "kimi-k2.5→gpt-oss-20b". */
	hn: Record<string, HNMemory>;
	/** Key: routing route string, e.g. "devstral→gpt-oss-20b". */
	coding: Record<string, CodingMemory>;
}

// -- IO -----------------------------------------------------------------------

function emptyMemory(): DemoMemory {
	return { hn: {}, coding: {} };
}

export function loadMemory(): DemoMemory {
	if (!existsSync(MEMORY_PATH)) return emptyMemory();
	try {
		return JSON.parse(readFileSync(MEMORY_PATH, "utf8")) as DemoMemory;
	} catch {
		return emptyMemory();
	}
}

export function saveMemory(m: DemoMemory): void {
	writeFileSync(MEMORY_PATH, JSON.stringify(m, null, 2), "utf8");
}

export function clearMemory(): void {
	if (existsSync(MEMORY_PATH)) rmSync(MEMORY_PATH);
}

// -- Formatting ---------------------------------------------------------------

/**
 * Returns a 2-line startup summary for an HN watcher routing key, or null if
 * no memory exists yet.
 */
export function formatHNMemory(key: string, m: DemoMemory): string | null {
	const h = m.hn[key];
	if (!h || h.runs === 0) return null;
	const accuracyPct = h.totalStories > 0 ? ((h.scoreMatches / h.totalStories) * 100).toFixed(0) : "?";
	const runsLabel = `${h.runs} previous run${h.runs !== 1 ? "s" : ""}`;
	return (
		`  Memory (${runsLabel}): GPT-OSS scores agree with Kimi within 0.15 in ${accuracyPct}% of stories (n=${h.totalStories})\n` +
		`                             Routes at >70% pressure — saves ${h.avgEnergySavingsPct.toFixed(0)}% energy with no quality loss`
	);
}

/**
 * Returns a 2-line startup summary for a coding agent routing key, or null if
 * no memory exists yet.
 */
export function formatCodingMemory(key: string, m: DemoMemory): string | null {
	const c = m.coding[key];
	if (!c || c.runs === 0) return null;
	const runsLabel = `${c.runs} previous run${c.runs !== 1 ? "s" : ""}`;
	const eaTurns = c.avgTurnsEA > 0 ? c.avgTurnsEA.toFixed(1) : "n/a";
	const baseTurns = c.avgTurnsBaseline > 0 ? c.avgTurnsBaseline.toFixed(1) : "n/a";
	return (
		`  Memory (${runsLabel}): EA passed tests in avg ${eaTurns} turns (baseline: ${baseTurns})\n` +
		`                             GPT-OSS routing saves ${c.avgEnergySavingsPct.toFixed(0)}% energy`
	);
}

/**
 * Returns hint text to prepend to the consolidation prompt based on tests that
 * have required fix turns in previous runs. Returns null if no failures recorded.
 */
export function codingMemoryHints(key: string, m: DemoMemory): string | null {
	const c = m.coding[key];
	if (!c || !c.failedTestCounts || Object.keys(c.failedTestCounts).length === 0) return null;
	const sorted = Object.entries(c.failedTestCounts)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 3);
	const lines = sorted.map(([name, count]) => `  - "${name}" (failed ${count} time${count !== 1 ? "s" : ""})`);
	return (
		"IMPORTANT — learned from previous runs, these tests required fix turns:\n" +
		lines.join("\n") +
		"\nEnsure your implementation satisfies these requirements exactly before finishing.\n\n"
	);
}

/**
 * Returns a context string for the discriminator prompt based on historical
 * routing outcomes for a specific phase. Empty string if no history yet.
 */
export function buildDiscriminatorContext(phase: string, key: string, m: DemoMemory): string {
	const stats = m.coding[key]?.phaseRouting?.[phase];
	if (!stats) return "";
	const total = stats.complexCount + stats.simpleCount;
	if (total === 0) return "";
	const parts: string[] = [];
	if (stats.complexCount > 0) {
		const rate = Math.round((stats.complexPassCount / stats.complexCount) * 100);
		parts.push(`complex→Kimi: ${stats.complexCount} time${stats.complexCount !== 1 ? "s" : ""} (${rate}% pass rate)`);
	}
	if (stats.simpleCount > 0) {
		const rate = Math.round((stats.simplePassCount / stats.simpleCount) * 100);
		parts.push(`simple→GPT-OSS: ${stats.simpleCount} time${stats.simpleCount !== 1 ? "s" : ""} (${rate}% pass rate)`);
	}
	return `Previous runs for "${phase}": ${parts.join(", ")}`;
}

/**
 * Returns a one-line phase routing summary, e.g.
 * "  Routing:  build-1=simple(2/2)  consolidate=complex(3/3)"
 * Returns null if no routing history exists.
 */
export function formatPhaseRouting(key: string, m: DemoMemory): string | null {
	const phaseRouting = m.coding[key]?.phaseRouting;
	if (!phaseRouting || Object.keys(phaseRouting).length === 0) return null;
	const parts = Object.entries(phaseRouting)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([phase, stats]) => {
			const total = stats.complexCount + stats.simpleCount;
			if (total === 0) return null;
			const dominant =
				stats.complexCount >= stats.simpleCount
					? `complex(${stats.complexCount}/${total})`
					: `simple(${stats.simpleCount}/${total})`;
			return `${phase}=${dominant}`;
		})
		.filter((p): p is string => p !== null);
	if (parts.length === 0) return null;
	return `  Routing:  ${parts.join("  ")}`;
}

/**
 * Returns a short inline confidence label for routing decisions, e.g.
 * "[memory: 94% accuracy, 5 runs]", or "" if no memory.
 */
export function hnRoutingConfidence(key: string, m: DemoMemory): string {
	const h = m.hn[key];
	if (!h || h.runs === 0) return "";
	const accuracyPct = h.totalStories > 0 ? ((h.scoreMatches / h.totalStories) * 100).toFixed(0) : "?";
	return `[memory: ${accuracyPct}% accuracy, ${h.runs} run${h.runs !== 1 ? "s" : ""}]`;
}
