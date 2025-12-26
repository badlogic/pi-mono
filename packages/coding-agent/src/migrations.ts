/**
 * One-time migrations that run on startup.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "./config.js";

/**
 * Migrate legacy oauth.json and settings.json apiKeys to auth.json.
 *
 * @returns Array of provider names that were migrated
 */
export function migrateAuthToAuthJson(): string[] {
	const agentDir = getAgentDir();
	const authPath = join(agentDir, "auth.json");
	const oauthPath = join(agentDir, "oauth.json");
	const settingsPath = join(agentDir, "settings.json");

	// Skip if auth.json already exists
	if (existsSync(authPath)) return [];

	const migrated: Record<string, unknown> = {};
	const providers: string[] = [];

	// Migrate oauth.json
	if (existsSync(oauthPath)) {
		try {
			const oauth = JSON.parse(readFileSync(oauthPath, "utf-8"));
			for (const [provider, cred] of Object.entries(oauth)) {
				migrated[provider] = { type: "oauth", ...(cred as object) };
				providers.push(provider);
			}
			renameSync(oauthPath, `${oauthPath}.migrated`);
		} catch {
			// Skip on error
		}
	}

	// Migrate settings.json apiKeys
	if (existsSync(settingsPath)) {
		try {
			const content = readFileSync(settingsPath, "utf-8");
			const settings = JSON.parse(content);
			if (settings.apiKeys && typeof settings.apiKeys === "object") {
				for (const [provider, key] of Object.entries(settings.apiKeys)) {
					if (!migrated[provider] && typeof key === "string") {
						migrated[provider] = { type: "api_key", key };
						providers.push(provider);
					}
				}
				delete settings.apiKeys;
				writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
			}
		} catch {
			// Skip on error
		}
	}

	if (Object.keys(migrated).length > 0) {
		mkdirSync(dirname(authPath), { recursive: true });
		writeFileSync(authPath, JSON.stringify(migrated, null, 2), { mode: 0o600 });
	}

	return providers;
}

/**
 * Migrate sessions from ~/.pi/agent/*.jsonl to proper session directories.
 *
 * Bug in v0.30.0: Sessions were saved to ~/.pi/agent/ instead of
 * ~/.pi/agent/sessions/<encoded-cwd>/. This migration moves them
 * to the correct location based on the cwd in their session header.
 *
 * See: https://github.com/badlogic/pi-mono/issues/320
 */
export function migrateSessionsFromAgentRoot(): void {
	const agentDir = getAgentDir();

	// Find all .jsonl files directly in agentDir (not in subdirectories)
	let files: string[];
	try {
		files = readdirSync(agentDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => join(agentDir, f));
	} catch {
		return;
	}

	if (files.length === 0) return;

	for (const file of files) {
		try {
			// Read first line to get session header
			const content = readFileSync(file, "utf8");
			const firstLine = content.split("\n")[0];
			if (!firstLine?.trim()) continue;

			const header = JSON.parse(firstLine);
			if (header.type !== "session" || !header.cwd) continue;

			const cwd: string = header.cwd;

			// Compute the correct session directory (same encoding as session-manager.ts)
			const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
			const correctDir = join(agentDir, "sessions", safePath);

			// Create directory if needed
			if (!existsSync(correctDir)) {
				mkdirSync(correctDir, { recursive: true });
			}

			// Move the file
			const fileName = file.split("/").pop() || file.split("\\").pop();
			const newPath = join(correctDir, fileName!);

			if (existsSync(newPath)) continue; // Skip if target exists

			renameSync(file, newPath);
		} catch {
			// Skip files that can't be migrated
		}
	}
}

/**
 * Run all migrations. Called once on startup.
 *
 * @returns Object with migration results
 */
export function runMigrations(): { migratedAuthProviders: string[] } {
	const migratedAuthProviders = migrateAuthToAuthJson();
	migrateSessionsFromAgentRoot();
	return { migratedAuthProviders };
}
