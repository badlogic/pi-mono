/**
 * Hook loader - loads TypeScript hook modules using jiti.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment } from "@mariozechner/pi-agent-core";
import { createJiti } from "jiti";
import { getAgentDir } from "../../config.js";
import type { HookAPI, HookFactory } from "./types.js";

// Create require function to resolve module paths at runtime
const require = createRequire(import.meta.url);

// Lazily computed aliases - resolved at runtime to handle global installs
let _aliases: Record<string, string> | null = null;
function getAliases(): Record<string, string> {
	if (_aliases) return _aliases;

	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packageIndex = path.resolve(__dirname, "../..", "index.js");

	// For typebox, we need the package root directory (not the entry file)
	// because jiti's alias is prefix-based: imports like "@sinclair/typebox/compiler"
	// get the alias prepended. If we alias to the entry file (.../build/cjs/index.js),
	// then "@sinclair/typebox/compiler" becomes ".../build/cjs/index.js/compiler" (invalid).
	// By aliasing to the package root, it becomes ".../typebox/compiler" which resolves correctly.
	const typeboxEntry = require.resolve("@sinclair/typebox");
	const typeboxRoot = typeboxEntry.replace(/\/build\/cjs\/index\.js$/, "");

	_aliases = {
		"@mariozechner/pi-coding-agent": packageIndex,
		"@mariozechner/pi-coding-agent/hooks": path.resolve(__dirname, "index.js"),
		"@mariozechner/pi-tui": require.resolve("@mariozechner/pi-tui"),
		"@mariozechner/pi-ai": require.resolve("@mariozechner/pi-ai"),
		"@sinclair/typebox": typeboxRoot,
	};
	return _aliases;
}

/**
 * Generic handler function type.
 */
type HandlerFn = (...args: unknown[]) => Promise<unknown>;

/**
 * Send handler type for pi.send().
 */
export type SendHandler = (text: string, attachments?: Attachment[]) => void;

/**
 * Registered handlers for a loaded hook.
 */
export interface LoadedHook {
	/** Original path from config */
	path: string;
	/** Resolved absolute path */
	resolvedPath: string;
	/** Map of event type to handler functions */
	handlers: Map<string, HandlerFn[]>;
	/** Set the send handler for this hook's pi.send() */
	setSendHandler: (handler: SendHandler) => void;
}

/**
 * Result of loading hooks.
 */
export interface LoadHooksResult {
	/** Successfully loaded hooks */
	hooks: LoadedHook[];
	/** Errors encountered during loading */
	errors: Array<{ path: string; error: string }>;
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function expandPath(p: string): string {
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
 * - Start with @ (scoped): @scope/package, @scope/package/subpath
 * - Or are bare identifiers: package, package/subpath
 *
 * File paths:
 * - Absolute paths (Unix: /path, Windows: C:\path or C:/path)
 * - Start with ~ (home)
 * - Start with ./ or ../ (relative)
 */
function isNpmPackage(hookPath: string): boolean {
	// File path indicators
	if (
		path.isAbsolute(hookPath) ||
		hookPath.startsWith("~") ||
		hookPath.startsWith("./") ||
		hookPath.startsWith("../")
	) {
		return false;
	}
	// Scoped package or bare identifier
	return true;
}

/**
 * Resolve npm package to absolute path.
 * Uses require.resolve to find the package in node_modules.
 * Returns null if resolution fails.
 */
function resolveNpmPackage(packageSpecifier: string): string | null {
	try {
		// require.resolve finds the package entry point
		return require.resolve(packageSpecifier);
	} catch {
		return null;
	}
}

/**
 * Resolve hook path.
 * - npm packages resolved via require.resolve
 * - Absolute paths used as-is
 * - Paths starting with ~ expanded to home directory
 * - Relative paths resolved from cwd
 */
function resolveHookPath(hookPath: string, cwd: string): string | null {
	// npm package resolution
	if (isNpmPackage(hookPath)) {
		return resolveNpmPackage(hookPath);
	}

	// File path resolution
	const expanded = expandPath(hookPath);

	if (path.isAbsolute(expanded)) {
		return expanded;
	}

	// Relative paths resolved from cwd
	return path.resolve(cwd, expanded);
}

/**
 * Create a HookAPI instance that collects handlers.
 * Returns the API and a function to set the send handler later.
 */
function createHookAPI(handlers: Map<string, HandlerFn[]>): {
	api: HookAPI;
	setSendHandler: (handler: SendHandler) => void;
} {
	let sendHandler: SendHandler = () => {
		// Default no-op until mode sets the handler
	};

	const api: HookAPI = {
		on(event: string, handler: HandlerFn): void {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		send(text: string, attachments?: Attachment[]): void {
			sendHandler(text, attachments);
		},
	} as HookAPI;

	return {
		api,
		setSendHandler: (handler: SendHandler) => {
			sendHandler = handler;
		},
	};
}

/**
 * Load a single hook module using jiti.
 */
async function loadHook(hookPath: string, cwd: string): Promise<{ hook: LoadedHook | null; error: string | null }> {
	const resolvedPath = resolveHookPath(hookPath, cwd);

	if (!resolvedPath) {
		return { hook: null, error: `Could not resolve hook path: ${hookPath}` };
	}

	try {
		// Create jiti instance for TypeScript/ESM loading
		// Use aliases to resolve package imports since hooks are loaded from user directories
		// (e.g. ~/.pi/agent/hooks) but import from packages installed with pi-coding-agent
		const jiti = createJiti(import.meta.url, {
			alias: getAliases(),
		});

		// Import the module
		const module = await jiti.import(resolvedPath, { default: true });
		const factory = module as HookFactory;

		if (typeof factory !== "function") {
			return { hook: null, error: "Hook must export a default function" };
		}

		// Create handlers map and API
		const handlers = new Map<string, HandlerFn[]>();
		const { api, setSendHandler } = createHookAPI(handlers);

		// Call factory to register handlers
		factory(api);

		return {
			hook: { path: hookPath, resolvedPath, handlers, setSendHandler },
			error: null,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { hook: null, error: `Failed to load hook: ${message}` };
	}
}

/**
 * Load all hooks from configuration.
 * @param paths - Array of hook file paths
 * @param cwd - Current working directory for resolving relative paths
 */
export async function loadHooks(paths: string[], cwd: string): Promise<LoadHooksResult> {
	const hooks: LoadedHook[] = [];
	const errors: Array<{ path: string; error: string }> = [];

	for (const hookPath of paths) {
		const { hook, error } = await loadHook(hookPath, cwd);

		if (error) {
			errors.push({ path: hookPath, error });
			continue;
		}

		if (hook) {
			hooks.push(hook);
		}
	}

	return { hooks, errors };
}

/**
 * Discover hook files from a directory.
 * Returns all .ts files (and symlinks to .ts files) in the directory (non-recursive).
 */
function discoverHooksInDir(dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		return entries
			.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".ts"))
			.map((e) => path.join(dir, e.name));
	} catch {
		return [];
	}
}

/**
 * Discover and load hooks from standard locations:
 * 1. agentDir/hooks/*.ts (global)
 * 2. cwd/.pi/hooks/*.ts (project-local)
 *
 * Plus any explicitly configured paths from settings.
 */
export async function discoverAndLoadHooks(
	configuredPaths: string[],
	cwd: string,
	agentDir: string = getAgentDir(),
): Promise<LoadHooksResult> {
	const allPaths: string[] = [];
	const seen = new Set<string>();

	// Helper to add file paths without duplicates (for discovered hooks)
	const addFilePaths = (paths: string[]) => {
		for (const p of paths) {
			const resolved = path.resolve(p);
			if (!seen.has(resolved)) {
				seen.add(resolved);
				allPaths.push(p);
			}
		}
	};

	// 1. Global hooks: agentDir/hooks/
	const globalHooksDir = path.join(agentDir, "hooks");
	addFilePaths(discoverHooksInDir(globalHooksDir));

	// 2. Project-local hooks: cwd/.pi/hooks/
	const localHooksDir = path.join(cwd, ".pi", "hooks");
	addFilePaths(discoverHooksInDir(localHooksDir));

	// 3. Explicitly configured paths (npm packages or file paths)
	for (const p of configuredPaths) {
		if (isNpmPackage(p)) {
			// For npm packages, use specifier as-is for dedup
			if (!seen.has(p)) {
				seen.add(p);
				allPaths.push(p);
			}
		} else {
			// For file paths, resolve and dedup
			const resolved = resolveHookPath(p, cwd);
			if (resolved && !seen.has(resolved)) {
				seen.add(resolved);
				allPaths.push(p);
			}
		}
	}

	return loadHooks(allPaths, cwd);
}
