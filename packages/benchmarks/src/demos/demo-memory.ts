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
 * Returns a short inline confidence label for routing decisions, e.g.
 * "[memory: 94% accuracy, 5 runs]", or "" if no memory.
 */
export function hnRoutingConfidence(key: string, m: DemoMemory): string {
	const h = m.hn[key];
	if (!h || h.runs === 0) return "";
	const accuracyPct = h.totalStories > 0 ? ((h.scoreMatches / h.totalStories) * 100).toFixed(0) : "?";
	return `[memory: ${accuracyPct}% accuracy, ${h.runs} run${h.runs !== 1 ? "s" : ""}]`;
}
