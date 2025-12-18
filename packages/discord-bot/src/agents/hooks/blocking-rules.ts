/**
 * Blocking Rules System for Agent Hooks
 *
 * Allows configurable tool blocking based on patterns.
 * Rules are stored per-channel in SQLite.
 *
 * Features:
 * - Pattern-based command blocking (regex support)
 * - Per-channel rule isolation
 * - Audit logging of blocked actions
 * - Rule priority system
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";

// ============================================================================
// Types
// ============================================================================

export interface BlockingRule {
	id: number;
	channelId: string;
	toolName: string;
	pattern: string;
	reason: string;
	priority: number;
	enabled: boolean;
	createdAt: number;
	createdBy?: string;
}

export interface BlockingResult {
	blocked: boolean;
	rule?: BlockingRule;
	reason?: string;
}

export interface BlockedAction {
	id: number;
	channelId: string;
	toolName: string;
	input: string;
	ruleId: number;
	reason: string;
	timestamp: number;
}

// ============================================================================
// Database Setup
// ============================================================================

let db: Database.Database | null = null;

function getDb(dataDir: string): Database.Database {
	if (db) return db;

	const dbPath = join(dataDir, "hooks", "blocking-rules.db");
	const dbDir = dirname(dbPath);
	if (!existsSync(dbDir)) {
		mkdirSync(dbDir, { recursive: true });
	}

	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");

	// Create tables
	db.exec(`
		CREATE TABLE IF NOT EXISTS blocking_rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			channel_id TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			pattern TEXT NOT NULL,
			reason TEXT NOT NULL,
			priority INTEGER DEFAULT 0,
			enabled INTEGER DEFAULT 1,
			created_at INTEGER NOT NULL,
			created_by TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_rules_channel ON blocking_rules(channel_id);
		CREATE INDEX IF NOT EXISTS idx_rules_enabled ON blocking_rules(enabled);

		CREATE TABLE IF NOT EXISTS blocked_actions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			channel_id TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			input TEXT NOT NULL,
			rule_id INTEGER NOT NULL,
			reason TEXT NOT NULL,
			timestamp INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_blocked_channel ON blocked_actions(channel_id);
		CREATE INDEX IF NOT EXISTS idx_blocked_timestamp ON blocked_actions(timestamp);
	`);

	return db;
}

// ============================================================================
// Rule Management
// ============================================================================

/**
 * Add a new blocking rule
 */
export function addBlockingRule(
	dataDir: string,
	channelId: string,
	toolName: string,
	pattern: string,
	reason: string,
	options: { priority?: number; createdBy?: string } = {},
): BlockingRule {
	const db = getDb(dataDir);
	const { priority = 0, createdBy } = options;

	// Validate regex pattern
	try {
		new RegExp(pattern);
	} catch (e) {
		throw new Error(`Invalid regex pattern: ${pattern}`);
	}

	const stmt = db.prepare(`
		INSERT INTO blocking_rules (channel_id, tool_name, pattern, reason, priority, enabled, created_at, created_by)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?)
	`);

	const result = stmt.run(channelId, toolName, pattern, reason, priority, Date.now(), createdBy || null);

	return {
		id: result.lastInsertRowid as number,
		channelId,
		toolName,
		pattern,
		reason,
		priority,
		enabled: true,
		createdAt: Date.now(),
		createdBy,
	};
}

/**
 * Remove a blocking rule
 */
export function removeBlockingRule(dataDir: string, ruleId: number, channelId: string): boolean {
	const db = getDb(dataDir);
	const stmt = db.prepare("DELETE FROM blocking_rules WHERE id = ? AND channel_id = ?");
	const result = stmt.run(ruleId, channelId);
	return result.changes > 0;
}

/**
 * List blocking rules for a channel
 */
export function listBlockingRules(dataDir: string, channelId: string): BlockingRule[] {
	const db = getDb(dataDir);
	const stmt = db.prepare(`
		SELECT id, channel_id as channelId, tool_name as toolName, pattern, reason,
		       priority, enabled, created_at as createdAt, created_by as createdBy
		FROM blocking_rules
		WHERE channel_id = ?
		ORDER BY priority DESC, created_at DESC
	`);
	return stmt.all(channelId) as BlockingRule[];
}

/**
 * Enable or disable a rule
 */
export function setRuleEnabled(dataDir: string, ruleId: number, channelId: string, enabled: boolean): boolean {
	const db = getDb(dataDir);
	const stmt = db.prepare("UPDATE blocking_rules SET enabled = ? WHERE id = ? AND channel_id = ?");
	const result = stmt.run(enabled ? 1 : 0, ruleId, channelId);
	return result.changes > 0;
}

/**
 * Get a specific rule
 */
export function getBlockingRule(dataDir: string, ruleId: number): BlockingRule | null {
	const db = getDb(dataDir);
	const stmt = db.prepare(`
		SELECT id, channel_id as channelId, tool_name as toolName, pattern, reason,
		       priority, enabled, created_at as createdAt, created_by as createdBy
		FROM blocking_rules WHERE id = ?
	`);
	return (stmt.get(ruleId) as BlockingRule) || null;
}

// ============================================================================
// Blocking Logic
// ============================================================================

/**
 * Check if an action should be blocked
 */
export function checkBlocking(
	dataDir: string,
	channelId: string,
	toolName: string,
	input: Record<string, unknown>,
): BlockingResult {
	const db = getDb(dataDir);

	// Get enabled rules for this channel, matching tool or wildcard
	const stmt = db.prepare(`
		SELECT id, channel_id as channelId, tool_name as toolName, pattern, reason,
		       priority, enabled, created_at as createdAt, created_by as createdBy
		FROM blocking_rules
		WHERE channel_id = ? AND enabled = 1 AND (tool_name = ? OR tool_name = '*')
		ORDER BY priority DESC
	`);
	const rules = stmt.all(channelId, toolName) as BlockingRule[];

	// Serialize input for pattern matching
	const inputStr = JSON.stringify(input);

	for (const rule of rules) {
		try {
			const regex = new RegExp(rule.pattern, "i");
			if (regex.test(inputStr)) {
				// Log the blocked action
				logBlockedAction(dataDir, channelId, toolName, inputStr, rule);
				return {
					blocked: true,
					rule,
					reason: rule.reason,
				};
			}
		} catch {
			// Skip invalid regex
		}
	}

	return { blocked: false };
}

/**
 * Log a blocked action
 */
function logBlockedAction(
	dataDir: string,
	channelId: string,
	toolName: string,
	input: string,
	rule: BlockingRule,
): void {
	const db = getDb(dataDir);
	const stmt = db.prepare(`
		INSERT INTO blocked_actions (channel_id, tool_name, input, rule_id, reason, timestamp)
		VALUES (?, ?, ?, ?, ?, ?)
	`);
	stmt.run(channelId, toolName, input.substring(0, 1000), rule.id, rule.reason, Date.now());
}

/**
 * Get blocked actions log for a channel
 */
export function getBlockedActions(dataDir: string, channelId: string, limit = 20): BlockedAction[] {
	const db = getDb(dataDir);
	const stmt = db.prepare(`
		SELECT id, channel_id as channelId, tool_name as toolName, input,
		       rule_id as ruleId, reason, timestamp
		FROM blocked_actions
		WHERE channel_id = ?
		ORDER BY timestamp DESC
		LIMIT ?
	`);
	return stmt.all(channelId, limit) as BlockedAction[];
}

/**
 * Clear blocked actions log
 */
export function clearBlockedActions(dataDir: string, channelId: string): number {
	const db = getDb(dataDir);
	const stmt = db.prepare("DELETE FROM blocked_actions WHERE channel_id = ?");
	const result = stmt.run(channelId);
	return result.changes;
}

// ============================================================================
// Preset Rules
// ============================================================================

/**
 * Common dangerous command patterns
 */
export const PRESET_RULES: Array<{
	toolName: string;
	pattern: string;
	reason: string;
	priority: number;
}> = [
	{
		toolName: "bash",
		pattern: "rm\\s+-rf\\s+[/~]",
		reason: "Dangerous recursive delete of system directories",
		priority: 100,
	},
	{
		toolName: "bash",
		pattern: ":(){ :|:& };:",
		reason: "Fork bomb detected",
		priority: 100,
	},
	{
		toolName: "bash",
		pattern: "dd\\s+if=.*/dev/(zero|random|urandom)\\s+of=.*/dev/[hs]d",
		reason: "Dangerous disk write operation",
		priority: 100,
	},
	{
		toolName: "bash",
		pattern: "chmod\\s+-R\\s+777\\s+/",
		reason: "Dangerous permission change on root",
		priority: 90,
	},
	{
		toolName: "bash",
		pattern: "curl.*\\|\\s*(sudo\\s+)?bash",
		reason: "Piping curl to bash is dangerous",
		priority: 80,
	},
	{
		toolName: "bash",
		pattern: "wget.*\\|\\s*(sudo\\s+)?bash",
		reason: "Piping wget to bash is dangerous",
		priority: 80,
	},
	{
		toolName: "write",
		pattern: "\\.env|\\.ssh|credentials|secret",
		reason: "Writing to sensitive file",
		priority: 70,
	},
];

/**
 * Apply preset rules to a channel
 */
export function applyPresetRules(dataDir: string, channelId: string, createdBy?: string): number {
	let added = 0;
	for (const preset of PRESET_RULES) {
		try {
			addBlockingRule(dataDir, channelId, preset.toolName, preset.pattern, preset.reason, {
				priority: preset.priority,
				createdBy,
			});
			added++;
		} catch {
			// Skip duplicates or errors
		}
	}
	return added;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Close database connection
 */
export function closeBlockingRulesDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

/**
 * Export utilities
 */
export const BlockingRulesUtils = {
	addBlockingRule,
	removeBlockingRule,
	listBlockingRules,
	setRuleEnabled,
	getBlockingRule,
	checkBlocking,
	getBlockedActions,
	clearBlockedActions,
	applyPresetRules,
	closeBlockingRulesDb,
	PRESET_RULES,
};
