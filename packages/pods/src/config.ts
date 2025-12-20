import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { dirname, join } from "path";
import type { Config, Pod } from "./types.js";

// =============================================================================
// XDG Base Directory Specification Support
// =============================================================================

/**
 * Check if we're on macOS.
 */
function isMacOS(): boolean {
	return platform() === "darwin";
}

/**
 * Check if we're on Windows.
 */
function isWindows(): boolean {
	return platform() === "win32";
}

/**
 * Get XDG_CONFIG_HOME or platform-appropriate default.
 */
function getXdgConfigHome(): string {
	if (process.env.XDG_CONFIG_HOME) {
		return process.env.XDG_CONFIG_HOME;
	}
	if (isWindows()) {
		return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
	}
	if (isMacOS()) {
		return join(homedir(), "Library", "Application Support");
	}
	return join(homedir(), ".config");
}

/**
 * Get the legacy config path (~/.pi/pods.json).
 */
function getLegacyConfigPath(): string {
	return join(homedir(), ".pi", "pods.json");
}

let migrationDone = false;

/**
 * Migrate pods.json from legacy ~/.pi/ to XDG location.
 */
function migrateFromLegacyPath(): void {
	if (migrationDone) {
		return;
	}
	migrationDone = true;

	// Skip if user has explicit override
	if (process.env.PI_CONFIG_DIR) {
		return;
	}

	const legacyPath = getLegacyConfigPath();
	const newConfigDir = join(getXdgConfigHome(), "pi");
	const newConfigPath = join(newConfigDir, "pods.json");

	// Skip if legacy file doesn't exist
	if (!existsSync(legacyPath)) {
		return;
	}

	// Skip if new location already has the file
	if (existsSync(newConfigPath)) {
		return;
	}

	try {
		// Ensure target directory exists
		mkdirSync(newConfigDir, { recursive: true });

		// Copy the file
		cpSync(legacyPath, newConfigPath);

		// Remove legacy file
		rmSync(legacyPath);

		// Try to remove ~/.pi/ if it's now empty
		const legacyDir = dirname(legacyPath);
		try {
			if (existsSync(legacyDir) && readdirSync(legacyDir).length === 0) {
				rmSync(legacyDir, { recursive: true, force: true });
			}
		} catch {
			// Ignore errors when cleaning up parent
		}
	} catch (error) {
		console.warn(`Warning: Failed to migrate from legacy path ${legacyPath}:`, error);
	}
}

// Get config directory from env or use XDG default
const getConfigDir = (): string => {
	migrateFromLegacyPath();
	const configDir = process.env.PI_CONFIG_DIR || join(getXdgConfigHome(), "pi");
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}
	return configDir;
};

const getConfigPath = (): string => {
	return join(getConfigDir(), "pods.json");
};

export const loadConfig = (): Config => {
	const configPath = getConfigPath();
	if (!existsSync(configPath)) {
		// Return empty config if file doesn't exist
		return { pods: {} };
	}
	try {
		const data = readFileSync(configPath, "utf-8");
		return JSON.parse(data);
	} catch (e) {
		console.error(`Error reading config: ${e}`);
		return { pods: {} };
	}
};

export const saveConfig = (config: Config): void => {
	const configPath = getConfigPath();
	try {
		writeFileSync(configPath, JSON.stringify(config, null, 2));
	} catch (e) {
		console.error(`Error saving config: ${e}`);
		process.exit(1);
	}
};

export const getActivePod = (): { name: string; pod: Pod } | null => {
	const config = loadConfig();
	if (!config.active || !config.pods[config.active]) {
		return null;
	}
	return { name: config.active, pod: config.pods[config.active] };
};

export const addPod = (name: string, pod: Pod): void => {
	const config = loadConfig();
	config.pods[name] = pod;
	// If no active pod, make this one active
	if (!config.active) {
		config.active = name;
	}
	saveConfig(config);
};

export const removePod = (name: string): void => {
	const config = loadConfig();
	delete config.pods[name];
	// If this was the active pod, clear active
	if (config.active === name) {
		config.active = undefined;
	}
	saveConfig(config);
};

export const setActivePod = (name: string): void => {
	const config = loadConfig();
	if (!config.pods[name]) {
		console.error(`Pod '${name}' not found`);
		process.exit(1);
	}
	config.active = name;
	saveConfig(config);
};
