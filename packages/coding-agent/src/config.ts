import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { homedir, platform } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// =============================================================================
// Package Detection
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path)
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

// =============================================================================
// Package Asset Paths (shipped with executable)
// =============================================================================

/**
 * Get the base directory for resolving package assets (themes, package.json, README.md, CHANGELOG.md).
 * - For Bun binary: returns the directory containing the executable
 * - For Node.js (dist/): returns __dirname (the dist/ directory)
 * - For tsx (src/): returns parent directory (the package root)
 */
export function getPackageDir(): string {
	if (isBunBinary) {
		// Bun binary: process.execPath points to the compiled executable
		return dirname(process.execPath);
	}
	// Node.js: walk up from __dirname until we find package.json
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	// Fallback (shouldn't happen)
	return __dirname;
}

/**
 * Get path to built-in themes directory (shipped with package)
 * - For Bun binary: theme/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/theme/
 * - For tsx (src/): src/modes/interactive/theme/
 */
export function getThemesDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "theme");
	}
	// Theme is in modes/interactive/theme/ relative to src/ or dist/
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

/** Get path to package.json */
export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

/** Get path to README.md */
export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

/** Get path to docs directory */
export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

/** Get path to CHANGELOG.md */
export function getChangelogPath(): string {
	return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

// =============================================================================
// App Config (from package.json piConfig)
// =============================================================================

const pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8"));

export const APP_NAME: string = pkg.piConfig?.name || "pi";
export const CONFIG_DIR_NAME: string = pkg.piConfig?.configDir || ".pi";
export const VERSION: string = pkg.version;

// e.g., PI_CODING_AGENT_DIR or TAU_CODING_AGENT_DIR
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;

// =============================================================================
// XDG Base Directory Specification Support
// =============================================================================

/**
 * Check if we're on macOS.
 * macOS has different conventions, but we still support XDG env vars if set.
 */
function isMacOS(): boolean {
	return platform() === "darwin";
}

/**
 * Get XDG_CONFIG_HOME or platform-appropriate default.
 * - If XDG_CONFIG_HOME is set, use it
 * - macOS: ~/Library/Application Support
 * - Linux/other: ~/.config
 */
export function getXdgConfigHome(): string {
	if (process.env.XDG_CONFIG_HOME) {
		return process.env.XDG_CONFIG_HOME;
	}
	if (isMacOS()) {
		return join(homedir(), "Library", "Application Support");
	}
	return join(homedir(), ".config");
}

/**
 * Get XDG_DATA_HOME or platform-appropriate default.
 * - If XDG_DATA_HOME is set, use it
 * - macOS: ~/Library/Application Support
 * - Linux/other: ~/.local/share
 */
export function getXdgDataHome(): string {
	if (process.env.XDG_DATA_HOME) {
		return process.env.XDG_DATA_HOME;
	}
	if (isMacOS()) {
		return join(homedir(), "Library", "Application Support");
	}
	return join(homedir(), ".local", "share");
}

/**
 * Get XDG_STATE_HOME or platform-appropriate default.
 * - If XDG_STATE_HOME is set, use it
 * - macOS: ~/Library/Logs
 * - Linux/other: ~/.local/state
 */
export function getXdgStateHome(): string {
	if (process.env.XDG_STATE_HOME) {
		return process.env.XDG_STATE_HOME;
	}
	if (isMacOS()) {
		return join(homedir(), "Library", "Logs");
	}
	return join(homedir(), ".local", "state");
}

// =============================================================================
// XDG-based Directory Functions
// =============================================================================

/**
 * Get the config directory for the agent.
 * Contains: settings.json, models.json, oauth.json
 * Location: $XDG_CONFIG_HOME/pi/agent/
 */
export function getConfigDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		return envDir;
	}
	return join(getXdgConfigHome(), "pi", "agent");
}

/**
 * Get the data directory for the agent.
 * Contains: sessions/, themes/, tools/, hooks/, commands/, skills/, agents/
 * Location: $XDG_DATA_HOME/pi/agent/
 */
export function getDataDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		return envDir;
	}
	return join(getXdgDataHome(), "pi", "agent");
}

/**
 * Get the state directory for the agent.
 * Contains: debug logs, crash logs
 * Location: $XDG_STATE_HOME/pi/agent/
 */
export function getStateDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		return envDir;
	}
	return join(getXdgStateHome(), "pi", "agent");
}

/**
 * Get the legacy agent directory path (~/.pi/agent/).
 * Used for migration detection.
 */
function getLegacyAgentDir(): string {
	return join(homedir(), CONFIG_DIR_NAME, "agent");
}

// =============================================================================
// Migration from Legacy Paths
// =============================================================================

// Config files that should be migrated to getConfigDir()
const CONFIG_FILES = ["settings.json", "models.json", "oauth.json"];

// Data directories that should be migrated to getDataDir()
const DATA_DIRS = ["sessions", "themes", "tools", "hooks", "commands", "skills", "agents"];

let migrationDone = false;

/**
 * Migrate files and directories from legacy ~/.pi/agent/ to XDG locations.
 * This is called automatically on first access to any path function.
 *
 * Migration logic:
 * 1. If ENV_AGENT_DIR is set, skip migration (user has explicit override)
 * 2. If legacy dir doesn't exist, skip (nothing to migrate)
 * 3. If XDG dirs already have content, skip (already migrated or fresh install)
 * 4. Copy config files to getConfigDir()
 * 5. Copy data dirs to getDataDir()
 * 6. Copy log files to getStateDir()
 * 7. Remove legacy directory after successful migration
 */
export function migrateFromLegacyPaths(): void {
	if (migrationDone) {
		return;
	}

	// Skip if user has explicit override
	if (process.env[ENV_AGENT_DIR]) {
		migrationDone = true;
		return;
	}

	const legacyDir = getLegacyAgentDir();

	// Skip if legacy directory doesn't exist
	if (!existsSync(legacyDir)) {
		migrationDone = true;
		return;
	}

	const configDir = getConfigDir();
	const dataDir = getDataDir();
	const stateDir = getStateDir();

	// Check if any XDG location already has content (indicates already migrated)
	const configHasContent = existsSync(configDir) && readdirSync(configDir).length > 0;
	const dataHasContent = existsSync(dataDir) && readdirSync(dataDir).length > 0;

	if (configHasContent || dataHasContent) {
		// Already migrated or fresh XDG install, don't overwrite
		migrationDone = true;
		return;
	}

	try {
		// Ensure target directories exist
		mkdirSync(configDir, { recursive: true });
		mkdirSync(dataDir, { recursive: true });
		mkdirSync(stateDir, { recursive: true });

		// Migrate config files
		for (const file of CONFIG_FILES) {
			const src = join(legacyDir, file);
			const dest = join(configDir, file);
			if (existsSync(src) && statSync(src).isFile()) {
				cpSync(src, dest);
			}
		}

		// Migrate data directories
		for (const dir of DATA_DIRS) {
			const src = join(legacyDir, dir);
			const dest = join(dataDir, dir);
			if (existsSync(src) && statSync(src).isDirectory()) {
				cpSync(src, dest, { recursive: true });
			}
		}

		// Migrate log files to state directory
		const legacyEntries = readdirSync(legacyDir);
		for (const entry of legacyEntries) {
			const src = join(legacyDir, entry);
			if (entry.endsWith(".log") && statSync(src).isFile()) {
				const dest = join(stateDir, entry);
				cpSync(src, dest);
			}
		}

		// Remove legacy directory after successful migration
		rmSync(legacyDir, { recursive: true, force: true });

		// Also try to remove parent ~/.pi/ if it's now empty
		const legacyParent = dirname(legacyDir);
		try {
			if (existsSync(legacyParent) && readdirSync(legacyParent).length === 0) {
				rmSync(legacyParent, { recursive: true, force: true });
			}
		} catch {
			// Ignore errors when cleaning up parent
		}
	} catch (error) {
		// Log warning but don't crash
		console.warn(`Warning: Failed to migrate from legacy path ${legacyDir}:`, error);
	} finally {
		migrationDone = true;
	}
}

/**
 * Ensure migration has been performed.
 * Call this early in startup to trigger migration if needed.
 */
export function ensureMigration(): void {
	migrateFromLegacyPaths();
}

// =============================================================================
// User Config Paths (XDG-compliant)
// =============================================================================

/**
 * Get the agent directory.
 * @deprecated Use getConfigDir(), getDataDir(), or getStateDir() instead.
 * This is kept for backward API compatibility.
 */
export function getAgentDir(): string {
	migrateFromLegacyPaths();
	return getConfigDir();
}

/** Get path to user's custom themes directory */
export function getCustomThemesDir(): string {
	migrateFromLegacyPaths();
	return join(getDataDir(), "themes");
}

/** Get path to models.json */
export function getModelsPath(): string {
	migrateFromLegacyPaths();
	return join(getConfigDir(), "models.json");
}

/** Get path to oauth.json */
export function getOAuthPath(): string {
	migrateFromLegacyPaths();
	return join(getConfigDir(), "oauth.json");
}

/** Get path to settings.json */
export function getSettingsPath(): string {
	migrateFromLegacyPaths();
	return join(getConfigDir(), "settings.json");
}

/** Get path to tools directory */
export function getToolsDir(): string {
	migrateFromLegacyPaths();
	return join(getDataDir(), "tools");
}

/** Get path to hooks directory */
export function getHooksDir(): string {
	migrateFromLegacyPaths();
	return join(getDataDir(), "hooks");
}

/** Get path to slash commands directory */
export function getCommandsDir(): string {
	migrateFromLegacyPaths();
	return join(getDataDir(), "commands");
}

/** Get path to sessions directory */
export function getSessionsDir(): string {
	migrateFromLegacyPaths();
	return join(getDataDir(), "sessions");
}

/** Get path to skills directory */
export function getSkillsDir(): string {
	migrateFromLegacyPaths();
	return join(getDataDir(), "skills");
}

/** Get path to agents directory */
export function getAgentsDir(): string {
	migrateFromLegacyPaths();
	return join(getDataDir(), "agents");
}

/** Get path to debug log file */
export function getDebugLogPath(): string {
	migrateFromLegacyPaths();
	return join(getStateDir(), `${APP_NAME}-debug.log`);
}

/** Get path to crash log file */
export function getCrashLogPath(): string {
	migrateFromLegacyPaths();
	return join(getStateDir(), `${APP_NAME}-crash.log`);
}
