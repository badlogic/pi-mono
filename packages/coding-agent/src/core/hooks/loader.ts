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
 * Resolve hook path.
 * - Absolute paths used as-is
 * - Paths starting with ~ expanded to home directory
 * - Relative paths resolved from cwd
 */
function resolveHookPath(hookPath: string, cwd: string): string {
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

	// Helper to add paths without duplicates
	const addPaths = (paths: string[]) => {
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
	addPaths(discoverHooksInDir(globalHooksDir));

	// 2. Project-local hooks: cwd/.pi/hooks/
	const localHooksDir = path.join(cwd, ".pi", "hooks");
	addPaths(discoverHooksInDir(localHooksDir));

	// 3. Explicitly configured paths (can override/add)
	addPaths(configuredPaths.map((p) => resolveHookPath(p, cwd)));

	return loadHooks(allPaths, cwd);
}
