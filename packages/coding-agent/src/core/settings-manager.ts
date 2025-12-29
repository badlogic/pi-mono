import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";

export interface CompactionSettings {
	enabled?: boolean; // default: true
	reserveTokens?: number; // default: 16384
	keepRecentTokens?: number; // default: 20000
}

export interface BranchSummarySettings {
	reserveTokens?: number; // default: 16384 (tokens reserved for prompt + LLM response)
}

export interface RetrySettings {
	enabled?: boolean; // default: true
	maxRetries?: number; // default: 3
	baseDelayMs?: number; // default: 2000 (exponential backoff: 2s, 4s, 8s)
}

export interface SkillsSettings {
	enabled?: boolean; // default: true
	enableCodexUser?: boolean; // default: true
	enableClaudeUser?: boolean; // default: true
	enableClaudeProject?: boolean; // default: true
	enablePiUser?: boolean; // default: true
	enablePiProject?: boolean; // default: true
	customDirectories?: string[]; // default: []
	ignoredSkills?: string[]; // default: [] (glob patterns to exclude; takes precedence over includeSkills)
	includeSkills?: string[]; // default: [] (empty = include all; glob patterns to filter)
}

export interface TerminalSettings {
	showImages?: boolean; // default: true (only relevant if terminal supports images)
}

export interface Settings {
	lastChangelogVersion?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	queueMode?: "all" | "one-at-a-time";
	theme?: string;
	compaction?: CompactionSettings;
	branchSummary?: BranchSummarySettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
	collapseChangelog?: boolean; // Show condensed changelog after update (use /changelog for full)
	hooks?: string[]; // Array of hook file paths
	hookTimeout?: number; // Timeout for hook execution in ms (default: 30000)
	customTools?: string[]; // Array of custom tool file paths
	skills?: SkillsSettings;
	terminal?: TerminalSettings;
	enabledModels?: string[]; // Model patterns for cycling (same format as --models CLI flag)
}

/** Deep merge settings: project/overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
	const result: Settings = { ...base };

	for (const key of Object.keys(overrides) as (keyof Settings)[]) {
		const overrideValue = overrides[key];
		const baseValue = base[key];

		if (overrideValue === undefined) {
			continue;
		}

		// For nested objects, merge recursively
		if (
			typeof overrideValue === "object" &&
			overrideValue !== null &&
			!Array.isArray(overrideValue) &&
			typeof baseValue === "object" &&
			baseValue !== null &&
			!Array.isArray(baseValue)
		) {
			(result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
		} else {
			// For primitives and arrays, override value wins
			(result as Record<string, unknown>)[key] = overrideValue;
		}
	}

	return result;
}

export class SettingsManager {
	private settingsPath: string | null;
	private projectSettingsPath: string | null;
	private globalSettings: Settings;
	private settings: Settings;
	private persist: boolean;

	private constructor(
		settingsPath: string | null,
		projectSettingsPath: string | null,
		initialSettings: Settings,
		persist: boolean,
	) {
		this.settingsPath = settingsPath;
		this.projectSettingsPath = projectSettingsPath;
		this.persist = persist;
		this.globalSettings = initialSettings;
		const projectSettings = this.loadProjectSettings();
		this.settings = deepMergeSettings(this.globalSettings, projectSettings);
	}

	/** Create a SettingsManager that loads from files */
	static create(cwd: string = process.cwd(), agentDir: string = getAgentDir()): SettingsManager {
		const settingsPath = join(agentDir, "settings.json");
		const projectSettingsPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
		const globalSettings = SettingsManager.loadFromFile(settingsPath);
		return new SettingsManager(settingsPath, projectSettingsPath, globalSettings, true);
	}

	/** Create an in-memory SettingsManager (no file I/O) */
	static inMemory(settings: Partial<Settings> = {}): SettingsManager {
		return new SettingsManager(null, null, settings, false);
	}

	private static loadFromFile(path: string): Settings {
		if (!existsSync(path)) {
			return {};
		}
		try {
			const content = readFileSync(path, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			console.error(`Warning: Could not read settings file ${path}: ${error}`);
			return {};
		}
	}

	private loadProjectSettings(): Settings {
		if (!this.projectSettingsPath || !existsSync(this.projectSettingsPath)) {
			return {};
		}

		try {
			const content = readFileSync(this.projectSettingsPath, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			console.error(`Warning: Could not read project settings file: ${error}`);
			return {};
		}
	}

	/** Apply additional overrides on top of current settings */
	applyOverrides(overrides: Partial<Settings>): void {
		this.settings = deepMergeSettings(this.settings, overrides);
	}

	private save(): void {
		if (!this.persist || !this.settingsPath) return;

		try {
			const dir = dirname(this.settingsPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			// Save only global settings (project settings are read-only)
			writeFileSync(this.settingsPath, JSON.stringify(this.globalSettings, null, 2), "utf-8");

			// Re-merge project settings into active settings
			const projectSettings = this.loadProjectSettings();
			this.settings = deepMergeSettings(this.globalSettings, projectSettings);
		} catch (error) {
			console.error(`Warning: Could not save settings file: ${error}`);
		}
	}

	getLastChangelogVersion(): string | undefined {
		return this.settings.lastChangelogVersion;
	}

	setLastChangelogVersion(version: string): void {
		this.globalSettings.lastChangelogVersion = version;
		this.save();
	}

	getDefaultProvider(): string | undefined {
		return this.settings.defaultProvider;
	}

	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	setDefaultProvider(provider: string): void {
		this.globalSettings.defaultProvider = provider;
		this.save();
	}

	setDefaultModel(modelId: string): void {
		this.globalSettings.defaultModel = modelId;
		this.save();
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.globalSettings.defaultProvider = provider;
		this.globalSettings.defaultModel = modelId;
		this.save();
	}

	getQueueMode(): "all" | "one-at-a-time" {
		return this.settings.queueMode || "one-at-a-time";
	}

	setQueueMode(mode: "all" | "one-at-a-time"): void {
		this.globalSettings.queueMode = mode;
		this.save();
	}

	getTheme(): string | undefined {
		return this.settings.theme;
	}

	setTheme(theme: string): void {
		this.globalSettings.theme = theme;
		this.save();
	}

	getDefaultThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
		return this.settings.defaultThinkingLevel;
	}

	setDefaultThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): void {
		this.globalSettings.defaultThinkingLevel = level;
		this.save();
	}

	getCompactionEnabled(): boolean {
		return this.settings.compaction?.enabled ?? true;
	}

	setCompactionEnabled(enabled: boolean): void {
		if (!this.globalSettings.compaction) {
			this.globalSettings.compaction = {};
		}
		this.globalSettings.compaction.enabled = enabled;
		this.save();
	}

	getCompactionReserveTokens(): number {
		return this.settings.compaction?.reserveTokens ?? 16384;
	}

	getCompactionKeepRecentTokens(): number {
		return this.settings.compaction?.keepRecentTokens ?? 20000;
	}

	getCompactionSettings(): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } {
		return {
			enabled: this.getCompactionEnabled(),
			reserveTokens: this.getCompactionReserveTokens(),
			keepRecentTokens: this.getCompactionKeepRecentTokens(),
		};
	}

	getBranchSummarySettings(): { reserveTokens: number } {
		return {
			reserveTokens: this.settings.branchSummary?.reserveTokens ?? 16384,
		};
	}

	getRetryEnabled(): boolean {
		return this.settings.retry?.enabled ?? true;
	}

	setRetryEnabled(enabled: boolean): void {
		if (!this.globalSettings.retry) {
			this.globalSettings.retry = {};
		}
		this.globalSettings.retry.enabled = enabled;
		this.save();
	}

	getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number } {
		return {
			enabled: this.getRetryEnabled(),
			maxRetries: this.settings.retry?.maxRetries ?? 3,
			baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000,
		};
	}

	getHideThinkingBlock(): boolean {
		return this.settings.hideThinkingBlock ?? false;
	}

	setHideThinkingBlock(hide: boolean): void {
		this.globalSettings.hideThinkingBlock = hide;
		this.save();
	}

	getShellPath(): string | undefined {
		return this.settings.shellPath;
	}

	setShellPath(path: string | undefined): void {
		this.globalSettings.shellPath = path;
		this.save();
	}

	getCollapseChangelog(): boolean {
		return this.settings.collapseChangelog ?? false;
	}

	setCollapseChangelog(collapse: boolean): void {
		this.globalSettings.collapseChangelog = collapse;
		this.save();
	}

	getHookPaths(): string[] {
		return [...(this.settings.hooks ?? [])];
	}

	setHookPaths(paths: string[]): void {
		this.globalSettings.hooks = paths;
		this.save();
	}

	getHookTimeout(): number {
		return this.settings.hookTimeout ?? 30000;
	}

	setHookTimeout(timeout: number): void {
		this.globalSettings.hookTimeout = timeout;
		this.save();
	}

	getCustomToolPaths(): string[] {
		return [...(this.settings.customTools ?? [])];
	}

	setCustomToolPaths(paths: string[]): void {
		this.globalSettings.customTools = paths;
		this.save();
	}

	getSkillsEnabled(): boolean {
		return this.settings.skills?.enabled ?? true;
	}

	setSkillsEnabled(enabled: boolean): void {
		if (!this.globalSettings.skills) {
			this.globalSettings.skills = {};
		}
		this.globalSettings.skills.enabled = enabled;
		this.save();
	}

	getSkillsSettings(): Required<SkillsSettings> {
		return {
			enabled: this.settings.skills?.enabled ?? true,
			enableCodexUser: this.settings.skills?.enableCodexUser ?? true,
			enableClaudeUser: this.settings.skills?.enableClaudeUser ?? true,
			enableClaudeProject: this.settings.skills?.enableClaudeProject ?? true,
			enablePiUser: this.settings.skills?.enablePiUser ?? true,
			enablePiProject: this.settings.skills?.enablePiProject ?? true,
			customDirectories: [...(this.settings.skills?.customDirectories ?? [])],
			ignoredSkills: [...(this.settings.skills?.ignoredSkills ?? [])],
			includeSkills: [...(this.settings.skills?.includeSkills ?? [])],
		};
	}

	getShowImages(): boolean {
		return this.settings.terminal?.showImages ?? true;
	}

	setShowImages(show: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showImages = show;
		this.save();
	}

	getEnabledModels(): string[] | undefined {
		return this.settings.enabledModels;
	}
}
