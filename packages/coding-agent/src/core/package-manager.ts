import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import { CONFIG_DIR_NAME } from "../config.js";
import { looksLikeGitUrl } from "../utils/git.js";
import type { PackageSource, SettingsManager } from "./settings-manager.js";

export interface PathMetadata {
	source: string;
	scope: SourceScope;
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface ResolvedResource {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
}

export interface ResolvedPaths {
	extensions: ResolvedResource[];
	skills: ResolvedResource[];
	prompts: ResolvedResource[];
	themes: ResolvedResource[];
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
	getInstalledPath(source: string, scope: "user" | "project"): string | undefined;
}

interface PackageManagerOptions {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
}

type SourceScope = "user" | "project" | "temporary";

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
	extensions: Map<string, { metadata: PathMetadata; enabled: boolean }>;
	skills: Map<string, { metadata: PathMetadata; enabled: boolean }>;
	prompts: Map<string, { metadata: PathMetadata; enabled: boolean }>;
	themes: Map<string, { metadata: PathMetadata; enabled: boolean }>;
}

interface PackageFilter {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

type ResourceType = "extensions" | "skills" | "prompts" | "themes";

const RESOURCE_TYPES: ResourceType[] = ["extensions", "skills", "prompts", "themes"];

const FILE_PATTERNS: Record<ResourceType, RegExp> = {
	extensions: /\.(ts|js)$/,
	skills: /\.md$/,
	prompts: /\.md$/,
	themes: /\.json$/,
};

function isPattern(s: string): boolean {
	return s.startsWith("!") || s.startsWith("+") || s.startsWith("-") || s.includes("*") || s.includes("?");
}

function splitPatterns(entries: string[]): { plain: string[]; patterns: string[] } {
	const plain: string[] = [];
	const patterns: string[] = [];
	for (const entry of entries) {
		if (isPattern(entry)) {
			patterns.push(entry);
		} else {
			plain.push(entry);
		}
	}
	return { plain, patterns };
}

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

function collectSkillEntries(dir: string, includeRootFiles = true): string[] {
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
				entries.push(...collectSkillEntries(fullPath, false));
			} else if (isFile) {
				const isRootMd = includeRootFiles && entry.name.endsWith(".md");
				const isSkillMd = !includeRootFiles && entry.name === "SKILL.md";
				if (isRootMd || isSkillMd) {
					entries.push(fullPath);
				}
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}

function collectAutoSkillEntries(dir: string, includeRootFiles = true): string[] {
	return collectSkillEntries(dir, includeRootFiles);
}

function collectAutoPromptEntries(dir: string): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	try {
		const dirEntries = readdirSync(dir, { withFileTypes: true });
		for (const entry of dirEntries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			if (isFile && entry.name.endsWith(".md")) {
				entries.push(fullPath);
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}

function collectAutoThemeEntries(dir: string): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	try {
		const dirEntries = readdirSync(dir, { withFileTypes: true });
		for (const entry of dirEntries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			if (isFile && entry.name.endsWith(".json")) {
				entries.push(fullPath);
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}

function readPiManifestFile(packageJsonPath: string): PiManifest | null {
	try {
		const content = readFileSync(packageJsonPath, "utf-8");
		const pkg = JSON.parse(content) as { pi?: PiManifest };
		return pkg.pi ?? null;
	} catch {
		return null;
	}
}

function resolveExtensionEntries(dir: string): string[] | null {
	const packageJsonPath = join(dir, "package.json");
	if (existsSync(packageJsonPath)) {
		const manifest = readPiManifestFile(packageJsonPath);
		if (manifest?.extensions?.length) {
			const entries: string[] = [];
			for (const extPath of manifest.extensions) {
				const resolvedExtPath = resolve(dir, extPath);
				if (existsSync(resolvedExtPath)) {
					entries.push(resolvedExtPath);
				}
			}
			if (entries.length > 0) {
				return entries;
			}
		}
	}

	const indexTs = join(dir, "index.ts");
	const indexJs = join(dir, "index.js");
	if (existsSync(indexTs)) {
		return [indexTs];
	}
	if (existsSync(indexJs)) {
		return [indexJs];
	}

	return null;
}

function collectAutoExtensionEntries(dir: string): string[] {
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
				const resolvedEntries = resolveExtensionEntries(fullPath);
				if (resolvedEntries) {
					entries.push(...resolvedEntries);
				}
			}
		}
	} catch {
		// Ignore errors
	}

	return entries;
}

function matchesAnyPattern(filePath: string, patterns: string[], baseDir: string): boolean {
	const rel = relative(baseDir, filePath);
	const name = basename(filePath);
	const isSkillFile = name === "SKILL.md";
	const parentDir = isSkillFile ? dirname(filePath) : undefined;
	const parentRel = isSkillFile ? relative(baseDir, parentDir!) : undefined;
	const parentName = isSkillFile ? basename(parentDir!) : undefined;

	return patterns.some((pattern) => {
		if (minimatch(rel, pattern) || minimatch(name, pattern) || minimatch(filePath, pattern)) {
			return true;
		}
		if (!isSkillFile) return false;
		return minimatch(parentRel!, pattern) || minimatch(parentName!, pattern) || minimatch(parentDir!, pattern);
	});
}

function normalizeExactPattern(pattern: string): string {
	if (pattern.startsWith("./") || pattern.startsWith(".\\")) {
		return pattern.slice(2);
	}
	return pattern;
}

function matchesAnyExactPattern(filePath: string, patterns: string[], baseDir: string): boolean {
	if (patterns.length === 0) return false;
	const rel = relative(baseDir, filePath);
	const name = basename(filePath);
	const isSkillFile = name === "SKILL.md";
	const parentDir = isSkillFile ? dirname(filePath) : undefined;
	const parentRel = isSkillFile ? relative(baseDir, parentDir!) : undefined;

	return patterns.some((pattern) => {
		const normalized = normalizeExactPattern(pattern);
		if (normalized === rel || normalized === filePath) {
			return true;
		}
		if (!isSkillFile) return false;
		return normalized === parentRel || normalized === parentDir;
	});
}

function getOverridePatterns(entries: string[]): string[] {
	return entries.filter((pattern) => pattern.startsWith("!") || pattern.startsWith("+") || pattern.startsWith("-"));
}

function isEnabledByOverrides(filePath: string, patterns: string[], baseDir: string): boolean {
	const overrides = getOverridePatterns(patterns);
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
 * Apply patterns to paths and return a Set of enabled paths.
 * Pattern types:
 * - Plain patterns: include matching paths
 * - `!pattern`: exclude matching paths
 * - `+path`: force-include exact path (overrides exclusions)
 * - `-path`: force-exclude exact path (overrides force-includes)
 */
function applyPatterns(allPaths: string[], patterns: string[], baseDir: string): Set<string> {
	const includes: string[] = [];
	const excludes: string[] = [];
	const forceIncludes: string[] = [];
	const forceExcludes: string[] = [];

	for (const p of patterns) {
		if (p.startsWith("+")) {
			forceIncludes.push(p.slice(1));
		} else if (p.startsWith("-")) {
			forceExcludes.push(p.slice(1));
		} else if (p.startsWith("!")) {
			excludes.push(p.slice(1));
		} else {
			includes.push(p);
		}
	}

	// Step 1: Apply includes (or all if no includes)
	let result: string[];
	if (includes.length === 0) {
		result = [...allPaths];
	} else {
		result = allPaths.filter((filePath) => matchesAnyPattern(filePath, includes, baseDir));
	}

	// Step 2: Apply excludes
	if (excludes.length > 0) {
		result = result.filter((filePath) => !matchesAnyPattern(filePath, excludes, baseDir));
	}

	// Step 3: Force-include (add back from allPaths, overriding exclusions)
	if (forceIncludes.length > 0) {
		for (const filePath of allPaths) {
			if (!result.includes(filePath) && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) {
				result.push(filePath);
			}
		}
	}

	// Step 4: Force-exclude (remove even if included or force-included)
	if (forceExcludes.length > 0) {
		result = result.filter((filePath) => !matchesAnyExactPattern(filePath, forceExcludes, baseDir));
	}

	return new Set(result);
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
	}

	setProgressCallback(callback: ProgressCallback | undefined): void {
		this.progressCallback = callback;
	}

	getInstalledPath(source: string, scope: "user" | "project"): string | undefined {
		const parsed = this.parseSource(source);
		if (parsed.type === "npm") {
			const path = this.getNpmInstallPath(parsed, scope);
			return existsSync(path) ? path : undefined;
		}
		if (parsed.type === "git") {
			const path = this.getGitInstallPath(parsed, scope);
			return existsSync(path) ? path : undefined;
		}
		if (parsed.type === "local") {
			const path = this.resolvePath(parsed.path);
			return existsSync(path) ? path : undefined;
		}
		return undefined;
	}

	private emitProgress(event: ProgressEvent): void {
		this.progressCallback?.(event);
	}

	private async withProgress(
		action: ProgressEvent["action"],
		source: string,
		message: string,
		operation: () => Promise<void>,
	): Promise<void> {
		this.emitProgress({ type: "start", action, source, message });
		try {
			await operation();
			this.emitProgress({ type: "complete", action, source });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emitProgress({ type: "error", action, source, message: errorMessage });
			throw error;
		}
	}

	async resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths> {
		const accumulator = this.createAccumulator();
		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();

		// Collect all packages with scope
		const allPackages: Array<{ pkg: PackageSource; scope: SourceScope }> = [];
		for (const pkg of globalSettings.packages ?? []) {
			allPackages.push({ pkg, scope: "user" });
		}
		for (const pkg of projectSettings.packages ?? []) {
			allPackages.push({ pkg, scope: "project" });
		}

		// Dedupe: project scope wins over global for same package identity
		const packageSources = this.dedupePackages(allPackages);
		await this.resolvePackageSources(packageSources, accumulator, onMissing);

		const globalBaseDir = this.agentDir;
		const projectBaseDir = join(this.cwd, CONFIG_DIR_NAME);

		for (const resourceType of RESOURCE_TYPES) {
			const target = this.getTargetMap(accumulator, resourceType);
			const globalEntries = (globalSettings[resourceType] ?? []) as string[];
			const projectEntries = (projectSettings[resourceType] ?? []) as string[];
			this.resolveLocalEntries(
				globalEntries,
				resourceType,
				target,
				{
					source: "local",
					scope: "user",
					origin: "top-level",
				},
				globalBaseDir,
			);
			this.resolveLocalEntries(
				projectEntries,
				resourceType,
				target,
				{
					source: "local",
					scope: "project",
					origin: "top-level",
				},
				projectBaseDir,
			);
		}

		this.addAutoDiscoveredResources(accumulator, globalSettings, projectSettings, globalBaseDir, projectBaseDir);

		return this.toResolvedPaths(accumulator);
	}

	async resolveExtensionSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedPaths> {
		const accumulator = this.createAccumulator();
		const scope: SourceScope = options?.temporary ? "temporary" : options?.local ? "project" : "user";
		const packageSources = sources.map((source) => ({ pkg: source as PackageSource, scope }));
		await this.resolvePackageSources(packageSources, accumulator);
		return this.toResolvedPaths(accumulator);
	}

	async install(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "user";
		await this.withProgress("install", source, `Installing ${source}...`, async () => {
			if (parsed.type === "npm") {
				await this.installNpm(parsed, scope, false);
				return;
			}
			if (parsed.type === "git") {
				await this.installGit(parsed, scope);
				return;
			}
			throw new Error(`Unsupported install source: ${source}`);
		});
	}

	async remove(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "user";
		await this.withProgress("remove", source, `Removing ${source}...`, async () => {
			if (parsed.type === "npm") {
				await this.uninstallNpm(parsed, scope);
				return;
			}
			if (parsed.type === "git") {
				await this.removeGit(parsed, scope);
				return;
			}
			throw new Error(`Unsupported remove source: ${source}`);
		});
	}

	async update(source?: string): Promise<void> {
		if (source) {
			await this.updateSourceForScope(source, "user");
			await this.updateSourceForScope(source, "project");
			return;
		}

		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();
		for (const extension of globalSettings.extensions ?? []) {
			await this.updateSourceForScope(extension, "user");
		}
		for (const extension of projectSettings.extensions ?? []) {
			await this.updateSourceForScope(extension, "project");
		}
	}

	private async updateSourceForScope(source: string, scope: SourceScope): Promise<void> {
		const parsed = this.parseSource(source);
		if (parsed.type === "npm") {
			if (parsed.pinned) return;
			await this.withProgress("update", source, `Updating ${source}...`, async () => {
				await this.installNpm(parsed, scope, false);
			});
			return;
		}
		if (parsed.type === "git") {
			if (parsed.pinned) return;
			await this.withProgress("update", source, `Updating ${source}...`, async () => {
				await this.updateGit(parsed, scope);
			});
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
			const metadata: PathMetadata = { source: sourceStr, scope, origin: "package" };

			if (parsed.type === "local") {
				this.resolveLocalExtensionSource(parsed, accumulator, filter, metadata);
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
				const needsInstall = !existsSync(installedPath) || (await this.npmNeedsUpdate(parsed, installedPath));
				if (needsInstall) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				metadata.baseDir = installedPath;
				this.collectPackageResources(installedPath, accumulator, filter, metadata);
				continue;
			}

			if (parsed.type === "git") {
				const installedPath = this.getGitInstallPath(parsed, scope);
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				metadata.baseDir = installedPath;
				this.collectPackageResources(installedPath, accumulator, filter, metadata);
			}
		}
	}

	private resolveLocalExtensionSource(
		source: LocalSource,
		accumulator: ResourceAccumulator,
		filter: PackageFilter | undefined,
		metadata: PathMetadata,
	): void {
		const resolved = this.resolvePath(source.path);
		if (!existsSync(resolved)) {
			return;
		}

		try {
			const stats = statSync(resolved);
			if (stats.isFile()) {
				metadata.baseDir = dirname(resolved);
				this.addResource(accumulator.extensions, resolved, metadata, true);
				return;
			}
			if (stats.isDirectory()) {
				metadata.baseDir = resolved;
				const resources = this.collectPackageResources(resolved, accumulator, filter, metadata);
				if (!resources) {
					this.addResource(accumulator.extensions, resolved, metadata, true);
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

		if (source.startsWith("git:") || looksLikeGitUrl(source)) {
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

	/**
	 * Check if an npm package needs to be updated.
	 * - For unpinned packages: check if registry has a newer version
	 * - For pinned packages: check if installed version matches the pinned version
	 */
	private async npmNeedsUpdate(source: NpmSource, installedPath: string): Promise<boolean> {
		const installedVersion = this.getInstalledNpmVersion(installedPath);
		if (!installedVersion) return true;

		const { version: pinnedVersion } = this.parseNpmSpec(source.spec);
		if (pinnedVersion) {
			// Pinned: check if installed matches pinned (exact match for now)
			return installedVersion !== pinnedVersion;
		}

		// Unpinned: check registry for latest version
		try {
			const latestVersion = await this.getLatestNpmVersion(source.name);
			return latestVersion !== installedVersion;
		} catch {
			// If we can't check registry, assume it's fine
			return false;
		}
	}

	private getInstalledNpmVersion(installedPath: string): string | undefined {
		const packageJsonPath = join(installedPath, "package.json");
		if (!existsSync(packageJsonPath)) return undefined;
		try {
			const content = readFileSync(packageJsonPath, "utf-8");
			const pkg = JSON.parse(content) as { version?: string };
			return pkg.version;
		} catch {
			return undefined;
		}
	}

	private async getLatestNpmVersion(packageName: string): Promise<string> {
		const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
		if (!response.ok) throw new Error(`Failed to fetch npm registry: ${response.status}`);
		const data = (await response.json()) as { version: string };
		return data.version;
	}

	/**
	 * Get a unique identity for a package, ignoring version/ref.
	 * Used to detect when the same package is in both global and project settings.
	 */
	private getPackageIdentity(source: string): string {
		const parsed = this.parseSource(source);
		if (parsed.type === "npm") {
			return `npm:${parsed.name}`;
		}
		if (parsed.type === "git") {
			return `git:${parsed.repo}`;
		}
		// For local paths, use the absolute resolved path
		return `local:${this.resolvePath(parsed.path)}`;
	}

	/**
	 * Dedupe packages: if same package identity appears in both global and project,
	 * keep only the project one (project wins).
	 */
	private dedupePackages(
		packages: Array<{ pkg: PackageSource; scope: SourceScope }>,
	): Array<{ pkg: PackageSource; scope: SourceScope }> {
		const seen = new Map<string, { pkg: PackageSource; scope: SourceScope }>();

		for (const entry of packages) {
			const sourceStr = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
			const identity = this.getPackageIdentity(sourceStr);

			const existing = seen.get(identity);
			if (!existing) {
				seen.set(identity, entry);
			} else if (entry.scope === "project" && existing.scope === "user") {
				// Project wins over user
				seen.set(identity, entry);
			}
			// If existing is project and new is global, keep existing (project)
			// If both are same scope, keep first one
		}

		return Array.from(seen.values());
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
		if (scope === "user" && !temporary) {
			await this.runCommand("npm", ["install", "-g", source.spec]);
			return;
		}
		const installRoot = this.getNpmInstallRoot(scope, temporary);
		this.ensureNpmProject(installRoot);
		await this.runCommand("npm", ["install", source.spec, "--prefix", installRoot]);
	}

	private async uninstallNpm(source: NpmSource, scope: SourceScope): Promise<void> {
		if (scope === "user") {
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
		const gitRoot = this.getGitInstallRoot(scope);
		if (gitRoot) {
			this.ensureGitIgnore(gitRoot);
		}
		mkdirSync(dirname(targetDir), { recursive: true });
		const cloneUrl = source.repo.startsWith("http") ? source.repo : `https://${source.repo}`;
		await this.runCommand("git", ["clone", cloneUrl, targetDir]);
		if (source.ref) {
			await this.runCommand("git", ["checkout", source.ref], { cwd: targetDir });
		}
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

		// Fetch latest from remote (handles force-push by getting new history)
		await this.runCommand("git", ["fetch", "--prune", "origin"], { cwd: targetDir });

		// Reset to upstream tracking branch (handles force-push gracefully)
		await this.runCommand("git", ["reset", "--hard", "@{upstream}"], { cwd: targetDir });

		// Clean untracked files (extensions should be pristine)
		await this.runCommand("git", ["clean", "-fdx"], { cwd: targetDir });

		const packageJsonPath = join(targetDir, "package.json");
		if (existsSync(packageJsonPath)) {
			await this.runCommand("npm", ["install"], { cwd: targetDir });
		}
	}

	private async removeGit(source: GitSource, scope: SourceScope): Promise<void> {
		const targetDir = this.getGitInstallPath(source, scope);
		if (!existsSync(targetDir)) return;
		rmSync(targetDir, { recursive: true, force: true });
		this.pruneEmptyGitParents(targetDir, this.getGitInstallRoot(scope));
	}

	private pruneEmptyGitParents(targetDir: string, installRoot: string | undefined): void {
		if (!installRoot) return;
		const resolvedRoot = resolve(installRoot);
		let current = dirname(targetDir);
		while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
			if (!existsSync(current)) {
				current = dirname(current);
				continue;
			}
			const entries = readdirSync(current);
			if (entries.length > 0) {
				break;
			}
			try {
				rmSync(current, { recursive: true, force: true });
			} catch {
				break;
			}
			current = dirname(current);
		}
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

	private getGitInstallRoot(scope: SourceScope): string | undefined {
		if (scope === "temporary") {
			return undefined;
		}
		if (scope === "project") {
			return join(this.cwd, CONFIG_DIR_NAME, "git");
		}
		return join(this.agentDir, "git");
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

	private resolvePathFromBase(input: string, baseDir: string): string {
		const trimmed = input.trim();
		if (trimmed === "~") return homedir();
		if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
		if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
		return resolve(baseDir, trimmed);
	}

	private collectPackageResources(
		packageRoot: string,
		accumulator: ResourceAccumulator,
		filter: PackageFilter | undefined,
		metadata: PathMetadata,
	): boolean {
		if (filter) {
			for (const resourceType of RESOURCE_TYPES) {
				const patterns = filter[resourceType as keyof PackageFilter];
				const target = this.getTargetMap(accumulator, resourceType);
				if (patterns !== undefined) {
					this.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata);
				} else {
					this.collectDefaultResources(packageRoot, resourceType, target, metadata);
				}
			}
			return true;
		}

		const manifest = this.readPiManifest(packageRoot);
		if (manifest) {
			for (const resourceType of RESOURCE_TYPES) {
				const entries = manifest[resourceType as keyof PiManifest];
				this.addManifestEntries(
					entries,
					packageRoot,
					resourceType,
					this.getTargetMap(accumulator, resourceType),
					metadata,
				);
			}
			return true;
		}

		let hasAnyDir = false;
		for (const resourceType of RESOURCE_TYPES) {
			const dir = join(packageRoot, resourceType);
			if (existsSync(dir)) {
				// Collect all files from the directory (all enabled by default)
				const files =
					resourceType === "skills" ? collectSkillEntries(dir) : collectFiles(dir, FILE_PATTERNS[resourceType]);
				for (const f of files) {
					this.addResource(this.getTargetMap(accumulator, resourceType), f, metadata, true);
				}
				hasAnyDir = true;
			}
		}
		return hasAnyDir;
	}

	private collectDefaultResources(
		packageRoot: string,
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
	): void {
		const manifest = this.readPiManifest(packageRoot);
		const entries = manifest?.[resourceType as keyof PiManifest];
		if (entries) {
			this.addManifestEntries(entries, packageRoot, resourceType, target, metadata);
			return;
		}
		const dir = join(packageRoot, resourceType);
		if (existsSync(dir)) {
			// Collect all files from the directory (all enabled by default)
			const files =
				resourceType === "skills" ? collectSkillEntries(dir) : collectFiles(dir, FILE_PATTERNS[resourceType]);
			for (const f of files) {
				this.addResource(target, f, metadata, true);
			}
		}
	}

	private applyPackageFilter(
		packageRoot: string,
		userPatterns: string[],
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
	): void {
		const { allFiles, enabledByManifest } = this.collectManifestFiles(packageRoot, resourceType);

		if (userPatterns.length === 0) {
			// No user patterns, just use manifest filtering
			for (const f of allFiles) {
				this.addResource(target, f, metadata, enabledByManifest.has(f));
			}
			return;
		}

		// Apply user patterns on top of manifest-enabled files
		const enabledByUser = applyPatterns(allFiles, userPatterns, packageRoot);

		for (const f of allFiles) {
			const enabled = enabledByUser.has(f);
			this.addResource(target, f, metadata, enabled);
		}
	}

	/**
	 * Collect all files from a package for a resource type, applying manifest patterns.
	 * Returns { allFiles, enabledByManifest } where enabledByManifest is the set of files
	 * that pass the manifest's own patterns.
	 */
	private collectManifestFiles(
		packageRoot: string,
		resourceType: ResourceType,
	): { allFiles: string[]; enabledByManifest: Set<string> } {
		const manifest = this.readPiManifest(packageRoot);
		const entries = manifest?.[resourceType as keyof PiManifest];
		if (entries && entries.length > 0) {
			const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
			const manifestPatterns = entries.filter(isPattern);
			const enabledByManifest =
				manifestPatterns.length > 0 ? applyPatterns(allFiles, manifestPatterns, packageRoot) : new Set(allFiles);
			return { allFiles: Array.from(enabledByManifest), enabledByManifest };
		}

		const conventionDir = join(packageRoot, resourceType);
		if (!existsSync(conventionDir)) {
			return { allFiles: [], enabledByManifest: new Set() };
		}
		const allFiles =
			resourceType === "skills"
				? collectSkillEntries(conventionDir)
				: collectFiles(conventionDir, FILE_PATTERNS[resourceType]);
		return { allFiles, enabledByManifest: new Set(allFiles) };
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

	private addManifestEntries(
		entries: string[] | undefined,
		root: string,
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
	): void {
		if (!entries) return;

		const allFiles = this.collectFilesFromManifestEntries(entries, root, resourceType);
		const patterns = entries.filter(isPattern);
		const enabledPaths = applyPatterns(allFiles, patterns, root);

		for (const f of allFiles) {
			if (enabledPaths.has(f)) {
				this.addResource(target, f, metadata, true);
			}
		}
	}

	private collectFilesFromManifestEntries(entries: string[], root: string, resourceType: ResourceType): string[] {
		const plain = entries.filter((entry) => !isPattern(entry));
		const resolved = plain.map((entry) => resolve(root, entry));
		return this.collectFilesFromPaths(resolved, resourceType);
	}

	private resolveLocalEntries(
		entries: string[],
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
		baseDir: string,
	): void {
		if (entries.length === 0) return;

		// Collect all files from plain entries (non-pattern entries)
		const { plain, patterns } = splitPatterns(entries);
		const resolvedPlain = plain.map((p) => this.resolvePathFromBase(p, baseDir));
		const allFiles = this.collectFilesFromPaths(resolvedPlain, resourceType);

		// Determine which files are enabled based on patterns
		const enabledPaths = applyPatterns(allFiles, patterns, baseDir);

		// Add all files with their enabled state
		for (const f of allFiles) {
			this.addResource(target, f, metadata, enabledPaths.has(f));
		}
	}

	private addAutoDiscoveredResources(
		accumulator: ResourceAccumulator,
		globalSettings: ReturnType<SettingsManager["getGlobalSettings"]>,
		projectSettings: ReturnType<SettingsManager["getProjectSettings"]>,
		globalBaseDir: string,
		projectBaseDir: string,
	): void {
		const userMetadata: PathMetadata = {
			source: "auto",
			scope: "user",
			origin: "top-level",
			baseDir: globalBaseDir,
		};
		const projectMetadata: PathMetadata = {
			source: "auto",
			scope: "project",
			origin: "top-level",
			baseDir: projectBaseDir,
		};

		const userOverrides = {
			extensions: (globalSettings.extensions ?? []) as string[],
			skills: (globalSettings.skills ?? []) as string[],
			prompts: (globalSettings.prompts ?? []) as string[],
			themes: (globalSettings.themes ?? []) as string[],
		};
		const projectOverrides = {
			extensions: (projectSettings.extensions ?? []) as string[],
			skills: (projectSettings.skills ?? []) as string[],
			prompts: (projectSettings.prompts ?? []) as string[],
			themes: (projectSettings.themes ?? []) as string[],
		};

		const userDirs = {
			extensions: join(globalBaseDir, "extensions"),
			skills: join(globalBaseDir, "skills"),
			prompts: join(globalBaseDir, "prompts"),
			themes: join(globalBaseDir, "themes"),
		};
		const projectDirs = {
			extensions: join(projectBaseDir, "extensions"),
			skills: join(projectBaseDir, "skills"),
			prompts: join(projectBaseDir, "prompts"),
			themes: join(projectBaseDir, "themes"),
		};

		const addResources = (
			resourceType: ResourceType,
			paths: string[],
			metadata: PathMetadata,
			overrides: string[],
			baseDir: string,
		) => {
			const target = this.getTargetMap(accumulator, resourceType);
			for (const path of paths) {
				const enabled = isEnabledByOverrides(path, overrides, baseDir);
				this.addResource(target, path, metadata, enabled);
			}
		};

		addResources(
			"extensions",
			collectAutoExtensionEntries(userDirs.extensions),
			userMetadata,
			userOverrides.extensions,
			globalBaseDir,
		);
		addResources(
			"skills",
			collectAutoSkillEntries(userDirs.skills),
			userMetadata,
			userOverrides.skills,
			globalBaseDir,
		);
		addResources(
			"prompts",
			collectAutoPromptEntries(userDirs.prompts),
			userMetadata,
			userOverrides.prompts,
			globalBaseDir,
		);
		addResources(
			"themes",
			collectAutoThemeEntries(userDirs.themes),
			userMetadata,
			userOverrides.themes,
			globalBaseDir,
		);

		addResources(
			"extensions",
			collectAutoExtensionEntries(projectDirs.extensions),
			projectMetadata,
			projectOverrides.extensions,
			projectBaseDir,
		);
		addResources(
			"skills",
			collectAutoSkillEntries(projectDirs.skills),
			projectMetadata,
			projectOverrides.skills,
			projectBaseDir,
		);
		addResources(
			"prompts",
			collectAutoPromptEntries(projectDirs.prompts),
			projectMetadata,
			projectOverrides.prompts,
			projectBaseDir,
		);
		addResources(
			"themes",
			collectAutoThemeEntries(projectDirs.themes),
			projectMetadata,
			projectOverrides.themes,
			projectBaseDir,
		);
	}

	private collectFilesFromPaths(paths: string[], resourceType: ResourceType): string[] {
		const files: string[] = [];
		for (const p of paths) {
			if (!existsSync(p)) continue;

			try {
				const stats = statSync(p);
				if (stats.isFile()) {
					files.push(p);
				} else if (stats.isDirectory()) {
					if (resourceType === "skills") {
						files.push(...collectSkillEntries(p));
					} else {
						files.push(...collectFiles(p, FILE_PATTERNS[resourceType]));
					}
				}
			} catch {
				// Ignore errors
			}
		}
		return files;
	}

	private getTargetMap(
		accumulator: ResourceAccumulator,
		resourceType: ResourceType,
	): Map<string, { metadata: PathMetadata; enabled: boolean }> {
		switch (resourceType) {
			case "extensions":
				return accumulator.extensions;
			case "skills":
				return accumulator.skills;
			case "prompts":
				return accumulator.prompts;
			case "themes":
				return accumulator.themes;
			default:
				throw new Error(`Unknown resource type: ${resourceType}`);
		}
	}

	private addResource(
		map: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		path: string,
		metadata: PathMetadata,
		enabled: boolean,
	): void {
		if (!path) return;
		if (!map.has(path)) {
			map.set(path, { metadata, enabled });
		}
	}

	private createAccumulator(): ResourceAccumulator {
		return {
			extensions: new Map(),
			skills: new Map(),
			prompts: new Map(),
			themes: new Map(),
		};
	}

	private toResolvedPaths(accumulator: ResourceAccumulator): ResolvedPaths {
		const toResolved = (entries: Map<string, { metadata: PathMetadata; enabled: boolean }>): ResolvedResource[] => {
			return Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
				path,
				enabled,
				metadata,
			}));
		};

		return {
			extensions: toResolved(accumulator.extensions),
			skills: toResolved(accumulator.skills),
			prompts: toResolved(accumulator.prompts),
			themes: toResolved(accumulator.themes),
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
