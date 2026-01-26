/**
 * TUI config selector for `pi config` command
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import { minimatch } from "minimatch";
import { CONFIG_DIR_NAME } from "../config.js";
import type { PathMetadata, ResolvedPaths, ResolvedResource } from "../core/package-manager.js";
import type { SettingsManager } from "../core/settings-manager.js";
import { ConfigSelectorComponent } from "../modes/interactive/components/config-selector.js";
import { initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.js";

export interface ConfigSelectorOptions {
	resolvedPaths: ResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
}

type ResourceType = "extensions" | "skills" | "prompts" | "themes";

const FILE_PATTERNS: Record<ResourceType, RegExp> = {
	extensions: /\.(ts|js)$/,
	skills: /\.md$/,
	prompts: /\.md$/,
	themes: /\.json$/,
};

function collectFiles(dir: string, pattern: RegExp): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			let isDir = entry.isDirectory();
			let isFile = entry.isFile();

			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDir = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}

			if (isDir) {
				files.push(...collectFiles(fullPath, pattern));
			} else if (isFile && pattern.test(entry.name)) {
				files.push(fullPath);
			}
		}
	} catch {
		// Ignore errors
	}

	return files;
}

/**
 * Collect skill entries from a directory.
 * Matches the behavior of loadSkillsFromDirInternal in skills.ts:
 * - Direct .md files in the root directory
 * - Subdirectories containing SKILL.md (returns the directory path)
 * - Recursively checks subdirectories that don't have SKILL.md
 */
function collectSkillEntries(dir: string, isRoot = true): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	try {
		const dirEntries = readdirSync(dir, { withFileTypes: true });
		for (const entry of dirEntries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			let isDir = entry.isDirectory();
			let isFile = entry.isFile();

			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDir = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}

			if (isDir) {
				// Check for SKILL.md in subdirectory
				const skillMd = join(fullPath, "SKILL.md");
				if (existsSync(skillMd)) {
					// This is a skill directory, add it
					entries.push(fullPath);
				} else {
					// Recurse into subdirectory to find skills
					entries.push(...collectSkillEntries(fullPath, false));
				}
			} else if (isFile && entry.name.endsWith(".md")) {
				// Only include direct .md files at root level, or SKILL.md anywhere
				if (isRoot || entry.name === "SKILL.md") {
					entries.push(fullPath);
				}
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}

function collectExtensionEntries(dir: string): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	try {
		const dirEntries = readdirSync(dir, { withFileTypes: true });
		for (const entry of dirEntries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			let isDir = entry.isDirectory();
			let isFile = entry.isFile();

			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDir = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}

			if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
				entries.push(fullPath);
			} else if (isDir) {
				// Check for index.ts/js or package.json with pi field
				const indexTs = join(fullPath, "index.ts");
				const indexJs = join(fullPath, "index.js");
				if (existsSync(indexTs)) {
					entries.push(indexTs);
				} else if (existsSync(indexJs)) {
					entries.push(indexJs);
				}
				// Skip subdirectories that don't have an entry point
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}

function normalizeExactPattern(pattern: string): string {
	if (pattern.startsWith("./") || pattern.startsWith(".\\")) {
		return pattern.slice(2);
	}
	return pattern;
}

function matchesAnyPattern(filePath: string, patterns: string[], baseDir: string): boolean {
	const rel = relative(baseDir, filePath);
	const name = basename(filePath);
	return patterns.some(
		(pattern) => minimatch(rel, pattern) || minimatch(name, pattern) || minimatch(filePath, pattern),
	);
}

function matchesAnyExactPattern(filePath: string, patterns: string[], baseDir: string): boolean {
	if (patterns.length === 0) return false;
	const rel = relative(baseDir, filePath);
	return patterns.some((pattern) => {
		const normalized = normalizeExactPattern(pattern);
		return normalized === rel || normalized === filePath;
	});
}

function isEnabledByOverrides(filePath: string, patterns: string[], baseDir: string): boolean {
	const overrides = patterns.filter(
		(pattern) => pattern.startsWith("!") || pattern.startsWith("+") || pattern.startsWith("-"),
	);
	const excludes = overrides.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
	const forceIncludes = overrides.filter((pattern) => pattern.startsWith("+")).map((pattern) => pattern.slice(1));
	const forceExcludes = overrides.filter((pattern) => pattern.startsWith("-")).map((pattern) => pattern.slice(1));

	let enabled = true;
	if (excludes.length > 0 && matchesAnyPattern(filePath, excludes, baseDir)) {
		enabled = false;
	}
	if (forceIncludes.length > 0 && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) {
		enabled = true;
	}
	if (forceExcludes.length > 0 && matchesAnyExactPattern(filePath, forceExcludes, baseDir)) {
		enabled = false;
	}
	return enabled;
}

/**
 * Merge auto-discovered resources into resolved paths.
 * Auto-discovered resources are enabled by default unless explicitly disabled via settings.
 */
function mergeAutoDiscoveredResources(
	resolvedPaths: ResolvedPaths,
	settingsManager: SettingsManager,
	cwd: string,
	agentDir: string,
): ResolvedPaths {
	const result: ResolvedPaths = {
		extensions: [...resolvedPaths.extensions],
		skills: [...resolvedPaths.skills],
		prompts: [...resolvedPaths.prompts],
		themes: [...resolvedPaths.themes],
	};

	const existingPaths = {
		extensions: new Set(resolvedPaths.extensions.map((r) => r.path)),
		skills: new Set(resolvedPaths.skills.map((r) => r.path)),
		prompts: new Set(resolvedPaths.prompts.map((r) => r.path)),
		themes: new Set(resolvedPaths.themes.map((r) => r.path)),
	};

	// Get override patterns from settings
	const globalSettings = settingsManager.getGlobalSettings();
	const projectSettings = settingsManager.getProjectSettings();

	const userOverrides = {
		extensions: globalSettings.extensions ?? [],
		skills: globalSettings.skills ?? [],
		prompts: globalSettings.prompts ?? [],
		themes: globalSettings.themes ?? [],
	};

	const projectOverrides = {
		extensions: projectSettings.extensions ?? [],
		skills: projectSettings.skills ?? [],
		prompts: projectSettings.prompts ?? [],
		themes: projectSettings.themes ?? [],
	};

	const addResources = (
		target: ResolvedResource[],
		existing: Set<string>,
		paths: string[],
		metadata: PathMetadata,
		overrides: string[],
		baseDir: string,
	) => {
		for (const path of paths) {
			if (!existing.has(path)) {
				const enabled = isEnabledByOverrides(path, overrides, baseDir);
				target.push({ path, enabled, metadata });
				existing.add(path);
			}
		}
	};

	const userBaseDir = agentDir;
	const projectBaseDir = join(cwd, CONFIG_DIR_NAME);

	// User scope auto-discovery
	const userExtDir = join(agentDir, "extensions");
	const userSkillsDir = join(agentDir, "skills");
	const userPromptsDir = join(agentDir, "prompts");
	const userThemesDir = join(agentDir, "themes");

	addResources(
		result.extensions,
		existingPaths.extensions,
		collectExtensionEntries(userExtDir),
		{ source: "auto", scope: "user", origin: "top-level" },
		userOverrides.extensions,
		userBaseDir,
	);
	addResources(
		result.skills,
		existingPaths.skills,
		collectSkillEntries(userSkillsDir),
		{ source: "auto", scope: "user", origin: "top-level" },
		userOverrides.skills,
		userBaseDir,
	);
	addResources(
		result.prompts,
		existingPaths.prompts,
		collectFiles(userPromptsDir, FILE_PATTERNS.prompts),
		{ source: "auto", scope: "user", origin: "top-level" },
		userOverrides.prompts,
		userBaseDir,
	);
	addResources(
		result.themes,
		existingPaths.themes,
		collectFiles(userThemesDir, FILE_PATTERNS.themes),
		{ source: "auto", scope: "user", origin: "top-level" },
		userOverrides.themes,
		userBaseDir,
	);

	// Project scope auto-discovery
	const projectExtDir = join(cwd, CONFIG_DIR_NAME, "extensions");
	const projectSkillsDir = join(cwd, CONFIG_DIR_NAME, "skills");
	const projectPromptsDir = join(cwd, CONFIG_DIR_NAME, "prompts");
	const projectThemesDir = join(cwd, CONFIG_DIR_NAME, "themes");

	addResources(
		result.extensions,
		existingPaths.extensions,
		collectExtensionEntries(projectExtDir),
		{ source: "auto", scope: "project", origin: "top-level" },
		projectOverrides.extensions,
		projectBaseDir,
	);
	addResources(
		result.skills,
		existingPaths.skills,
		collectSkillEntries(projectSkillsDir),
		{ source: "auto", scope: "project", origin: "top-level" },
		projectOverrides.skills,
		projectBaseDir,
	);
	addResources(
		result.prompts,
		existingPaths.prompts,
		collectFiles(projectPromptsDir, FILE_PATTERNS.prompts),
		{ source: "auto", scope: "project", origin: "top-level" },
		projectOverrides.prompts,
		projectBaseDir,
	);
	addResources(
		result.themes,
		existingPaths.themes,
		collectFiles(projectThemesDir, FILE_PATTERNS.themes),
		{ source: "auto", scope: "project", origin: "top-level" },
		projectOverrides.themes,
		projectBaseDir,
	);

	return result;
}

/** Show TUI config selector and return when closed */
export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	// Initialize theme before showing TUI
	initTheme(options.settingsManager.getTheme(), true);

	// Merge auto-discovered resources with package manager results
	const allPaths = mergeAutoDiscoveredResources(
		options.resolvedPaths,
		options.settingsManager,
		options.cwd,
		options.agentDir,
	);

	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let resolved = false;

		const selector = new ConfigSelectorComponent(
			allPaths,
			options.settingsManager,
			options.cwd,
			options.agentDir,
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					stopThemeWatcher();
					resolve();
				}
			},
			() => {
				ui.stop();
				stopThemeWatcher();
				process.exit(0);
			},
			() => ui.requestRender(),
		);

		ui.addChild(selector);
		ui.setFocus(selector.getResourceList());
		ui.start();
	});
}
