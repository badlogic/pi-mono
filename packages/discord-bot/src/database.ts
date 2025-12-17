/**
 * SQLite Database Layer for Pi Discord Bot
 * Provides persistent storage for users, alerts, command history, and settings
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface User {
	id: number;
	discord_id: string;
	created_at: string;
	settings_json: string;
}

export interface Alert {
	id: number;
	user_id: string;
	symbol: string;
	condition: ">" | "<";
	price: number;
	created_at: string;
	triggered_at: string | null;
}

export interface CommandHistory {
	id: number;
	user_id: string;
	command: string;
	args: string;
	timestamp: string;
	response_time_ms: number;
}

export interface Setting {
	key: string;
	value: string;
	updated_at: string;
}

export interface ScheduledTaskDB {
	id: string;
	name: string;
	cron_expression: string;
	action: string;
	channel_id: string;
	user_id: string;
	enabled: number; // SQLite doesn't have boolean, 0 or 1
	last_run: string | null;
	created_at: string;
}

export class BotDatabase {
	private db: Database.Database;

	constructor(dbPath: string) {
		// Ensure directory exists
		const dir = dirname(dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL"); // Better concurrency
		this.initializeTables();
	}

	private initializeTables(): void {
		// Users table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				discord_id TEXT UNIQUE NOT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				settings_json TEXT DEFAULT '{}'
			)
		`);

		// Alerts table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS alerts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				symbol TEXT NOT NULL,
				condition TEXT CHECK(condition IN ('>', '<')) NOT NULL,
				price REAL NOT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				triggered_at TEXT DEFAULT NULL,
				FOREIGN KEY (user_id) REFERENCES users(discord_id)
			)
		`);

		// Command history table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS command_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				command TEXT NOT NULL,
				args TEXT NOT NULL DEFAULT '',
				timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				response_time_ms INTEGER NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(discord_id)
			)
		`);

		// Settings table (key-value store)
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Scheduled tasks table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS scheduled_tasks (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				cron_expression TEXT NOT NULL,
				action TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				last_run TEXT DEFAULT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(discord_id)
			)
		`);

		// Create indexes for better performance
		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
			CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts(triggered_at);
			CREATE INDEX IF NOT EXISTS idx_command_history_user_id ON command_history(user_id);
			CREATE INDEX IF NOT EXISTS idx_command_history_timestamp ON command_history(timestamp);
			CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
			CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
		`);
	}

	// ========================================================================
	// User Methods
	// ========================================================================

	public ensureUser(discordId: string): void {
		const stmt = this.db.prepare(`
			INSERT OR IGNORE INTO users (discord_id) VALUES (?)
		`);
		stmt.run(discordId);
	}

	public getUser(discordId: string): User | undefined {
		const stmt = this.db.prepare(`
			SELECT * FROM users WHERE discord_id = ?
		`);
		return stmt.get(discordId) as User | undefined;
	}

	public getUserSettings(discordId: string): Record<string, any> {
		const user = this.getUser(discordId);
		if (!user) return {};
		try {
			return JSON.parse(user.settings_json);
		} catch {
			return {};
		}
	}

	public updateUserSettings(discordId: string, settings: Record<string, any>): void {
		this.ensureUser(discordId);
		const stmt = this.db.prepare(`
			UPDATE users SET settings_json = ? WHERE discord_id = ?
		`);
		stmt.run(JSON.stringify(settings), discordId);
	}

	// ========================================================================
	// Alert Methods
	// ========================================================================

	public saveAlert(userId: string, symbol: string, condition: ">" | "<", price: number): number {
		this.ensureUser(userId);
		const stmt = this.db.prepare(`
			INSERT INTO alerts (user_id, symbol, condition, price)
			VALUES (?, ?, ?, ?)
		`);
		const result = stmt.run(userId, symbol.toUpperCase(), condition, price);
		return result.lastInsertRowid as number;
	}

	public getAlerts(userId?: string, activeOnly: boolean = true): Alert[] {
		let query = `SELECT * FROM alerts`;
		const params: any[] = [];

		const conditions: string[] = [];
		if (userId) {
			conditions.push("user_id = ?");
			params.push(userId);
		}
		if (activeOnly) {
			conditions.push("triggered_at IS NULL");
		}

		if (conditions.length > 0) {
			query += " WHERE " + conditions.join(" AND ");
		}

		query += " ORDER BY created_at DESC";

		const stmt = this.db.prepare(query);
		return stmt.all(...params) as Alert[];
	}

	public getAlertById(alertId: number): Alert | undefined {
		const stmt = this.db.prepare(`
			SELECT * FROM alerts WHERE id = ?
		`);
		return stmt.get(alertId) as Alert | undefined;
	}

	public triggerAlert(alertId: number): void {
		const stmt = this.db.prepare(`
			UPDATE alerts SET triggered_at = CURRENT_TIMESTAMP WHERE id = ?
		`);
		stmt.run(alertId);
	}

	public deleteAlert(alertId: number): void {
		const stmt = this.db.prepare(`
			DELETE FROM alerts WHERE id = ?
		`);
		stmt.run(alertId);
	}

	public getUserAlertCount(userId: string, activeOnly: boolean = true): number {
		let query = `SELECT COUNT(*) as count FROM alerts WHERE user_id = ?`;
		if (activeOnly) {
			query += " AND triggered_at IS NULL";
		}
		const stmt = this.db.prepare(query);
		const result = stmt.get(userId) as { count: number };
		return result.count;
	}

	// ========================================================================
	// Command History Methods
	// ========================================================================

	public logCommand(userId: string, command: string, args: string, responseTimeMs: number): void {
		this.ensureUser(userId);
		const stmt = this.db.prepare(`
			INSERT INTO command_history (user_id, command, args, response_time_ms)
			VALUES (?, ?, ?, ?)
		`);
		stmt.run(userId, command, args, responseTimeMs);
	}

	public getCommandHistory(userId?: string, limit: number = 100): CommandHistory[] {
		let query = `SELECT * FROM command_history`;
		const params: any[] = [];

		if (userId) {
			query += " WHERE user_id = ?";
			params.push(userId);
		}

		query += ` ORDER BY timestamp DESC LIMIT ?`;
		params.push(limit);

		const stmt = this.db.prepare(query);
		return stmt.all(...params) as CommandHistory[];
	}

	public getCommandStats(userId?: string): {
		total: number;
		avgResponseTime: number;
		topCommands: Array<{ command: string; count: number }>;
	} {
		let baseQuery = "";
		const params: any[] = [];

		if (userId) {
			baseQuery = " WHERE user_id = ?";
			params.push(userId);
		}

		// Total and average response time
		const stmt1 = this.db.prepare(`
			SELECT
				COUNT(*) as total,
				AVG(response_time_ms) as avg_time
			FROM command_history${baseQuery}
		`);
		const basicStats = stmt1.get(...params) as { total: number; avg_time: number };

		// Top commands
		const stmt2 = this.db.prepare(`
			SELECT command, COUNT(*) as count
			FROM command_history${baseQuery}
			GROUP BY command
			ORDER BY count DESC
			LIMIT 10
		`);
		const topCommands = stmt2.all(...params) as Array<{ command: string; count: number }>;

		return {
			total: basicStats.total,
			avgResponseTime: Math.round(basicStats.avg_time || 0),
			topCommands,
		};
	}

	// ========================================================================
	// Settings Methods
	// ========================================================================

	public getSetting(key: string, defaultValue?: string): string | undefined {
		const stmt = this.db.prepare(`
			SELECT value FROM settings WHERE key = ?
		`);
		const result = stmt.get(key) as { value: string } | undefined;
		return result ? result.value : defaultValue;
	}

	public setSetting(key: string, value: string): void {
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO settings (key, value, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
		`);
		stmt.run(key, value);
	}

	public getAllSettings(): Setting[] {
		const stmt = this.db.prepare(`
			SELECT * FROM settings ORDER BY key
		`);
		return stmt.all() as Setting[];
	}

	// ========================================================================
	// Scheduled Tasks Methods
	// ========================================================================

	public upsertScheduledTask(task: ScheduledTaskDB): void {
		this.ensureUser(task.user_id);
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO scheduled_tasks
			(id, name, cron_expression, action, channel_id, user_id, enabled, last_run, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			task.id,
			task.name,
			task.cron_expression,
			task.action,
			task.channel_id,
			task.user_id,
			task.enabled,
			task.last_run,
			task.created_at,
		);
	}

	public getScheduledTask(taskId: string): ScheduledTaskDB | undefined {
		const stmt = this.db.prepare(`
			SELECT * FROM scheduled_tasks WHERE id = ?
		`);
		return stmt.get(taskId) as ScheduledTaskDB | undefined;
	}

	public getAllScheduledTasks(userId?: string): ScheduledTaskDB[] {
		let query = `SELECT * FROM scheduled_tasks`;
		const params: any[] = [];

		if (userId) {
			query += " WHERE user_id = ?";
			params.push(userId);
		}

		query += " ORDER BY created_at DESC";

		const stmt = this.db.prepare(query);
		return stmt.all(...params) as ScheduledTaskDB[];
	}

	public deleteScheduledTask(taskId: string): void {
		const stmt = this.db.prepare(`
			DELETE FROM scheduled_tasks WHERE id = ?
		`);
		stmt.run(taskId);
	}

	public updateTaskLastRun(taskId: string, lastRun: string): void {
		const stmt = this.db.prepare(`
			UPDATE scheduled_tasks SET last_run = ? WHERE id = ?
		`);
		stmt.run(lastRun, taskId);
	}

	public toggleScheduledTask(taskId: string): boolean {
		const task = this.getScheduledTask(taskId);
		if (!task) return false;

		const newEnabled = task.enabled === 1 ? 0 : 1;
		const stmt = this.db.prepare(`
			UPDATE scheduled_tasks SET enabled = ? WHERE id = ?
		`);
		stmt.run(newEnabled, taskId);
		return newEnabled === 1;
	}

	// ========================================================================
	// Maintenance Methods
	// ========================================================================

	public vacuum(): void {
		this.db.exec("VACUUM");
	}

	public getStats(): {
		users: number;
		alerts: number;
		activeAlerts: number;
		commands: number;
		scheduledTasks: number;
		dbSize: number;
	} {
		const userCount = (this.db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
		const alertCount = (this.db.prepare("SELECT COUNT(*) as count FROM alerts").get() as { count: number }).count;
		const activeAlertCount = (
			this.db.prepare("SELECT COUNT(*) as count FROM alerts WHERE triggered_at IS NULL").get() as { count: number }
		).count;
		const commandCount = (this.db.prepare("SELECT COUNT(*) as count FROM command_history").get() as { count: number })
			.count;
		const scheduledTaskCount = (
			this.db.prepare("SELECT COUNT(*) as count FROM scheduled_tasks").get() as { count: number }
		).count;

		return {
			users: userCount,
			alerts: alertCount,
			activeAlerts: activeAlertCount,
			commands: commandCount,
			scheduledTasks: scheduledTaskCount,
			dbSize: 0, // Would need fs.statSync to get actual size
		};
	}

	public close(): void {
		this.db.close();
	}
}

// Export singleton instance
let dbInstance: BotDatabase | null = null;

export function initDatabase(dbPath: string): BotDatabase {
	if (!dbInstance) {
		dbInstance = new BotDatabase(dbPath);
	}
	return dbInstance;
}

export function getDatabase(): BotDatabase {
	if (!dbInstance) {
		throw new Error("Database not initialized. Call initDatabase() first.");
	}
	return dbInstance;
}
