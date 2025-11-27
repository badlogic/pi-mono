#!/usr/bin/env npx tsx
/**
 * Migrate log.jsonl timestamps from milliseconds to Slack format (seconds.microseconds)
 * 
 * Usage: npx tsx scripts/migrate-timestamps.ts <data-dir>
 * Example: npx tsx scripts/migrate-timestamps.ts ./data
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

function isMillisecondTimestamp(ts: string): boolean {
	// Slack timestamps are seconds.microseconds, like "1764279530.533489"
	// Millisecond timestamps are just big numbers, like "1764279320398"
	// 
	// Key insight: 
	// - Slack ts from 2025: ~1.7 billion (10 digits before decimal)
	// - Millisecond ts from 2025: ~1.7 trillion (13 digits)
	
	// If it has a decimal and the integer part is < 10^12, it's Slack format
	if (ts.includes(".")) {
		const intPart = parseInt(ts.split(".")[0], 10);
		return intPart > 1e12; // Unlikely to have decimal AND be millis, but check anyway
	}
	
	// No decimal - check if it's too big to be seconds
	const num = parseInt(ts, 10);
	return num > 1e12; // If > 1 trillion, it's milliseconds
}

function convertToSlackTs(msTs: string): string {
	const ms = parseInt(msTs, 10);
	const seconds = Math.floor(ms / 1000);
	const micros = (ms % 1000) * 1000;
	return `${seconds}.${micros.toString().padStart(6, "0")}`;
}

function migrateFile(filePath: string): { total: number; migrated: number } {
	const content = readFileSync(filePath, "utf-8");
	const lines = content.split("\n").filter(Boolean);
	
	let migrated = 0;
	const newLines: string[] = [];
	
	for (const line of lines) {
		try {
			const msg = JSON.parse(line);
			if (msg.ts && isMillisecondTimestamp(msg.ts)) {
				const oldTs = msg.ts;
				msg.ts = convertToSlackTs(msg.ts);
				console.log(`  Converted: ${oldTs} -> ${msg.ts}`);
				migrated++;
			}
			newLines.push(JSON.stringify(msg));
		} catch (e) {
			// Keep malformed lines as-is
			console.log(`  Warning: Could not parse line: ${line.substring(0, 50)}...`);
			newLines.push(line);
		}
	}
	
	if (migrated > 0) {
		writeFileSync(filePath, newLines.join("\n") + "\n", "utf-8");
	}
	
	return { total: lines.length, migrated };
}

function findLogFiles(dir: string): string[] {
	const logFiles: string[] = [];
	
	if (!existsSync(dir)) {
		console.error(`Directory not found: ${dir}`);
		return [];
	}
	
	const entries = readdirSync(dir);
	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		
		if (stat.isDirectory()) {
			// Check for log.jsonl in subdirectory
			const logPath = join(fullPath, "log.jsonl");
			if (existsSync(logPath)) {
				logFiles.push(logPath);
			}
		}
	}
	
	return logFiles;
}

// Main
const dataDir = process.argv[2];
if (!dataDir) {
	console.error("Usage: npx tsx scripts/migrate-timestamps.ts <data-dir>");
	console.error("Example: npx tsx scripts/migrate-timestamps.ts ./data");
	process.exit(1);
}

console.log(`Scanning for log.jsonl files in: ${dataDir}\n`);

const logFiles = findLogFiles(dataDir);
if (logFiles.length === 0) {
	console.log("No log.jsonl files found.");
	process.exit(0);
}

let totalMigrated = 0;
let totalMessages = 0;

for (const logFile of logFiles) {
	console.log(`Processing: ${logFile}`);
	const { total, migrated } = migrateFile(logFile);
	totalMessages += total;
	totalMigrated += migrated;
	console.log(`  ${migrated}/${total} messages migrated\n`);
}

console.log(`Done! Migrated ${totalMigrated}/${totalMessages} total messages across ${logFiles.length} files.`);
