/**
 * Resolve configuration values that may be shell commands, environment variables, or literals.
 * Used by auth-storage.ts and model-registry.ts.
 */

import { execSync } from "child_process";

// Cache for shell command results (persists for process lifetime)
interface CacheEntry {
	value: string | undefined;
	cachedAt: number;
}
const commandResultCache = new Map<string, CacheEntry>();

/**
 * Resolve a config value (API key, header value, etc.) to an actual value.
 * - If starts with "!", executes the rest as a shell command and uses stdout (cached)
 * - Otherwise checks environment variable first, then treats as literal (not cached)
 */
export function resolveConfigValue(config: string, ttlMs?: number): string | undefined {
	if (config.startsWith("!")) {
		return executeCommand(config, ttlMs);
	}
	const envValue = process.env[config];
	return envValue || config;
}

function executeCommand(commandConfig: string, ttlMs?: number): string | undefined {
	const cached = commandResultCache.get(commandConfig);
	const now = Date.now();

	if (cached) {
		const expired = ttlMs !== undefined && now - cached.cachedAt > ttlMs;
		if (!expired) return cached.value;
	}

	const command = commandConfig.slice(1);
	let result: string | undefined;
	try {
		const output = execSync(command, {
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		result = output.trim() || undefined;
	} catch {
		result = undefined;
	}

	commandResultCache.set(commandConfig, { value: result, cachedAt: now });
	return result;
}

/**
 * Resolve all header values using the same resolution logic as API keys.
 */
export function resolveHeaders(
	headers: Record<string, string> | undefined,
	ttlMs?: number,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const resolvedValue = resolveConfigValue(value, ttlMs);
		if (resolvedValue) {
			resolved[key] = resolvedValue;
		}
	}
	return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/** Clear the config value command cache. Exported for testing. */
export function clearConfigValueCache(): void {
	commandResultCache.clear();
}
