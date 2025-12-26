/**
 * Custom tool loader - loads TypeScript tool modules using jiti.
 *
 * For Bun compiled binaries, custom tools that import from @mariozechner/* packages
 * are not supported because Bun's plugin system doesn't intercept imports from
 * external files loaded at runtime. Users should use the npm-installed version
 * for custom tools that depend on pi packages.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { getAgentDir, isBunBinary } from "../../config.js";
import type { HookUIContext } from "../hooks/types.js";
import { isNpmPackage, resolvePath } from "../npm-resolve.js";
import type {
	CustomToolFactory,
	CustomToolsLoadResult,
	ExecOptions,
	ExecResult,
	LoadedCustomTool,
	ToolAPI,
} from "./types.js";

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

/**
 * Execute a command and return stdout/stderr/code.
 * Supports cancellation via AbortSignal and timeout.
 */
async function execCommand(command: string, args: string[], cwd: string, options?: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let killed = false;
		let timeoutId: NodeJS.Timeout | undefined;

		const killProcess = () => {
			if (!killed) {
				killed = true;
				proc.kill("SIGTERM");
				// Force kill after 5 seconds if SIGTERM doesn't work
				setTimeout(() => {
					if (!proc.killed) {
						proc.kill("SIGKILL");
					}
				}, 5000);
			}
		};

		// Handle abort signal
		if (options?.signal) {
			if (options.signal.aborted) {
				killProcess();
			} else {
				options.signal.addEventListener("abort", killProcess, { once: true });
			}
		}

		// Handle timeout
		if (options?.timeout && options.timeout > 0) {
			timeoutId = setTimeout(() => {
				killProcess();
			}, options.timeout);
		}

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.signal) {
				options.signal.removeEventListener("abort", killProcess);
			}
			resolve({
				stdout,
				stderr,
				code: code ?? 0,
				killed,
			});
		});

		proc.on("error", (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.signal) {
				options.signal.removeEventListener("abort", killProcess);
			}
			resolve({
				stdout,
				stderr: stderr || err.message,
				code: 1,
				killed,
			});
		});
	});
}

/**
 * Create a no-op UI context for headless modes.
 */
function createNoOpUIContext(): HookUIContext {
	return {
		select: async () => null,
		confirm: async () => false,
		input: async () => null,
		notify: () => {},
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
	sharedApi: ToolAPI,
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
	sharedApi: ToolAPI,
): Promise<{ tools: LoadedCustomTool[] | null; error: string | null }> {
	const resolved = await resolvePath(toolPath, cwd);

	if (resolved.error || !resolved.path) {
		return { tools: null, error: resolved.error ?? `Could not resolve tool path: ${toolPath}` };
	}

	const resolvedPath = resolved.path;

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
	const sharedApi: ToolAPI = {
		cwd,
		exec: (command: string, args: string[], options?: ExecOptions) => execCommand(command, args, cwd, options),
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

	// Helper to add file paths without duplicates (for discovered tools)
	const addFilePaths = (paths: string[]) => {
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
	addFilePaths(discoverToolsInDir(globalToolsDir));

	// 2. Project-local tools: cwd/.pi/tools/
	const localToolsDir = path.join(cwd, ".pi", "tools");
	addFilePaths(discoverToolsInDir(localToolsDir));

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
			const resolved = await resolvePath(p, cwd);
			if (resolved.path && !seen.has(resolved.path)) {
				seen.add(resolved.path);
				allPaths.push(p);
			}
		}
	}

	return loadCustomTools(allPaths, cwd, builtInToolNames);
}
