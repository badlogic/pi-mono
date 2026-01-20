import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "../config.js";
import type { SettingsManager } from "./settings-manager.js";

export interface ResolvedPaths {
	extensions: string[];
	skills: string[];
	prompts: string[];
	themes: string[];
}

export type MissingSourceAction = "install" | "skip" | "error";

export interface PackageManager {
	resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths>;
	install(source: string, options?: { local?: boolean }): Promise<void>;
	remove(source: string, options?: { local?: boolean }): Promise<void>;
	update(source?: string): Promise<void>;
	resolveExtensionSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedPaths>;
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

export class DefaultPackageManager implements PackageManager {
	private cwd: string;
	private agentDir: string;
	private settingsManager: SettingsManager;
	private globalNpmRoot: string | undefined;

	constructor(options: PackageManagerOptions) {
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.settingsManager = options.settingsManager;
	}

	async resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths> {
		const accumulator = this.createAccumulator();
		const globalSettings = this.settingsManager.getGlobalSettings();
		const projectSettings = this.settingsManager.getProjectSettings();

		const extensionSources: Array<{ source: string; scope: SourceScope }> = [];
		for (const source of globalSettings.extensions ?? []) {
			extensionSources.push({ source, scope: "global" });
		}
		for (const source of projectSettings.extensions ?? []) {
			extensionSources.push({ source, scope: "project" });
		}

		await this.resolveExtensionSourcesInternal(extensionSources, accumulator, onMissing);

		for (const skill of projectSettings.skills ?? []) {
			this.addPath(accumulator.skills, this.resolvePath(skill));
		}
		for (const skill of globalSettings.skills ?? []) {
			this.addPath(accumulator.skills, this.resolvePath(skill));
		}
		for (const prompt of projectSettings.prompts ?? []) {
			this.addPath(accumulator.prompts, this.resolvePath(prompt));
		}
		for (const prompt of globalSettings.prompts ?? []) {
			this.addPath(accumulator.prompts, this.resolvePath(prompt));
		}
		for (const theme of projectSettings.themes ?? []) {
			this.addPath(accumulator.themes, this.resolvePath(theme));
		}
		for (const theme of globalSettings.themes ?? []) {
			this.addPath(accumulator.themes, this.resolvePath(theme));
		}

		return this.toResolvedPaths(accumulator);
	}

	async resolveExtensionSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedPaths> {
		const accumulator = this.createAccumulator();
		const scope: SourceScope = options?.temporary ? "temporary" : options?.local ? "project" : "global";
		const extensionSources = sources.map((source) => ({ source, scope }));
		await this.resolveExtensionSourcesInternal(extensionSources, accumulator);
		return this.toResolvedPaths(accumulator);
	}

	async install(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "global";
		if (parsed.type === "npm") {
			await this.installNpm(parsed, scope, false);
			return;
		}
		if (parsed.type === "git") {
			await this.installGit(parsed, scope, false);
			return;
		}
		throw new Error(`Unsupported install source: ${source}`);
	}

	async remove(source: string, options?: { local?: boolean }): Promise<void> {
		const parsed = this.parseSource(source);
		const scope: SourceScope = options?.local ? "project" : "global";
		if (parsed.type === "npm") {
			await this.uninstallNpm(parsed, scope);
			return;
		}
		if (parsed.type === "git") {
			await this.removeGit(parsed, scope, false);
			return;
		}
		throw new Error(`Unsupported remove source: ${source}`);
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
			await this.installNpm(parsed, scope, false);
			return;
		}
		if (parsed.type === "git") {
			if (parsed.pinned) return;
			await this.updateGit(parsed, scope, false);
			return;
		}
	}

	private async resolveExtensionSourcesInternal(
		sources: Array<{ source: string; scope: SourceScope }>,
		accumulator: ResourceAccumulator,
		onMissing?: (source: string) => Promise<MissingSourceAction>,
	): Promise<void> {
		for (const { source, scope } of sources) {
			const parsed = this.parseSource(source);
			if (parsed.type === "local") {
				this.resolveLocalExtensionSource(parsed, accumulator);
				continue;
			}

			const installMissing = async (): Promise<boolean> => {
				if (!onMissing) {
					await this.installParsedSource(parsed, scope);
					return true;
				}
				const action = await onMissing(source);
				if (action === "skip") return false;
				if (action === "error") throw new Error(`Missing source: ${source}`);
				await this.installParsedSource(parsed, scope);
				return true;
			};

			if (parsed.type === "npm") {
				const installedPath = this.getNpmInstallPath(parsed, scope);
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				this.collectPackageResources(installedPath, accumulator);
				continue;
			}

			if (parsed.type === "git") {
				const installedPath = this.getGitInstallPath(parsed, scope);
				if (!existsSync(installedPath)) {
					const installed = await installMissing();
					if (!installed) continue;
				}
				this.collectPackageResources(installedPath, accumulator);
			}
		}
	}

	private resolveLocalExtensionSource(source: LocalSource, accumulator: ResourceAccumulator): void {
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
				const resources = this.collectPackageResources(resolved, accumulator);
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
			await this.installGit(parsed, scope, scope === "temporary");
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

		if (source.startsWith("git:")) {
			const repoSpec = source.slice("git:".length).trim();
			const [repo, ref] = repoSpec.split("@");
			const normalized = repo.replace(/^https?:\/\//, "");
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

	private async installGit(source: GitSource, scope: SourceScope, temporary: boolean): Promise<void> {
		const targetDir = this.getGitInstallPath(source, scope, temporary);
		if (existsSync(targetDir)) {
			return;
		}
		mkdirSync(dirname(targetDir), { recursive: true });
		const cloneUrl = source.repo.startsWith("http") ? source.repo : `https://${source.repo}`;
		await this.runCommand("git", ["clone", cloneUrl, targetDir]);
		if (source.ref) {
			await this.runCommand("git", ["checkout", source.ref], { cwd: targetDir });
		}
	}

	private async updateGit(source: GitSource, scope: SourceScope, temporary: boolean): Promise<void> {
		const targetDir = this.getGitInstallPath(source, scope, temporary);
		if (!existsSync(targetDir)) {
			await this.installGit(source, scope, temporary);
			return;
		}
		await this.runCommand("git", ["pull"], { cwd: targetDir });
	}

	private async removeGit(source: GitSource, scope: SourceScope, temporary: boolean): Promise<void> {
		const targetDir = this.getGitInstallPath(source, scope, temporary);
		if (!existsSync(targetDir)) return;
		rmSync(targetDir, { recursive: true, force: true });
	}

	private ensureNpmProject(installRoot: string): void {
		if (!existsSync(installRoot)) {
			mkdirSync(installRoot, { recursive: true });
		}
		const packageJsonPath = join(installRoot, "package.json");
		if (!existsSync(packageJsonPath)) {
			const pkgJson = { name: "pi-extensions", private: true };
			writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
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

	private getGitInstallPath(source: GitSource, scope: SourceScope, temporary?: boolean): string {
		if (temporary) {
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

	private collectPackageResources(packageRoot: string, accumulator: ResourceAccumulator): boolean {
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
