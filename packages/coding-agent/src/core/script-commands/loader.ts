/**
 * Script command loader - loads TypeScript command modules using jiti.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { CONFIG_DIR_NAME, getAgentDir, getCommandsDir, isBunBinary } from "../../config.js";
import type { ToolAPI, ToolUIContext } from "../custom-tools/types.js";
import type { LoadedScriptCommand, ScriptCommand, ScriptCommandFactory, ScriptCommandsLoadResult } from "./types.js";

// Create require function to resolve module paths at runtime
const require = createRequire(import.meta.url);

// Lazily computed aliases - resolved at runtime to handle global installs
let _aliases: Record<string, string> | null = null;
function getAliases(): Record<string, string> {
	if (_aliases) return _aliases;

	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packageIndex = path.resolve(__dirname, "../..", "index.js");

	// For typebox, we need the package root directory
	let typeboxDir: string;
	try {
		const typeboxMain = require.resolve("@sinclair/typebox");
		typeboxDir = path.dirname(typeboxMain);
		while (!fs.existsSync(path.join(typeboxDir, "package.json"))) {
			const parent = path.dirname(typeboxDir);
			if (parent === typeboxDir) break;
			typeboxDir = parent;
		}
	} catch {
		typeboxDir = "";
	}

	let piAiDir: string;
	try {
		piAiDir = path.dirname(require.resolve("@mariozechner/pi-ai"));
	} catch {
		piAiDir = "";
	}

	let piTuiDir: string;
	try {
		piTuiDir = path.dirname(require.resolve("@mariozechner/pi-tui"));
	} catch {
		piTuiDir = "";
	}

	_aliases = {
		"@mariozechner/pi-coding-agent": packageIndex,
		...(typeboxDir && { "@sinclair/typebox": typeboxDir }),
		...(piAiDir && { "@mariozechner/pi-ai": piAiDir }),
		...(piTuiDir && { "@mariozechner/pi-tui": piTuiDir }),
	};

	return _aliases;
}

/** Create a no-op API for initial loading */
function createNoOpAPI(): ToolAPI {
	return {
		cwd: process.cwd(),
		exec: async () => {
			throw new Error("exec() not available - API not initialized");
		},
		ui: createNoOpUIContext(),
		hasUI: false,
		getLastAssistantText: () => null,
		setEditorText: () => {},
		getEditorText: () => "",
		complete: async () => {
			throw new Error("complete() not available - API not initialized");
		},
		showStatus: () => {},
		showError: () => {},
		copyToClipboard: () => {},
	};
}

function createNoOpUIContext(): ToolUIContext {
	return {
		select: async () => null,
		confirm: async () => false,
		input: async () => null,
		notify: () => {},
	};
}

/**
 * Load a single script command from a .ts file.
 */
async function loadScriptCommand(
	filePath: string,
	cwd: string,
	api: ToolAPI,
	source: "user" | "project",
): Promise<{ command: LoadedScriptCommand | null; error: string | null }> {
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

	if (!fs.existsSync(absolutePath)) {
		return { command: null, error: `File not found: ${absolutePath}` };
	}

	// Check for Bun binary limitation
	if (isBunBinary) {
		return {
			command: null,
			error: "Script commands are not supported in compiled binaries. Use npm-installed version.",
		};
	}

	try {
		const jiti = createJiti(absolutePath, {
			debug: false,
			cache: false,
			requireCache: false,
			moduleCache: false,
			alias: getAliases(),
			extensions: [".ts", ".js", ".mts", ".mjs", ".cts", ".cjs"],
		});

		const module = await jiti.import(absolutePath);
		const factory = (module as { default?: ScriptCommandFactory }).default;

		if (typeof factory !== "function") {
			return { command: null, error: "Module must export a default function" };
		}

		const scriptCommand: ScriptCommand = await factory(api);

		if (!scriptCommand.description || typeof scriptCommand.execute !== "function") {
			return { command: null, error: "Command must have description and execute function" };
		}

		const name = path.basename(filePath, path.extname(filePath));
		const sourceStr = source === "user" ? "(user)" : "(project)";

		return {
			command: {
				name,
				description: `${scriptCommand.description} ${sourceStr}`,
				source: sourceStr,
				execute: scriptCommand.execute,
				path: absolutePath,
			},
			error: null,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { command: null, error: message };
	}
}

/**
 * Discover and load script commands from a directory.
 * Only loads .ts files directly in the directory (not subdirectories).
 */
function discoverScriptCommandsInDir(dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}

	const files: string[] = [];
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".ts")) {
				files.push(path.join(dir, entry.name));
			}
		}
	} catch {
		// Silently skip directories that can't be read
	}

	return files;
}

/**
 * Discover and load all script commands.
 * Searches:
 * 1. Global: ~/.pi/agent/commands/*.ts
 * 2. Project: .pi/commands/*.ts
 */
export async function discoverAndLoadScriptCommands(
	cwd: string = process.cwd(),
	_agentDir: string = getAgentDir(),
): Promise<ScriptCommandsLoadResult> {
	const commands: LoadedScriptCommand[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const seenNames = new Set<string>();

	// Shared API that will be updated when mode initializes
	let sharedAPI = createNoOpAPI();
	sharedAPI.cwd = cwd;

	// Wrapper API that delegates to sharedAPI (so commands get updated API)
	const apiWrapper: ToolAPI = {
		get cwd() {
			return sharedAPI.cwd;
		},
		exec: (command, args, options) => sharedAPI.exec(command, args, options),
		get ui() {
			return sharedAPI.ui;
		},
		get hasUI() {
			return sharedAPI.hasUI;
		},
		getLastAssistantText: () => sharedAPI.getLastAssistantText(),
		setEditorText: (text) => sharedAPI.setEditorText(text),
		getEditorText: () => sharedAPI.getEditorText(),
		complete: (prompt, options) => sharedAPI.complete(prompt, options),
		showStatus: (msg) => sharedAPI.showStatus(msg),
		showError: (msg) => sharedAPI.showError(msg),
		copyToClipboard: (text) => sharedAPI.copyToClipboard(text),
	};

	// 1. Load global commands
	const globalCommandsDir = getCommandsDir();
	const globalFiles = discoverScriptCommandsInDir(globalCommandsDir);
	for (const filePath of globalFiles) {
		const { command, error } = await loadScriptCommand(filePath, cwd, apiWrapper, "user");
		if (error) {
			errors.push({ path: filePath, error });
		} else if (command) {
			if (seenNames.has(command.name)) {
				errors.push({ path: filePath, error: `Command name "${command.name}" conflicts with existing command` });
			} else {
				seenNames.add(command.name);
				commands.push(command);
			}
		}
	}

	// 2. Load project commands (override global)
	const projectCommandsDir = path.resolve(cwd, CONFIG_DIR_NAME, "commands");
	const projectFiles = discoverScriptCommandsInDir(projectCommandsDir);
	for (const filePath of projectFiles) {
		const { command, error } = await loadScriptCommand(filePath, cwd, apiWrapper, "project");
		if (error) {
			errors.push({ path: filePath, error });
		} else if (command) {
			// Project commands can override global ones
			const existingIndex = commands.findIndex((c) => c.name === command.name);
			if (existingIndex >= 0) {
				commands[existingIndex] = command;
			} else {
				seenNames.add(command.name);
				commands.push(command);
			}
		}
	}

	return {
		commands,
		errors,
		setAPI(api: ToolAPI) {
			sharedAPI = api;
		},
	};
}
