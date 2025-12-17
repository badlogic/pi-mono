/**
 * Custom tool loader - loads TypeScript tool modules using jiti.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createJiti } from "jiti";
import { getAgentDir } from "../../config.js";
import type { HookUIContext } from "../hooks/types.js";
import type { CustomToolFactory, CustomToolsLoadResult, ExecResult, LoadedCustomTool, ToolAPI } from "./types.js";

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
 * Execute a command and return stdout/stderr/code.
 */
async function execCommand(command: string, args: string[], cwd: string): Promise<ExecResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			resolve({
				stdout,
				stderr,
				code: code ?? 0,
			});
		});

		proc.on("error", (err) => {
			resolve({
				stdout,
				stderr: stderr || err.message,
				code: 1,
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
 * Load a single tool module using jiti.
 */
async function loadTool(
	toolPath: string,
	cwd: string,
	sharedApi: ToolAPI,
): Promise<{ tools: LoadedCustomTool[] | null; error: string | null }> {
	const resolvedPath = resolveToolPath(toolPath, cwd);

	try {
		// Create jiti instance for TypeScript/ESM loading
		const jiti = createJiti(import.meta.url);

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
		exec: (command: string, args: string[]) => execCommand(command, args, cwd),
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
 * Returns all .ts files in the directory (non-recursive).
 */
function discoverToolsInDir(dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		return entries.filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => path.join(dir, e.name));
	} catch {
		return [];
	}
}

/**
 * Discover and load tools from standard locations:
 * 1. ~/.pi/agent/tools/*.ts (global)
 * 2. cwd/.pi/tools/*.ts (project-local)
 *
 * Plus any explicitly configured paths from settings or CLI.
 *
 * @param configuredPaths - Explicit paths from settings.json and CLI --tool flags
 * @param cwd - Current working directory
 * @param builtInToolNames - Names of built-in tools to check for conflicts
 */
export async function discoverAndLoadCustomTools(
	configuredPaths: string[],
	cwd: string,
	builtInToolNames: string[],
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

	// 1. Global tools: ~/.pi/agent/tools/
	const globalToolsDir = path.join(getAgentDir(), "tools");
	addPaths(discoverToolsInDir(globalToolsDir));

	// 2. Project-local tools: cwd/.pi/tools/
	const localToolsDir = path.join(cwd, ".pi", "tools");
	addPaths(discoverToolsInDir(localToolsDir));

	// 3. Explicitly configured paths (can override/add)
	addPaths(configuredPaths.map((p) => resolveToolPath(p, cwd)));

	return loadCustomTools(allPaths, cwd, builtInToolNames);
}
