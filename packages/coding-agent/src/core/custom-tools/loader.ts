/**
 * Custom tool loader - loads TypeScript tool modules using jiti.
 *
 * For Bun compiled binaries, custom tools that import from @mariozechner/* packages
 * are not supported because Bun's plugin system doesn't intercept imports from
 * external files loaded at runtime. Users should use the npm-installed version
 * for custom tools that depend on pi packages.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { getAgentDir, isBunBinary } from "../../config.js";
import { theme } from "../../modes/interactive/theme/theme.js";
import type { ExecOptions } from "../exec.js";
import { execCommand } from "../exec.js";
import type { HookUIContext } from "../hooks/types.js";
import type { CustomToolAPI, CustomToolFactory, CustomToolsLoadResult, LoadedCustomTool } from "./types.js";

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
		"@mariozechner/pi-tui": require.resolve("@mariozechner/pi-tui"),
		"@mariozechner/pi-ai": require.resolve("@mariozechner/pi-ai"),
		"@sinclair/typebox": typeboxRoot,
	};
	return _aliases;
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
 * Resolve tool path.
 * - Absolute paths used as-is
 * - Paths starting with ~ expanded to home directory
 * - Relative paths resolved from cwd
 */
function resolveToolPath(toolPath: string, cwd: string): string {
	const expanded = expandPath(toolPath);

	if (path.isAbsolute(expanded)) {
		return expanded;
	}

	// Relative paths resolved from cwd
	return path.resolve(cwd, expanded);
}

/**
 * Create a no-op UI context for headless modes.
 */
function createNoOpUIContext(): HookUIContext {
	return {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		notify: () => {},
		setStatus: () => {},
		custom: async () => undefined as never,
		setEditorText: () => {},
		getEditorText: () => "",
		get theme() {
			return theme;
		},
	};
}

/**
 * Load a tool in Bun binary mode.
 *
 * Since Bun plugins don't work for dynamically loaded external files,
 * custom tools that import from @mariozechner/* packages won't work.
 * Tools that only use standard npm packages (installed in the tool's directory)
 * may still work.
 */
async function loadToolWithBun(
	resolvedPath: string,
	sharedApi: CustomToolAPI,
): Promise<{ tools: LoadedCustomTool[] | null; error: string | null }> {
	try {
		// Try to import directly - will work for tools without @mariozechner/* imports
		const module = await import(resolvedPath);
		const factory = (module.default ?? module) as CustomToolFactory;

		if (typeof factory !== "function") {
			return { tools: null, error: "Tool must export a default function" };
		}

		const toolResult = await factory(sharedApi);
		const toolsArray = Array.isArray(toolResult) ? toolResult : [toolResult];

		const loadedTools: LoadedCustomTool[] = toolsArray.map((tool) => ({
			path: resolvedPath,
			resolvedPath,
			tool,
		}));

		return { tools: loadedTools, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		// Check if it's a module resolution error for our packages
		if (message.includes("Cannot find module") && message.includes("@mariozechner/")) {
			return {
				tools: null,
				error:
					`${message}\n` +
					"Note: Custom tools importing from @mariozechner/* packages are not supported in the standalone binary.\n" +
					"Please install pi via npm: npm install -g @mariozechner/pi-coding-agent",
			};
		}

		return { tools: null, error: `Failed to load tool: ${message}` };
	}
}

/**
 * Load a single tool module using jiti (or Bun.build for compiled binaries).
 */
async function loadTool(
	toolPath: string,
	cwd: string,
	sharedApi: CustomToolAPI,
): Promise<{ tools: LoadedCustomTool[] | null; error: string | null }> {
	const resolvedPath = resolveToolPath(toolPath, cwd);

	// Use Bun.build for compiled binaries since jiti can't resolve bundled modules
	if (isBunBinary) {
		return loadToolWithBun(resolvedPath, sharedApi);
	}

	try {
		// Create jiti instance for TypeScript/ESM loading
		// Use aliases to resolve package imports since tools are loaded from user directories
		// (e.g. ~/.pi/agent/tools) but import from packages installed with pi-coding-agent
		const jiti = createJiti(import.meta.url, {
			alias: getAliases(),
		});

		// Import the module
		const module = await jiti.import(resolvedPath, { default: true });
		const factory = module as CustomToolFactory;

		if (typeof factory !== "function") {
			return { tools: null, error: "Tool must export a default function" };
		}

		// Call factory with shared API
		const result = await factory(sharedApi);

		// Handle single tool or array of tools
		const toolsArray = Array.isArray(result) ? result : [result];

		const loadedTools: LoadedCustomTool[] = toolsArray.map((tool) => ({
			path: toolPath,
			resolvedPath,
			tool,
		}));

		return { tools: loadedTools, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { tools: null, error: `Failed to load tool: ${message}` };
	}
}

/**
 * Load all tools from configuration.
 * @param paths - Array of tool file paths
 * @param cwd - Current working directory for resolving relative paths
 * @param builtInToolNames - Names of built-in tools to check for conflicts
 */
export async function loadCustomTools(
	paths: string[],
	cwd: string,
	builtInToolNames: string[],
): Promise<CustomToolsLoadResult> {
	const tools: LoadedCustomTool[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const seenNames = new Set<string>(builtInToolNames);

	// Shared API object - all tools get the same instance
	const sharedApi: CustomToolAPI = {
		cwd,
		exec: (command: string, args: string[], options?: ExecOptions) =>
			execCommand(command, args, options?.cwd ?? cwd, options),
		ui: createNoOpUIContext(),
		hasUI: false,
	};

	for (const toolPath of paths) {
		const { tools: loadedTools, error } = await loadTool(toolPath, cwd, sharedApi);

		if (error) {
			errors.push({ path: toolPath, error });
			continue;
		}

		if (loadedTools) {
			for (const loadedTool of loadedTools) {
				// Check for name conflicts
				if (seenNames.has(loadedTool.tool.name)) {
					errors.push({
						path: toolPath,
						error: `Tool name "${loadedTool.tool.name}" conflicts with existing tool`,
					});
					continue;
				}

				seenNames.add(loadedTool.tool.name);
				tools.push(loadedTool);
			}
		}
	}

	return {
		tools,
		errors,
		setUIContext(uiContext, hasUI) {
			sharedApi.ui = uiContext;
			sharedApi.hasUI = hasUI;
		},
	};
}

/**
 * Discover tool files from a directory.
 * Only loads index.ts files from subdirectories (e.g., tools/mytool/index.ts).
 */
function discoverToolsInDir(dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}

	const tools: string[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				// Check for index.ts in subdirectory
				const indexPath = path.join(dir, entry.name, "index.ts");
				if (fs.existsSync(indexPath)) {
					tools.push(indexPath);
				}
			}
		}
	} catch {
		return [];
	}

	return tools;
}

/**
 * Discover and load tools from standard locations:
 * 1. agentDir/tools/*.ts (global)
 * 2. cwd/.pi/tools/*.ts (project-local)
 *
 * Plus any explicitly configured paths from settings or CLI.
 *
 * @param configuredPaths - Explicit paths from settings.json and CLI --tool flags
 * @param cwd - Current working directory
 * @param builtInToolNames - Names of built-in tools to check for conflicts
 * @param agentDir - Agent config directory. Default: from getAgentDir()
 */
export async function discoverAndLoadCustomTools(
	configuredPaths: string[],
	cwd: string,
	builtInToolNames: string[],
	agentDir: string = getAgentDir(),
): Promise<CustomToolsLoadResult> {
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

	// 1. Global tools: agentDir/tools/
	const globalToolsDir = path.join(agentDir, "tools");
	addPaths(discoverToolsInDir(globalToolsDir));

	// 2. Project-local tools: cwd/.pi/tools/
	const localToolsDir = path.join(cwd, ".pi", "tools");
	addPaths(discoverToolsInDir(localToolsDir));

	// 3. Explicitly configured paths (can override/add)
	addPaths(configuredPaths.map((p) => resolveToolPath(p, cwd)));

	return loadCustomTools(allPaths, cwd, builtInToolNames);
}
