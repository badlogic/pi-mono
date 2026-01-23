import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import { CONFIG_DIR_NAME } from "../config.js";
import type { PackageSource, SettingsManager } from "./settings-manager.js";

export interface ResolvedPaths {
	extensions: string[];
	skills: string[];
	prompts: string[];
	themes: string[];
}

export type MissingSourceAction = "install" | "skip" | "error";

export interface ProgressEvent {
	type: "start" | "progress" | "complete" | "error";
	action: "install" | "remove" | "update" | "clone" | "pull";
	source: string;
	message?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface PackageManager {
	resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths>;
	install(source: string, options?: { local?: boolean }): Promise<void>;
	remove(source: string, options?: { local?: boolean }): Promise<void>;
	update(source?: string): Promise<void>;
	resolveExtensionSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedPaths>;
	setProgressCallback(callback: ProgressCallback | undefined): void;
}

interface PackageManagerOptions {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
}

type SourceScope = "global" | "project" | "temporary";

type NpmSource = {
	type: "npm";
	spec: string;
	name: string;
	pinned: boolean;
};

type GitSource = {
	type: "git";
	repo: string;
	host: string;
	path: string;
	ref?: string;
	pinned: boolean;
};

type LocalSource = {
	type: "local";
	path: string;
};

type ParsedSource = NpmSource | GitSource | LocalSource;

interface PiManifest {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

interface ResourceAccumulator {
	extensions: Set<string>;
	skills: Set<string>;
	prompts: Set<string>;
	themes: Set<string>;
}

interface PackageFilter {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

// File type patterns for each resource type
type ResourceType = "extensions" | "skills" | "prompts" | "themes";

const FILE_PATTERNS: Record<ResourceType, RegExp> = {
	extensions: /\.(ts|js)$/,
	skills: /\.md$/,
	prompts: /\.md$/,
	themes: /\.json$/,
};

/**
 * Check if a string contains glob pattern characters or is an exclusion.
 */
function isPattern(s: string): boolean {
	return s.startsWith("!") || s.includes("*") || s.includes("?");
}

/**
 * Check if any entry in the array is a pattern.
 */
function hasPatterns(entries: string[]): boolean {
	return entries.some(isPattern);
}

/**
 * Recursively collect files from a directory matching a file pattern.
 */
function collectFiles(dir: string, filePattern: RegExp, skipNodeModules = true): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			if (skipNodeModules && entry.name === "node_modules") continue;

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
				files.push(...collectFiles(fullPath, filePattern, skipNodeModules));
			} else if (isFile && filePattern.test(entry.name)) {
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
 * Skills can be directories (with SKILL.md) or direct .md files.
 */
function collectSkillEntries(dir: string): string[] {
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
				// Skill directory - add if it has SKILL.md or recurse
				const skillMd = join(fullPath, "SKILL.md");
				if (existsSync(skillMd)) {
					entries.push(fullPath);
				} else {
					entries.push(...collectSkillEntries(fullPath));
				}
			} else if (isFile && entry.name.endsWith(".md")) {
				entries.push(fullPath);
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}

/**
 * Apply inclusion/exclusion patterns to filter paths.
 * @param allPaths - All available paths to filter
 * @param patterns - Array of patterns (prefix with ! for exclusion)
 * @param baseDir - Base directory for relative pattern matching
 */
function applyPatterns(allPaths: string[], patterns: string[], baseDir: string): string[] {
	const includes: string[] = [];
	const excludes: string[] = [];

	for (const p of patterns) {
		if (p.startsWith("!")) {
			excludes.push(p.slice(1));
		} else {
			includes.push(p);
		}
	}

	// If only exclusions, start with all paths; otherwise filter to inclusions first
	let result: string[];
	if (includes.length === 0) {
		result = [...allPaths];
	} else {
		result = allPaths.filter((filePath) => {
			const rel = relative(baseDir, filePath);
			const name = basename(filePath);
			return includes.some((pattern) => {
				// Match against relative path, basename, or full path
				return minimatch(rel, pattern) || minimatch(name, pattern) || minimatch(filePath, pattern);
			});
		});
	}

	// Apply exclusions
	if (excludes.length > 0) {
		result = result.filter((filePath) => {
			const rel = relative(baseDir, filePath);
			const name = basename(filePath);
			return !excludes.some((pattern) => {
				return minimatch(rel, pattern) || minimatch(name, pattern) || minimatch(filePath, pattern);
			});
		});
	}

	return result;
}

export class DefaultPackageManager implements PackageManager {
	private cwd: string;
	private agentDir: string;
	private settingsManager: SettingsManager;
	private globalNpmRoot: string | undefined;
	private progressCallback: ProgressCallback | undefined;

	constructor(options: PackageManagerOptions) {
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.settingsManager = options.settingsManager;
		this.ensureGitIgnoreDirs();
	}

	setProgressCallback(callback: ProgressCallback | undefined): void {
		this.progressCallback = callback;
	}

	private emitProgress(event: ProgressEvent): void {
		this.progressCallback?.(event);
	}

	async resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths> {
		const accumulator = this.createAccumulator();
		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();

		// Resolve packages (npm/git sources)
		const packageSources: Array<{ pkg: PackageSource; scope: SourceScope }> = [];
		for (const pkg of globalSettings.packages ?? []) {
			packageSources.push({ pkg, scope: "global" });
		}
		for (const pkg of projectSettings.packages ?? []) {
			packageSources.push({ pkg, scope: "project" });
		}
		await this.resolvePackageSources(packageSources, accumulator, onMissing);

		// Resolve local extensions
		this.resolveLocalEntries(
			[...(globalSettings.extensions ?? []), ...(projectSettings.extensions ?? [])],
			"extensions",
			accumulator.extensions,
		);

		// Resolve local skills
		this.resolveLocalEntries(
			[...(globalSettings.skills ?? []), ...(projectSettings.skills ?? [])],
			"skills",
			accumulator.skills,
		);

		// Resolve local prompts
		this.resolveLocalEntries(
			[...(globalSettings.prompts ?? []), ...(projectSettings.prompts ?? [])],
			"prompts",
			accumulator.prompts,
		);

		// Resolve local themes
		this.resolveLocalEntries(
			[...(globalSettings.themes ?? []), ...(projectSettings.themes ?? [])],
			"themes",
			accumulator.themes,
		);

		return this.toResolvedPaths(accumulator);
	}

	/**
	 * Resolve local entries with pattern support.
	 * If any entry contains patterns, enumerate files and apply filters.
	 * Otherwise, just resolve paths directly.
	 */
	private resolveLocalEntries(entries: string[], resourceType: ResourceType, target: Set<string>): void {
		if (entries.length === 0) return;

		if (!hasPatterns(entries)) {
			// No patterns - resolve directly
			for (const entry of entries) {
				const resolved = this.resolvePath(entry);
				if (existsSync(resolved)) {
					this.addPath(target, resolved);
				}
			}
			return;
		}

		// Has patterns - need to enumerate and filter
		const plainPaths: string[] = [];
		const patterns: string[] = [];

		for (const entry of entries) {
			if (isPattern(entry)) {
				patterns.push(entry);
			} else {
				plainPaths.push(entry);
			}
		}

		// Collect all files from plain paths
		const allFiles: string[] = [];
		for (const p of plainPaths) {
			const resolved = this.resolvePath(p);
			if (!existsSync(resolved)) continue;

			try {
				const stats = statSync(resolved);
				if (stats.isFile()) {
					allFiles.push(resolved);
				} else if (stats.isDirectory()) {
					if (resourceType === "skills") {
						allFiles.push(...collectSkillEntries(resolved));
					} else {
						allFiles.push(...collectFiles(resolved, FILE_PATTERNS[resourceType]));
					}
				}
			} catch {
				// Ignore errors
			}
		}

		// Apply patterns
		const filtered = applyPatterns(allFiles, patterns, this.cwd);
		for (const f of filtered) {
			this.addPath(target, f);
		}
	}

	async resolveExtensionSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedPaths> {
		const accumulator = this.createAccumulator();
		const scope: SourceScope = options?.temporary ? "temporary" : options?.local ? "project" : "global";
		const packageSources = sources.map((source) => ({ pkg: source as PackageSource, scope }));
		await this.resolvePackageSources(packageSources, accumulator);
		return this.toResolvedPaths(accumulator);
	}

	async install(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "global";
		this.emitProgress({ type: "start", action: "install", source, message: `Installing ${source}...` });
		try {
			if (parsed.type === "npm") {
				await this.installNpm(parsed, scope, false);
				this.emitProgress({ type: "complete", action: "install", source });
				return;
			}
			if (parsed.type === "git") {
				await this.installGit(parsed, scope);
				this.emitProgress({ type: "complete", action: "install", source });
				return;
			}
			throw new Error(`Unsupported install source: ${source}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.emitProgress({ type: "error", action: "install", source, message });
			throw error;
		}
	}

	async remove(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "global";
		this.emitProgress({ type: "start", action: "remove", source, message: `Removing ${source}...` });
		try {
			if (parsed.type === "npm") {
				await this.uninstallNpm(parsed, scope);
				this.emitProgress({ type: "complete", action: "remove", source });
				return;
			}
			if (parsed.type === "git") {
				await this.removeGit(parsed, scope);
				this.emitProgress({ type: "complete", action: "remove", source });
				return;
			}
			throw new Error(`Unsupported remove source: ${source}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.emitProgress({ type: "error", action: "remove", source, message });
			throw error;
		}
	}

	async update(source?: string): Promise<void> {
		if (source) {
			await this.updateSourceForScope(source, "global");
			await this.updateSourceForScope(source, "project");
			return;
		}

		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();
		for (const extension of globalSettings.extensions ?? []) {
			await this.updateSourceForScope(extension, "global");
		}
		for (const extension of projectSettings.extensions ?? []) {
			await this.updateSourceForScope(extension, "project");
		}
	}

	private async updateSourceForScope(source: string, scope: SourceScope): Promise<void> {
		const parsed = this.parseSource(source);
		if (parsed.type === "npm") {
			if (parsed.pinned) return;
			this.emitProgress({ type: "start", action: "update", source, message: `Updating ${source}...` });
			try {
				await this.installNpm(parsed, scope, false);
				this.emitProgress({ type: "complete", action: "update", source });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.emitProgress({ type: "error", action: "update", source, message });
				throw error;
			}
			return;
		}
		if (parsed.type === "git") {
			if (parsed.pinned) return;
			this.emitProgress({ type: "start", action: "update", source, message: `Updating ${source}...` });
			try {
				await this.updateGit(parsed, scope);
				this.emitProgress({ type: "complete", action: "update", source });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.emitProgress({ type: "error", action: "update", source, message });
				throw error;
			}
			return;
		}
	}

	private async resolvePackageSources(
		sources: Array<{ pkg: PackageSource; scope: SourceScope }>,
		accumulator: ResourceAccumulator,
		onMissing?: (source: string) => Promise<MissingSourceAction>,
	): Promise<void> {
		for (const { pkg, scope } of sources) {
			const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
			const filter = typeof pkg === "object" ? pkg : undefined;
			const parsed = this.parseSource(sourceStr);

			if (parsed.type === "local") {
				this.resolveLocalExtensionSource(parsed, accumulator, filter);
				continue;
			}

			const installMissing = async (): Promise<boolean> => {
				if (!onMissing) {
					await this.installParsedSource(parsed, scope);
					return true;
				}
				const action = await onMissing(sourceStr);
				if (action === "skip") return false;
				if (action === "error") throw new Error(`Missing source: ${sourceStr}`);
				await this.installParsedSource(parsed, scope);
				return true;
			};

			if (parsed.type === "npm") {
				const installedPath = this.getNpmInstallPath(parsed, scope);
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				this.collectPackageResources(installedPath, accumulator, filter);
				continue;
			}

			if (parsed.type === "git") {
				const installedPath = this.getGitInstallPath(parsed, scope);
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				this.collectPackageResources(installedPath, accumulator, filter);
			}
		}
	}

	private resolveLocalExtensionSource(
		source: LocalSource,
		accumulator: ResourceAccumulator,
		filter?: PackageFilter,
	): void {
		const resolved = this.resolvePath(source.path);
		if (!existsSync(resolved)) {
			return;
		}

		try {
			const stats = statSync(resolved);
			if (stats.isFile()) {
				this.addPath(accumulator.extensions, resolved);
				return;
			}
			if (stats.isDirectory()) {
				const resources = this.collectPackageResources(resolved, accumulator, filter);
				if (!resources) {
					this.addPath(accumulator.extensions, resolved);
				}
			}
		} catch {
			return;
		}
	}

	private async installParsedSource(parsed: ParsedSource, scope: SourceScope): Promise<void> {
		if (parsed.type === "npm") {
			await this.installNpm(parsed, scope, scope === "temporary");
			return;
		}
		if (parsed.type === "git") {
			await this.installGit(parsed, scope);
			return;
		}
	}

	private parseSource(source: string): ParsedSource {
		if (source.startsWith("npm:")) {
			const spec = source.slice("npm:".length).trim();
			const { name, version } = this.parseNpmSpec(spec);
			return {
				type: "npm",
				spec,
				name,
				pinned: Boolean(version),
			};
		}

		// Accept git: prefix or raw URLs (https://github.com/..., github.com/...)
		if (source.startsWith("git:") || this.looksLikeGitUrl(source)) {
			const repoSpec = source.startsWith("git:") ? source.slice("git:".length).trim() : source;
			const [repo, ref] = repoSpec.split("@");
			const normalized = repo.replace(/^https?:\/\//, "").replace(/\.git$/, "");
			const parts = normalized.split("/");
			const host = parts.shift() ?? "";
			const repoPath = parts.join("/");
			return {
				type: "git",
				repo: normalized,
				host,
				path: repoPath,
				ref,
				pinned: Boolean(ref),
			};
		}

		return { type: "local", path: source };
	}

	private looksLikeGitUrl(source: string): boolean {
		// Match URLs like https://github.com/..., github.com/..., gitlab.com/...
		const gitHosts = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"];
		const normalized = source.replace(/^https?:\/\//, "");
		return gitHosts.some((host) => normalized.startsWith(`${host}/`));
	}

	private parseNpmSpec(spec: string): { name: string; version?: string } {
		const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
		if (!match) {
			return { name: spec };
		}
		const name = match[1] ?? spec;
		const version = match[2];
		return { name, version };
	}

	private async installNpm(source: NpmSource, scope: SourceScope, temporary: boolean): Promise<void> {
		if (scope === "global" && !temporary) {
			await this.runCommand("npm", ["install", "-g", source.spec]);
			return;
		}
		const installRoot = this.getNpmInstallRoot(scope, temporary);
		this.ensureNpmProject(installRoot);
		await this.runCommand("npm", ["install", source.spec, "--prefix", installRoot]);
	}

	private async uninstallNpm(source: NpmSource, scope: SourceScope): Promise<void> {
		if (scope === "global") {
			await this.runCommand("npm", ["uninstall", "-g", source.name]);
			return;
		}
		const installRoot = this.getNpmInstallRoot(scope, false);
		if (!existsSync(installRoot)) {
			return;
		}
		await this.runCommand("npm", ["uninstall", source.name, "--prefix", installRoot]);
	}

	private async installGit(source: GitSource, scope: SourceScope): Promise<void> {
		const targetDir = this.getGitInstallPath(source, scope);
		if (existsSync(targetDir)) {
			return;
		}
		mkdirSync(dirname(targetDir), { recursive: true });
		const cloneUrl = source.repo.startsWith("http") ? source.repo : `https://${source.repo}`;
		await this.runCommand("git", ["clone", cloneUrl, targetDir]);
		if (source.ref) {
			await this.runCommand("git", ["checkout", source.ref], { cwd: targetDir });
		}
		// Install npm dependencies if package.json exists
		const packageJsonPath = join(targetDir, "package.json");
		if (existsSync(packageJsonPath)) {
			await this.runCommand("npm", ["install"], { cwd: targetDir });
		}
	}

	private async updateGit(source: GitSource, scope: SourceScope): Promise<void> {
		const targetDir = this.getGitInstallPath(source, scope);
		if (!existsSync(targetDir)) {
			await this.installGit(source, scope);
			return;
		}
		await this.runCommand("git", ["pull"], { cwd: targetDir });
		// Reinstall npm dependencies if package.json exists (in case deps changed)
		const packageJsonPath = join(targetDir, "package.json");
		if (existsSync(packageJsonPath)) {
			await this.runCommand("npm", ["install"], { cwd: targetDir });
		}
	}

	private async removeGit(source: GitSource, scope: SourceScope): Promise<void> {
		const targetDir = this.getGitInstallPath(source, scope);
		if (!existsSync(targetDir)) return;
		rmSync(targetDir, { recursive: true, force: true });
	}

	private ensureNpmProject(installRoot: string): void {
		if (!existsSync(installRoot)) {
			mkdirSync(installRoot, { recursive: true });
		}
		this.ensureGitIgnore(installRoot);
		const packageJsonPath = join(installRoot, "package.json");
		if (!existsSync(packageJsonPath)) {
			const pkgJson = { name: "pi-extensions", private: true };
			writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
		}
	}

	private ensureGitIgnoreDirs(): void {
		this.ensureGitIgnore(join(this.agentDir, "git"));
		this.ensureGitIgnore(join(this.agentDir, "npm"));
		this.ensureGitIgnore(join(this.cwd, CONFIG_DIR_NAME, "git"));
		this.ensureGitIgnore(join(this.cwd, CONFIG_DIR_NAME, "npm"));
	}

	private ensureGitIgnore(dir: string): void {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const ignorePath = join(dir, ".gitignore");
		if (!existsSync(ignorePath)) {
			writeFileSync(ignorePath, "*\n!.gitignore\n", "utf-8");
		}
	}

	private getNpmInstallRoot(scope: SourceScope, temporary: boolean): string {
		if (temporary) {
			return this.getTemporaryDir("npm");
		}
		if (scope === "project") {
			return join(this.cwd, CONFIG_DIR_NAME, "npm");
		}
		return join(this.getGlobalNpmRoot(), "..");
	}

	private getGlobalNpmRoot(): string {
		if (this.globalNpmRoot) {
			return this.globalNpmRoot;
		}
		const result = this.runCommandSync("npm", ["root", "-g"]);
		this.globalNpmRoot = result.trim();
		return this.globalNpmRoot;
	}

	private getNpmInstallPath(source: NpmSource, scope: SourceScope): string {
		if (scope === "temporary") {
			return join(this.getTemporaryDir("npm"), "node_modules", source.name);
		}
		if (scope === "project") {
			return join(this.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
		}
		return join(this.getGlobalNpmRoot(), source.name);
	}

	private getGitInstallPath(source: GitSource, scope: SourceScope): string {
		if (scope === "temporary") {
			return this.getTemporaryDir(`git-${source.host}`, source.path);
		}
		if (scope === "project") {
			return join(this.cwd, CONFIG_DIR_NAME, "git", source.host, source.path);
		}
		return join(this.agentDir, "git", source.host, source.path);
	}

	private getTemporaryDir(prefix: string, suffix?: string): string {
		const hash = createHash("sha256")
			.update(`${prefix}-${suffix ?? ""}`)
			.digest("hex")
			.slice(0, 8);
		return join(tmpdir(), "pi-extensions", prefix, hash, suffix ?? "");
	}

	private resolvePath(input: string): string {
		const trimmed = input.trim();
		if (trimmed === "~") return homedir();
		if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
		if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
		return resolve(this.cwd, trimmed);
	}

	private collectPackageResources(
		packageRoot: string,
		accumulator: ResourceAccumulator,
		filter?: PackageFilter,
	): boolean {
		// If filter is provided, use it to selectively load resources
		if (filter) {
			// Empty array means "load none", undefined means "load all"
			if (filter.extensions !== undefined) {
				this.applyPackageFilter(packageRoot, filter.extensions, "extensions", accumulator.extensions);
			} else {
				this.collectDefaultExtensions(packageRoot, accumulator);
			}

			if (filter.skills !== undefined) {
				this.applyPackageFilter(packageRoot, filter.skills, "skills", accumulator.skills);
			} else {
				this.collectDefaultSkills(packageRoot, accumulator);
			}

			if (filter.prompts !== undefined) {
				this.applyPackageFilter(packageRoot, filter.prompts, "prompts", accumulator.prompts);
			} else {
				this.collectDefaultPrompts(packageRoot, accumulator);
			}

			if (filter.themes !== undefined) {
				this.applyPackageFilter(packageRoot, filter.themes, "themes", accumulator.themes);
			} else {
				this.collectDefaultThemes(packageRoot, accumulator);
			}

			return true;
		}

		// No filter: load everything based on manifest or directory structure
		const manifest = this.readPiManifest(packageRoot);
		if (manifest) {
			this.addManifestEntries(manifest.extensions, packageRoot, accumulator.extensions);
			this.addManifestEntries(manifest.skills, packageRoot, accumulator.skills);
			this.addManifestEntries(manifest.prompts, packageRoot, accumulator.prompts);
			this.addManifestEntries(manifest.themes, packageRoot, accumulator.themes);
			return true;
		}

		const extensionsDir = join(packageRoot, "extensions");
		const skillsDir = join(packageRoot, "skills");
		const promptsDir = join(packageRoot, "prompts");
		const themesDir = join(packageRoot, "themes");

		const hasAnyDir =
			existsSync(extensionsDir) || existsSync(skillsDir) || existsSync(promptsDir) || existsSync(themesDir);
		if (!hasAnyDir) {
			return false;
		}

		if (existsSync(extensionsDir)) {
			this.addPath(accumulator.extensions, extensionsDir);
		}
		if (existsSync(skillsDir)) {
			this.addPath(accumulator.skills, skillsDir);
		}
		if (existsSync(promptsDir)) {
			this.addPath(accumulator.prompts, promptsDir);
		}
		if (existsSync(themesDir)) {
			this.addPath(accumulator.themes, themesDir);
		}
		return true;
	}

	private collectDefaultExtensions(packageRoot: string, accumulator: ResourceAccumulator): void {
		const manifest = this.readPiManifest(packageRoot);
		if (manifest?.extensions) {
			this.addManifestEntries(manifest.extensions, packageRoot, accumulator.extensions);
			return;
		}
		const extensionsDir = join(packageRoot, "extensions");
		if (existsSync(extensionsDir)) {
			this.addPath(accumulator.extensions, extensionsDir);
		}
	}

	private collectDefaultSkills(packageRoot: string, accumulator: ResourceAccumulator): void {
		const manifest = this.readPiManifest(packageRoot);
		if (manifest?.skills) {
			this.addManifestEntries(manifest.skills, packageRoot, accumulator.skills);
			return;
		}
		const skillsDir = join(packageRoot, "skills");
		if (existsSync(skillsDir)) {
			this.addPath(accumulator.skills, skillsDir);
		}
	}

	private collectDefaultPrompts(packageRoot: string, accumulator: ResourceAccumulator): void {
		const manifest = this.readPiManifest(packageRoot);
		if (manifest?.prompts) {
			this.addManifestEntries(manifest.prompts, packageRoot, accumulator.prompts);
			return;
		}
		const promptsDir = join(packageRoot, "prompts");
		if (existsSync(promptsDir)) {
			this.addPath(accumulator.prompts, promptsDir);
		}
	}

	private collectDefaultThemes(packageRoot: string, accumulator: ResourceAccumulator): void {
		const manifest = this.readPiManifest(packageRoot);
		if (manifest?.themes) {
			this.addManifestEntries(manifest.themes, packageRoot, accumulator.themes);
			return;
		}
		const themesDir = join(packageRoot, "themes");
		if (existsSync(themesDir)) {
			this.addPath(accumulator.themes, themesDir);
		}
	}

	/**
	 * Apply filter patterns to a package's resources.
	 * Supports glob patterns and exclusions (! prefix).
	 */
	private applyPackageFilter(
		packageRoot: string,
		patterns: string[],
		resourceType: ResourceType,
		target: Set<string>,
	): void {
		if (patterns.length === 0) {
			return;
		}

		if (!hasPatterns(patterns)) {
			// No patterns - just resolve paths directly
			for (const entry of patterns) {
				const resolved = resolve(packageRoot, entry);
				if (existsSync(resolved)) {
					this.addPath(target, resolved);
				}
			}
			return;
		}

		// Has patterns - enumerate all files and filter
		const allFiles = this.collectAllPackageFiles(packageRoot, resourceType);
		const filtered = applyPatterns(allFiles, patterns, packageRoot);
		for (const f of filtered) {
			this.addPath(target, f);
		}
	}

	/**
	 * Collect all files of a given resource type from a package.
	 */
	private collectAllPackageFiles(packageRoot: string, resourceType: ResourceType): string[] {
		const manifest = this.readPiManifest(packageRoot);

		// If manifest specifies paths, use those
		if (manifest) {
			const manifestPaths = manifest[resourceType];
			if (manifestPaths && manifestPaths.length > 0) {
				const files: string[] = [];
				for (const p of manifestPaths) {
					const resolved = resolve(packageRoot, p);
					if (!existsSync(resolved)) continue;

					try {
						const stats = statSync(resolved);
						if (stats.isFile()) {
							files.push(resolved);
						} else if (stats.isDirectory()) {
							if (resourceType === "skills") {
								files.push(...collectSkillEntries(resolved));
							} else {
								files.push(...collectFiles(resolved, FILE_PATTERNS[resourceType]));
							}
						}
					} catch {
						// Ignore errors
					}
				}
				return files;
			}
		}

		// Fall back to convention-based directories
		const conventionDir = join(packageRoot, resourceType);
		if (!existsSync(conventionDir)) {
			return [];
		}

		if (resourceType === "skills") {
			return collectSkillEntries(conventionDir);
		}
		return collectFiles(conventionDir, FILE_PATTERNS[resourceType]);
	}

	private readPiManifest(packageRoot: string): PiManifest | null {
		const packageJsonPath = join(packageRoot, "package.json");
		if (!existsSync(packageJsonPath)) {
			return null;
		}

		try {
			const content = readFileSync(packageJsonPath, "utf-8");
			const pkg = JSON.parse(content) as { pi?: PiManifest };
			return pkg.pi ?? null;
		} catch {
			return null;
		}
	}

	private addManifestEntries(entries: string[] | undefined, root: string, target: Set<string>): void {
		if (!entries) return;
		for (const entry of entries) {
			const resolved = resolve(root, entry);
			this.addPath(target, resolved);
		}
	}

	private addPath(set: Set<string>, value: string): void {
		if (!value) return;
		set.add(value);
	}

	private createAccumulator(): ResourceAccumulator {
		return {
			extensions: new Set<string>(),
			skills: new Set<string>(),
			prompts: new Set<string>(),
			themes: new Set<string>(),
		};
	}

	private toResolvedPaths(accumulator: ResourceAccumulator): ResolvedPaths {
		return {
			extensions: Array.from(accumulator.extensions),
			skills: Array.from(accumulator.skills),
			prompts: Array.from(accumulator.prompts),
			themes: Array.from(accumulator.themes),
		};
	}

	private runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
		return new Promise((resolvePromise, reject) => {
			const child = spawn(command, args, {
				cwd: options?.cwd,
				stdio: "inherit",
			});
			child.on("error", reject);
			child.on("exit", (code) => {
				if (code === 0) {
					resolvePromise();
				} else {
					reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
				}
			});
		});
	}

	private runCommandSync(command: string, args: string[]): string {
		const result = spawnSync(command, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });
		if (result.status !== 0) {
			throw new Error(`Failed to run ${command} ${args.join(" ")}: ${result.stderr || result.stdout}`);
		}
		return (result.stdout || result.stderr || "").trim();
	}
}
