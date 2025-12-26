/**
 * npm package resolution utilities.
 * Used by hooks and custom tools loaders.
 *
 * Supports version specifiers (e.g., @scope/package@1.0.0).
 * Packages are installed to ~/.pi/agent/cache/node_modules.
 *
 * For @latest packages, checks if a newer version exists before reinstalling.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "../config.js";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Timeout for npm view command (version check) */
const NPM_VIEW_TIMEOUT_MS = 10_000;

/** Timeout for npm install command */
const NPM_INSTALL_TIMEOUT_MS = 60_000;

function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

/**
 * Expand ~ to home directory.
 */
export function expandPath(p: string): string {
	const normalized = normalizeUnicodeSpaces(p);
	if (normalized.startsWith("~/")) {
		return path.join(os.homedir(), normalized.slice(2));
	}
	if (normalized.startsWith("~")) {
		return path.join(os.homedir(), normalized.slice(1));
	}
	return normalized;
}

/**
 * Check if a path looks like an npm package specifier.
 * npm packages:
 * - Start with @ (scoped): @scope/package, @scope/package@version
 * - Or are bare identifiers: package, package@version
 *
 * File paths:
 * - Absolute paths (Unix: /path, Windows: C:\path or C:/path)
 * - Start with ~ (home)
 * - Start with ./ or ../ (relative)
 */
export function isNpmPackage(specifier: string): boolean {
	if (
		path.isAbsolute(specifier) ||
		specifier.startsWith("~") ||
		specifier.startsWith("./") ||
		specifier.startsWith("../")
	) {
		return false;
	}
	return true;
}

/**
 * Parse npm package specifier into name and version.
 * Examples:
 * - "@scope/pkg@1.0.0" → { name: "@scope/pkg", version: "1.0.0" }
 * - "@scope/pkg" → { name: "@scope/pkg", version: undefined }
 * - "pkg@latest" → { name: "pkg", version: "latest" }
 * - "pkg" → { name: "pkg", version: undefined }
 */
export function parsePackageSpecifier(specifier: string): { name: string; version: string | undefined } {
	// For scoped packages (@scope/pkg@version), find @ after the scope
	if (specifier.startsWith("@")) {
		const slashIndex = specifier.indexOf("/");
		if (slashIndex === -1) {
			return { name: specifier, version: undefined };
		}
		const afterSlash = specifier.substring(slashIndex + 1);
		const atIndex = afterSlash.indexOf("@");
		if (atIndex === -1) {
			return { name: specifier, version: undefined };
		}
		return {
			name: specifier.substring(0, slashIndex + 1 + atIndex),
			version: afterSlash.substring(atIndex + 1),
		};
	}

	// For non-scoped packages (pkg@version)
	const atIndex = specifier.indexOf("@");
	if (atIndex === -1) {
		return { name: specifier, version: undefined };
	}
	return {
		name: specifier.substring(0, atIndex),
		version: specifier.substring(atIndex + 1),
	};
}

/**
 * Get the cache directory for npm packages.
 */
function getCacheDir(): string {
	return path.join(getAgentDir(), "cache");
}

interface CachePackageJson {
	dependencies: Record<string, string>;
	latestTracked: string[];
}

/**
 * Read package.json from cache directory.
 */
function readCachePackageJson(): CachePackageJson {
	const pkgJsonPath = path.join(getCacheDir(), "package.json");
	try {
		const content = fs.readFileSync(pkgJsonPath, "utf-8");
		const pkg = JSON.parse(content);
		return {
			dependencies: pkg.dependencies ?? {},
			latestTracked: pkg.latestTracked ?? [],
		};
	} catch {
		return { dependencies: {}, latestTracked: [] };
	}
}

/**
 * Write package.json to cache directory.
 */
function writeCachePackageJson(data: CachePackageJson): void {
	const cacheDir = getCacheDir();
	fs.mkdirSync(cacheDir, { recursive: true });
	const pkgJsonPath = path.join(cacheDir, "package.json");
	const pkg = {
		name: "pi-cache",
		private: true,
		dependencies: data.dependencies,
		latestTracked: data.latestTracked,
	};
	fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2));
}

/**
 * Run npm command with timeout.
 */
async function runNpm(
	args: string[],
	cwd: string,
	timeoutMs: number,
): Promise<{ success: boolean; stdout: string; stderr: string; timedOut: boolean }> {
	return new Promise((resolve) => {
		const proc = spawn("npm", args, {
			cwd,
			shell: process.platform === "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timeoutId = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!proc.killed) {
					proc.kill("SIGKILL");
				}
			}, 5000);
		}, timeoutMs);

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			clearTimeout(timeoutId);
			resolve({ success: code === 0, stdout, stderr, timedOut });
		});

		proc.on("error", (err) => {
			clearTimeout(timeoutId);
			resolve({ success: false, stdout, stderr: err.message, timedOut });
		});
	});
}

/**
 * Check the latest version of a package from npm registry.
 * Returns null if check fails (network error, timeout, etc.).
 */
async function checkLatestVersion(packageName: string): Promise<string | null> {
	const cacheDir = getCacheDir();
	fs.mkdirSync(cacheDir, { recursive: true });

	const result = await runNpm(["view", packageName, "version"], cacheDir, NPM_VIEW_TIMEOUT_MS);

	if (!result.success || result.timedOut) {
		return null;
	}

	const version = result.stdout.trim();
	// Basic semver validation
	if (/^\d+\.\d+\.\d+/.test(version)) {
		return version;
	}

	return null;
}

/**
 * Install npm package to cache directory.
 * Returns the path to the installed package, or null on failure.
 */
export async function installNpmPackage(specifier: string): Promise<{ path: string | null; error: string | null }> {
	const { name, version } = parsePackageSpecifier(specifier);
	const versionSpec = version ?? "latest";
	const isLatest = versionSpec === "latest";
	const fullSpec = `${name}@${versionSpec}`;

	const cacheDir = getCacheDir();
	const cache = readCachePackageJson();
	const installedVersion = cache.dependencies[name];
	const modulePath = path.join(cacheDir, "node_modules", name);

	// Check if already installed
	if (installedVersion && fs.existsSync(modulePath)) {
		// For exact versions, just check if it matches
		if (!isLatest && installedVersion === versionSpec) {
			return { path: modulePath, error: null };
		}

		// For @latest, check if we need to update
		if (isLatest && cache.latestTracked.includes(name)) {
			const latestVersion = await checkLatestVersion(name);

			// If check failed (network issues), use cached version
			if (latestVersion === null) {
				return { path: modulePath, error: null };
			}

			// If already on latest, skip install
			if (latestVersion === installedVersion) {
				return { path: modulePath, error: null };
			}

			// Newer version available, fall through to install
		}
	}

	// Install the package
	fs.mkdirSync(cacheDir, { recursive: true });

	const result = await runNpm(["install", "--prefix", cacheDir, fullSpec], cacheDir, NPM_INSTALL_TIMEOUT_MS);

	if (result.timedOut) {
		return { path: null, error: `Timeout installing ${fullSpec} (exceeded ${NPM_INSTALL_TIMEOUT_MS / 1000}s)` };
	}

	if (!result.success) {
		return { path: null, error: `Failed to install ${fullSpec}: ${result.stderr}` };
	}

	// Read installed version from package.json
	let resolvedVersion = versionSpec;
	const installedPkgPath = path.join(modulePath, "package.json");
	try {
		const installedPkg = JSON.parse(fs.readFileSync(installedPkgPath, "utf-8"));
		if (installedPkg.version) {
			resolvedVersion = installedPkg.version;
		}
	} catch {
		// Keep versionSpec if we can't read the version
	}

	// Update cache
	cache.dependencies[name] = resolvedVersion;

	// Track packages installed with @latest
	if (isLatest && !cache.latestTracked.includes(name)) {
		cache.latestTracked.push(name);
	} else if (!isLatest && cache.latestTracked.includes(name)) {
		// Remove from latestTracked if now using exact version
		cache.latestTracked = cache.latestTracked.filter((n) => n !== name);
	}

	writeCachePackageJson(cache);

	return { path: modulePath, error: null };
}

/**
 * Resolve npm package. If version is specified, installs to cache.
 * Otherwise uses require.resolve for already-installed packages.
 */
export async function resolveNpmPackage(specifier: string): Promise<{ path: string | null; error: string | null }> {
	const { name, version } = parsePackageSpecifier(specifier);

	// If version specified, install to cache
	if (version) {
		return installNpmPackage(specifier);
	}

	// Try require.resolve first (for globally/locally installed packages)
	const require = createRequire(import.meta.url);
	try {
		return { path: require.resolve(name), error: null };
	} catch {
		// Not found via require.resolve, try installing latest
		return installNpmPackage(specifier);
	}
}

/**
 * Resolve a path that can be either an npm package or a file path.
 * - npm packages resolved via require.resolve or installed to cache
 * - Absolute paths used as-is
 * - Paths starting with ~ expanded to home directory
 * - Relative paths resolved from cwd
 */
export async function resolvePath(
	specifier: string,
	cwd: string,
): Promise<{ path: string | null; error: string | null }> {
	if (isNpmPackage(specifier)) {
		return resolveNpmPackage(specifier);
	}

	// File path resolution
	const expanded = expandPath(specifier);
	const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
	return { path: resolved, error: null };
}
