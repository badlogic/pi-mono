/**
 * Resolve configuration values that may be shell commands, environment variables, or literals.
 * Used by auth-storage.ts and model-registry.ts.
 */

import { execSync } from "child_process";
import { platform } from "os";

// Cache for shell command results (persists for process lifetime)
const commandResultCache = new Map<string, string | undefined>();

// Cached shell executable path (resolved once per process)
let cachedShellPath: string | null = null;

/**
 * Get the appropriate shell executable for the current platform.
 * On Windows, prefers bash from Git Bash if available for better Unix compatibility.
 */
function getShellExecutable(): string {
	if (cachedShellPath) {
		return cachedShellPath;
	}

	// On Unix-like systems, use /bin/sh
	if (platform() !== "win32") {
		cachedShellPath = "/bin/sh";
		return cachedShellPath;
	}

	// On Windows, try to find bash
	// First, check if bash is in PATH (from Git Bash, WSL, or MSYS2)
	try {
		execSync("bash --version", { stdio: "ignore" });
		cachedShellPath = "bash";
		return cachedShellPath;
	} catch {
		// bash not in PATH, try Git Bash installation paths
		const gitBashPaths = [
			"C:\\Program Files\\Git\\bin\\bash.exe",
			"C:\\Program Files (x86)\\Git\\bin\\bash.exe",
			process.env.USERPROFILE + "\\git\\bin\\bash.exe",
			process.env.USERPROFILE + "\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
		];

		for (const bashPath of gitBashPaths) {
			try {
				// Use double quotes to handle spaces in path
				execSync(`"${bashPath}" --version`, { stdio: "ignore", windowsHide: true });
				cachedShellPath = `"${bashPath}"`;
				return cachedShellPath;
			} catch {
				// This path doesn't work, try next
			}
		}
	}

	// Fallback to cmd.exe if bash not found
	cachedShellPath = "cmd.exe";
	return cachedShellPath;
}

/**
 * Resolve a config value (API key, header value, etc.) to an actual value.
 * - If starts with "!", executes the rest as a shell command and uses stdout (cached)
 * - Otherwise checks environment variable first, then treats as literal (not cached)
 */
export function resolveConfigValue(config: string): string | undefined {
	if (config.startsWith("!")) {
		return executeCommand(config);
	}
	const envValue = process.env[config];
	return envValue || config;
}

function executeCommand(commandConfig: string): string | undefined {
	if (commandResultCache.has(commandConfig)) {
		return commandResultCache.get(commandConfig);
	}

	const command = commandConfig.slice(1);
	let result: string | undefined;
	try {
		const shell = getShellExecutable();

		if (shell === "cmd.exe") {
			// On Windows without bash, use cmd.exe syntax
			// Note: This may not work correctly for commands with Unix-style quotes
			const output = execSync(command, {
				encoding: "utf-8",
				timeout: 10000,
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
			});
			result = output.trim() || undefined;
		} else {
			// Use bash/sh for Unix-style command execution
			const output = execSync(`${shell} -c ${escapeForShell(command)}`, {
				encoding: "utf-8",
				timeout: 10000,
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
			});
			result = output.trim() || undefined;
		}
	} catch {
		result = undefined;
	}

	commandResultCache.set(commandConfig, result);
	return result;
}

/**
 * Escape a command for safe execution in a shell.
 * Wraps the command in double quotes to handle spaces and special characters.
 */
function escapeForShell(command: string): string {
	// Wrap in double quotes and escape internal double quotes
	return '"' + command.replace(/"/g, '\\"') + '"';
}

/**
 * Resolve all header values using the same resolution logic as API keys.
 */
export function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!headers) return undefined;
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const resolvedValue = resolveConfigValue(value);
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
