import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { HookStorageContext } from "./types.js";

/**
 * Get the base directory for hook data storage.
 */
function getHookDataDir(hookId: string): string {
	return path.join(os.homedir(), ".pi", "hook-data", hookId);
}

/**
 * Sanitize a key for use as a filename.
 * Replaces path separators and other problematic characters.
 */
function sanitizeKey(key: string): string {
	return key.replace(/[/\\:*?"<>|]/g, "_");
}

/**
 * Create a storage context for a specific hook.
 * Data is stored in ~/.pi/hook-data/<hook-id>/<key>.json
 */
export function createStorageContext(hookId: string): HookStorageContext {
	const baseDir = getHookDataDir(hookId);

	return {
		async get<T>(key: string): Promise<T | null> {
			const filePath = path.join(baseDir, `${sanitizeKey(key)}.json`);
			try {
				const data = await fs.readFile(filePath, "utf-8");
				return JSON.parse(data) as T;
			} catch (err) {
				// File doesn't exist or invalid JSON
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					return null;
				}
				// Log but don't crash for other errors
				console.error(`Hook storage error reading ${key}:`, err);
				return null;
			}
		},

		async set<T>(key: string, value: T): Promise<void> {
			await fs.mkdir(baseDir, { recursive: true });
			const filePath = path.join(baseDir, `${sanitizeKey(key)}.json`);
			await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
		},

		async delete(key: string): Promise<void> {
			const filePath = path.join(baseDir, `${sanitizeKey(key)}.json`);
			try {
				await fs.unlink(filePath);
			} catch (err) {
				// Ignore if file doesn't exist
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
					console.error(`Hook storage error deleting ${key}:`, err);
				}
			}
		},

		async list(prefix?: string): Promise<string[]> {
			try {
				const files = await fs.readdir(baseDir);
				const keys = files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)); // Remove .json extension

				if (prefix) {
					return keys.filter((k) => k.startsWith(sanitizeKey(prefix)));
				}
				return keys;
			} catch (err) {
				// Directory doesn't exist yet
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					return [];
				}
				console.error("Hook storage error listing keys:", err);
				return [];
			}
		},
	};
}
