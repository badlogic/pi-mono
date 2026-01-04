/**
 * Hook loader - loads TypeScript hook modules using jiti.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { KeyId } from "@mariozechner/pi-tui";
import { createJiti } from "jiti";
import { getAgentDir } from "../../config.js";
import { createEventBus, type EventBus } from "../event-bus.js";
import type { HookMessage } from "../messages.js";
import type { SessionManager } from "../session-manager.js";
import { execCommand } from "./runner.js";
import type {
	ExecOptions,
	HookAPI,
	HookContext,
	HookFactory,
	HookMessageRenderer,
	RegisteredCommand,
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
 * Send message handler type for pi.sendMessage().
 */
export type SendMessageHandler = <T = unknown>(
	message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
) => void;

/**
 * Append entry handler type for pi.appendEntry().
 */
export type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void;

/**
 * Get active tools handler type for pi.getActiveTools().
 */
export type GetActiveToolsHandler = () => string[];

/**
 * Get all tools handler type for pi.getAllTools().
 */
export type GetAllToolsHandler = () => string[];

/**
 * Set active tools handler type for pi.setActiveTools().
 */
export type SetActiveToolsHandler = (toolNames: string[]) => void;

/**
 * CLI flag definition registered by a hook.
 */
export interface HookFlag {
	/** Flag name (without --) */
	name: string;
	/** Description for --help */
	description?: string;
	/** Type: boolean or string */
	type: "boolean" | "string";
	/** Default value */
	default?: boolean | string;
	/** Hook path that registered this flag */
	hookPath: string;
}

/**
 * Keyboard shortcut registered by a hook.
 */
export interface HookShortcut {
	/** Key identifier (e.g., Key.shift("p"), "ctrl+x") */
	shortcut: KeyId;
	/** Description for help */
	description?: string;
	/** Handler function */
	handler: (ctx: HookContext) => Promise<void> | void;
	/** Hook path that registered this shortcut */
	hookPath: string;
}

/**
 * New session handler type for ctx.newSession() in HookCommandContext.
 */
export type NewSessionHandler = (options?: {
	parentSession?: string;
	setup?: (sessionManager: SessionManager) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

/**
 * Branch handler type for ctx.branch() in HookCommandContext.
 */
export type BranchHandler = (entryId: string) => Promise<{ cancelled: boolean }>;

/**
 * Navigate tree handler type for ctx.navigateTree() in HookCommandContext.
 */
export type NavigateTreeHandler = (
	targetId: string,
	options?: { summarize?: boolean },
) => Promise<{ cancelled: boolean }>;

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
	/** Map of customType to hook message renderer */
	messageRenderers: Map<string, HookMessageRenderer>;
	/** Map of command name to registered command */
	commands: Map<string, RegisteredCommand>;
	/** CLI flags registered by this hook */
	flags: Map<string, HookFlag>;
	/** Flag values (set after CLI parsing) */
	flagValues: Map<string, boolean | string>;
	/** Keyboard shortcuts registered by this hook */
	shortcuts: Map<KeyId, HookShortcut>;
	/** Set the send message handler for this hook's pi.sendMessage() */
	setSendMessageHandler: (handler: SendMessageHandler) => void;
	/** Set the append entry handler for this hook's pi.appendEntry() */
	setAppendEntryHandler: (handler: AppendEntryHandler) => void;
	/** Set the get active tools handler for this hook's pi.getActiveTools() */
	setGetActiveToolsHandler: (handler: GetActiveToolsHandler) => void;
	/** Set the get all tools handler for this hook's pi.getAllTools() */
	setGetAllToolsHandler: (handler: GetAllToolsHandler) => void;
	/** Set the set active tools handler for this hook's pi.setActiveTools() */
	setSetActiveToolsHandler: (handler: SetActiveToolsHandler) => void;
	/** Set a flag value (called after CLI parsing) */
	setFlagValue: (name: string, value: boolean | string) => void;
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
 * Create a HookAPI instance that collects handlers, renderers, and commands.
 * Returns the API, maps, and functions to set handlers later.
 */
function createHookAPI(
	handlers: Map<string, HandlerFn[]>,
	cwd: string,
	hookPath: string,
	eventBus: EventBus,
): {
	api: HookAPI;
	messageRenderers: Map<string, HookMessageRenderer>;
	commands: Map<string, RegisteredCommand>;
	flags: Map<string, HookFlag>;
	flagValues: Map<string, boolean | string>;
	shortcuts: Map<KeyId, HookShortcut>;
	setSendMessageHandler: (handler: SendMessageHandler) => void;
	setAppendEntryHandler: (handler: AppendEntryHandler) => void;
	setGetActiveToolsHandler: (handler: GetActiveToolsHandler) => void;
	setGetAllToolsHandler: (handler: GetAllToolsHandler) => void;
	setSetActiveToolsHandler: (handler: SetActiveToolsHandler) => void;
	setFlagValue: (name: string, value: boolean | string) => void;
} {
	let sendMessageHandler: SendMessageHandler = () => {
		// Default no-op until mode sets the handler
	};
	let appendEntryHandler: AppendEntryHandler = () => {
		// Default no-op until mode sets the handler
	};
	let getActiveToolsHandler: GetActiveToolsHandler = () => [];
	let getAllToolsHandler: GetAllToolsHandler = () => [];
	let setActiveToolsHandler: SetActiveToolsHandler = () => {
		// Default no-op until mode sets the handler
	};
	const messageRenderers = new Map<string, HookMessageRenderer>();
	const commands = new Map<string, RegisteredCommand>();
	const flags = new Map<string, HookFlag>();
	const flagValues = new Map<string, boolean | string>();
	const shortcuts = new Map<KeyId, HookShortcut>();

	// Cast to HookAPI - the implementation is more general (string event names)
	// but the interface has specific overloads for type safety in hooks
	const api = {
		on(event: string, handler: HandlerFn): void {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		sendMessage<T = unknown>(
			message: HookMessage<T>,
			options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" },
		): void {
			sendMessageHandler(message, options);
		},
		appendEntry<T = unknown>(customType: string, data?: T): void {
			appendEntryHandler(customType, data);
		},
		registerMessageRenderer<T = unknown>(customType: string, renderer: HookMessageRenderer<T>): void {
			messageRenderers.set(customType, renderer as HookMessageRenderer);
		},
		registerCommand(name: string, options: { description?: string; handler: RegisteredCommand["handler"] }): void {
			commands.set(name, { name, ...options });
		},
		exec(command: string, args: string[], options?: ExecOptions) {
			return execCommand(command, args, options?.cwd ?? cwd, options);
		},
		getActiveTools(): string[] {
			return getActiveToolsHandler();
		},
		getAllTools(): string[] {
			return getAllToolsHandler();
		},
		setActiveTools(toolNames: string[]): void {
			setActiveToolsHandler(toolNames);
		},
		registerFlag(
			name: string,
			options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
		): void {
			flags.set(name, { name, hookPath, ...options });
			if (options.default !== undefined) {
				flagValues.set(name, options.default);
			}
		},
		getFlag(name: string): boolean | string | undefined {
			return flagValues.get(name);
		},
		registerShortcut(
			shortcut: KeyId,
			options: {
				description?: string;
				handler: (ctx: HookContext) => Promise<void> | void;
			},
		): void {
			shortcuts.set(shortcut, { shortcut, hookPath, ...options });
		},
		events: eventBus,
	} as HookAPI;

	return {
		api,
		messageRenderers,
		commands,
		flags,
		flagValues,
		shortcuts,
		setSendMessageHandler: (handler: SendMessageHandler) => {
			sendMessageHandler = handler;
		},
		setAppendEntryHandler: (handler: AppendEntryHandler) => {
			appendEntryHandler = handler;
		},
		setGetActiveToolsHandler: (handler: GetActiveToolsHandler) => {
			getActiveToolsHandler = handler;
		},
		setGetAllToolsHandler: (handler: GetAllToolsHandler) => {
			getAllToolsHandler = handler;
		},
		setSetActiveToolsHandler: (handler: SetActiveToolsHandler) => {
			setActiveToolsHandler = handler;
		},
		setFlagValue: (name: string, value: boolean | string) => {
			flagValues.set(name, value);
		},
	};
}

/**
 * Load a single hook module using jiti.
 */
async function loadHook(
	hookPath: string,
	cwd: string,
	eventBus: EventBus,
): Promise<{ hook: LoadedHook | null; error: string | null }> {
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
		const {
			api,
			messageRenderers,
			commands,
			flags,
			flagValues,
			shortcuts,
			setSendMessageHandler,
			setAppendEntryHandler,
			setGetActiveToolsHandler,
			setGetAllToolsHandler,
			setSetActiveToolsHandler,
			setFlagValue,
		} = createHookAPI(handlers, cwd, hookPath, eventBus);

		// Call factory to register handlers
		factory(api);

		return {
			hook: {
				path: hookPath,
				resolvedPath,
				handlers,
				messageRenderers,
				commands,
				flags,
				flagValues,
				shortcuts,
				setSendMessageHandler,
				setAppendEntryHandler,
				setGetActiveToolsHandler,
				setGetAllToolsHandler,
				setSetActiveToolsHandler,
				setFlagValue,
			},
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
 * @param eventBus - Optional shared event bus (creates isolated bus if not provided)
 */
export async function loadHooks(paths: string[], cwd: string, eventBus?: EventBus): Promise<LoadHooksResult> {
	const hooks: LoadedHook[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const resolvedEventBus = eventBus ?? createEventBus();

	for (const hookPath of paths) {
		const { hook, error } = await loadHook(hookPath, cwd, resolvedEventBus);

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
 *
 * @param configuredPaths - Explicitly configured hook paths
 * @param cwd - Current working directory
 * @param agentDir - Agent configuration directory
 * @param eventBus - Optional shared event bus (creates isolated bus if not provided)
 */
export async function discoverAndLoadHooks(
	configuredPaths: string[],
	cwd: string,
	agentDir: string = getAgentDir(),
	eventBus?: EventBus,
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

	return loadHooks(allPaths, cwd, eventBus);
}
