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
}

export interface ResolvedPaths {
	extensions: string[];
	skills: string[];
	prompts: string[];
	themes: string[];
	metadata: Map<string, PathMetadata>;
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
	getInstalledPath(source: string, scope: "global" | "project"): string | undefined;
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
	metadata: Map<string, PathMetadata>;
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
	return s.startsWith("!") || s.includes("*") || s.includes("?");
}

function hasPatterns(entries: string[]): boolean {
	return entries.some(isPattern);
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

	let result: string[];
	if (includes.length === 0) {
		result = [...allPaths];
	} else {
		result = allPaths.filter((filePath) => {
			const rel = relative(baseDir, filePath);
			const name = basename(filePath);
			return includes.some((pattern) => {
				return minimatch(rel, pattern) || minimatch(name, pattern) || minimatch(filePath, pattern);
			});
		});
	}

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

	getInstalledPath(source: string, scope: "global" | "project"): string | undefined {
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
			allPackages.push({ pkg, scope: "global" });
		}
		for (const pkg of projectSettings.packages ?? []) {
			allPackages.push({ pkg, scope: "project" });
		}

		// Dedupe: project scope wins over global for same package identity
		const packageSources = this.dedupePackages(allPackages);
		await this.resolvePackageSources(packageSources, accumulator, onMissing);

		for (const resourceType of RESOURCE_TYPES) {
			const target = this.getTargetSet(accumulator, resourceType);
			const globalEntries = (globalSettings[resourceType] ?? []) as string[];
			const projectEntries = (projectSettings[resourceType] ?? []) as string[];
			this.resolveLocalEntries(
				globalEntries,
				resourceType,
				target,
				{ source: "local", scope: "global", origin: "top-level" },
				accumulator,
			);
			this.resolveLocalEntries(
				projectEntries,
				resourceType,
				target,
				{ source: "local", scope: "project", origin: "top-level" },
				accumulator,
			);
		}

		return this.toResolvedPaths(accumulator);
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
		const scope: SourceScope = options?.local ? "project" : "global";
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
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				this.collectPackageResources(installedPath, accumulator, filter, metadata);
				continue;
			}

			if (parsed.type === "git") {
				const installedPath = this.getGitInstallPath(parsed, scope);
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				}
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
				this.addPath(accumulator.extensions, resolved, metadata, accumulator);
				return;
			}
			if (stats.isDirectory()) {
				const resources = this.collectPackageResources(resolved, accumulator, filter, metadata);
				if (!resources) {
					this.addPath(accumulator.extensions, resolved, metadata, accumulator);
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
			} else if (entry.scope === "project" && existing.scope === "global") {
				// Project wins over global
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
		filter: PackageFilter | undefined,
		metadata: PathMetadata,
	): boolean {
		if (filter) {
			for (const resourceType of RESOURCE_TYPES) {
				const patterns = filter[resourceType as keyof PackageFilter];
				const target = this.getTargetSet(accumulator, resourceType);
				if (patterns !== undefined) {
					this.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata, accumulator);
				} else {
					this.collectDefaultResources(packageRoot, resourceType, target, metadata, accumulator);
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
					this.getTargetSet(accumulator, resourceType),
					metadata,
					accumulator,
				);
			}
			return true;
		}

		let hasAnyDir = false;
		for (const resourceType of RESOURCE_TYPES) {
			const dir = join(packageRoot, resourceType);
			if (existsSync(dir)) {
				this.addPath(this.getTargetSet(accumulator, resourceType), dir, metadata, accumulator);
				hasAnyDir = true;
			}
		}
		return hasAnyDir;
	}

	private collectDefaultResources(
		packageRoot: string,
		resourceType: ResourceType,
		target: Set<string>,
		metadata: PathMetadata,
		accumulator: ResourceAccumulator,
	): void {
		const manifest = this.readPiManifest(packageRoot);
		const entries = manifest?.[resourceType as keyof PiManifest];
		if (entries) {
			this.addManifestEntries(entries, packageRoot, resourceType, target, metadata, accumulator);
			return;
		}
		const dir = join(packageRoot, resourceType);
		if (existsSync(dir)) {
			this.addPath(target, dir, metadata, accumulator);
		}
	}

	private applyPackageFilter(
		packageRoot: string,
		userPatterns: string[],
		resourceType: ResourceType,
		target: Set<string>,
		metadata: PathMetadata,
		accumulator: ResourceAccumulator,
	): void {
		if (userPatterns.length === 0) {
			return;
		}

		const manifestFiles = this.collectManifestFilteredFiles(packageRoot, resourceType);
		const filtered = applyPatterns(manifestFiles, userPatterns, packageRoot);
		for (const f of filtered) {
			this.addPath(target, f, metadata, accumulator);
		}
	}

	private collectManifestFilteredFiles(packageRoot: string, resourceType: ResourceType): string[] {
		const manifest = this.readPiManifest(packageRoot);
		const entries = manifest?.[resourceType as keyof PiManifest];
		if (entries && entries.length > 0) {
			const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
			const manifestPatterns = entries.filter(isPattern);
			return manifestPatterns.length > 0 ? applyPatterns(allFiles, manifestPatterns, packageRoot) : allFiles;
		}

		const conventionDir = join(packageRoot, resourceType);
		if (!existsSync(conventionDir)) {
			return [];
		}
		return resourceType === "skills"
			? collectSkillEntries(conventionDir)
			: collectFiles(conventionDir, FILE_PATTERNS[resourceType]);
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
		target: Set<string>,
		metadata: PathMetadata,
		accumulator: ResourceAccumulator,
	): void {
		if (!entries) return;

		if (!hasPatterns(entries)) {
			for (const entry of entries) {
				const resolved = resolve(root, entry);
				this.addPath(target, resolved, metadata, accumulator);
			}
			return;
		}

		const allFiles = this.collectFilesFromManifestEntries(entries, root, resourceType);
		const patterns = entries.filter(isPattern);
		const filtered = applyPatterns(allFiles, patterns, root);
		for (const f of filtered) {
			this.addPath(target, f, metadata, accumulator);
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
		target: Set<string>,
		metadata: PathMetadata,
		accumulator: ResourceAccumulator,
	): void {
		if (entries.length === 0) return;

		if (!hasPatterns(entries)) {
			for (const entry of entries) {
				const resolved = this.resolvePath(entry);
				if (existsSync(resolved)) {
					this.addPath(target, resolved, metadata, accumulator);
				}
			}
			return;
		}

		const { plain, patterns } = splitPatterns(entries);
		const resolvedPlain = plain.map((p) => this.resolvePath(p));
		const allFiles = this.collectFilesFromPaths(resolvedPlain, resourceType);
		const filtered = applyPatterns(allFiles, patterns, this.cwd);
		for (const f of filtered) {
			this.addPath(target, f, metadata, accumulator);
		}
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

	private getTargetSet(accumulator: ResourceAccumulator, resourceType: ResourceType): Set<string> {
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

	private addPath(set: Set<string>, value: string, metadata?: PathMetadata, accumulator?: ResourceAccumulator): void {
		if (!value) return;
		set.add(value);
		if (metadata && accumulator && !accumulator.metadata.has(value)) {
			accumulator.metadata.set(value, metadata);
		}
	}

	private createAccumulator(): ResourceAccumulator {
		return {
			extensions: new Set<string>(),
			skills: new Set<string>(),
			prompts: new Set<string>(),
			themes: new Set<string>(),
			metadata: new Map<string, PathMetadata>(),
		};
	}

	private toResolvedPaths(accumulator: ResourceAccumulator): ResolvedPaths {
		return {
			extensions: Array.from(accumulator.extensions),
			skills: Array.from(accumulator.skills),
			prompts: Array.from(accumulator.prompts),
			themes: Array.from(accumulator.themes),
			metadata: accumulator.metadata,
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
