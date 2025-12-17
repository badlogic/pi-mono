#!/usr/bin/env node
/**
 * Database Migration Script
 * Handles schema updates and migrations for the bot database
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";

interface Migration {
	version: number;
	name: string;
	up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
	{
		version: 1,
		name: "initial_schema",
		up: (_db) => {
			console.log("Running migration 1: Initial schema");
			// Initial schema is handled by BotDatabase constructor
			// This is just a placeholder for future migrations
		},
	},
	{
		version: 2,
		name: "add_alert_channel",
		up: (db) => {
			console.log("Running migration 2: Add channel_id to alerts");
			db.exec(`
				ALTER TABLE alerts ADD COLUMN channel_id TEXT DEFAULT NULL;
			`);
		},
	},
	{
		version: 3,
		name: "add_user_preferences",
		up: (db) => {
			console.log("Running migration 3: Add user preferences");
			db.exec(`
				ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC';
				ALTER TABLE users ADD COLUMN notifications_enabled INTEGER DEFAULT 1;
			`);
		},
	},
	// Add more migrations here as needed
];

function getCurrentVersion(db: Database.Database): number {
	try {
		// Create schema_version table if it doesn't exist
		db.exec(`
			CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER PRIMARY KEY,
				applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		const result = db
			.prepare(`
			SELECT MAX(version) as version FROM schema_version
		`)
			.get() as { version: number | null };

		return result.version || 0;
	} catch (error) {
		console.error("Error getting schema version:", error);
		return 0;
	}
}

function setVersion(db: Database.Database, version: number): void {
	db.prepare(`
		INSERT INTO schema_version (version) VALUES (?)
	`).run(version);
}

function runMigrations(dbPath: string, targetVersion?: number): void {
	if (!existsSync(dbPath)) {
		console.error(`Database not found at: ${dbPath}`);
		console.log("Please initialize the database first by starting the bot.");
		process.exit(1);
	}

	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");

	const currentVersion = getCurrentVersion(db);
	console.log(`Current schema version: ${currentVersion}`);

	const target = targetVersion || Math.max(...migrations.map((m) => m.version));
	const applicableMigrations = migrations
		.filter((m) => m.version > currentVersion && m.version <= target)
		.sort((a, b) => a.version - b.version);

	if (applicableMigrations.length === 0) {
		console.log("Database is up to date!");
		db.close();
		return;
	}

	console.log(`Found ${applicableMigrations.length} migration(s) to apply`);

	for (const migration of applicableMigrations) {
		console.log(`\nApplying migration ${migration.version}: ${migration.name}`);
		try {
			db.transaction(() => {
				migration.up(db);
				setVersion(db, migration.version);
			})();
			console.log(`✓ Migration ${migration.version} completed`);
		} catch (error) {
			console.error(`✗ Migration ${migration.version} failed:`, error);
			db.close();
			process.exit(1);
		}
	}

	const newVersion = getCurrentVersion(db);
	console.log(`\n✓ All migrations completed. Current version: ${newVersion}`);
	db.close();
}

function showStatus(dbPath: string): void {
	if (!existsSync(dbPath)) {
		console.log("Database not found. It will be created on first run.");
		return;
	}

	const db = new Database(dbPath);
	const currentVersion = getCurrentVersion(db);
	const latestVersion = Math.max(...migrations.map((m) => m.version));

	console.log("=== Database Migration Status ===");
	console.log(`Database: ${dbPath}`);
	console.log(`Current Version: ${currentVersion}`);
	console.log(`Latest Version: ${latestVersion}`);

	if (currentVersion < latestVersion) {
		console.log(`\n⚠ Database needs migration!`);
		console.log(`Pending migrations:`);
		migrations
			.filter((m) => m.version > currentVersion)
			.sort((a, b) => a.version - b.version)
			.forEach((m) => {
				console.log(`  ${m.version}: ${m.name}`);
			});
	} else {
		console.log(`\n✓ Database is up to date!`);
	}

	db.close();
}

function rollback(_dbPath: string, _targetVersion: number): void {
	console.error("Rollback not implemented yet.");
	console.log("Backup your database before attempting manual rollback.");
	process.exit(1);
}

// CLI
function main() {
	const args = process.argv.slice(2);
	const command = args[0];
	const dbPath = process.env.DB_PATH || "/opt/discord-bot-data/bot.db";

	switch (command) {
		case "up":
			runMigrations(dbPath);
			break;
		case "status":
			showStatus(dbPath);
			break;
		case "rollback": {
			const version = parseInt(args[1], 10);
			if (Number.isNaN(version)) {
				console.error("Usage: migrate rollback <version>");
				process.exit(1);
			}
			rollback(dbPath, version);
			break;
		}
		default:
			console.log("Pi Discord Bot - Database Migration Tool");
			console.log("\nUsage:");
			console.log("  npm run migrate up          - Run pending migrations");
			console.log("  npm run migrate status      - Show migration status");
			console.log("  npm run migrate rollback N  - Rollback to version N (not implemented)");
			console.log("\nEnvironment:");
			console.log(`  DB_PATH: ${dbPath}`);
			process.exit(0);
	}
}

main();
