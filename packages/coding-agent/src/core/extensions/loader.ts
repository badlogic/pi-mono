/**
 * Extension loader - loads TypeScript extension modules using jiti.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { KeyId } from "@mariozechner/pi-tui";
import { createJiti } from "jiti";
import { getAgentDir, isBunBinary } from "../../config.js";
import { theme } from "../../modes/interactive/theme/theme.js";
import { createEventBus, type EventBus } from "../event-bus.js";
import type { ExecOptions } from "../exec.js";
import { execCommand } from "../exec.js";
import type {
	AppendEntryHandler,
	ExtensionAPI,
	ExtensionFactory,
	ExtensionFlag,
	ExtensionShortcut,
	ExtensionUIContext,
	GetActiveToolsHandler,
	GetAllToolsHandler,
	GetThinkingLevelHandler,
	LoadExtensionsResult,
	LoadedExtension,
	MessageRenderer,
	RegisteredCommand,
	RegisteredTool,
	SendMessageHandler,
	SendUserMessageHandler,
	SetActiveToolsHandler,
	SetModelHandler,
	SetThinkingLevelHandler,
	ToolDefinition,
} from "./types.js";

const require = createRequire(import.meta.url);

let _aliases: Record<string, string> | null = null;
function getAliases(): Record<string, string> {
	if (_aliases) return _aliases;

	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packageIndex = path.resolve(__dirname, "../..", "index.js");

	const typeboxEntry = require.resolve("@sinclair/typebox");
	const typeboxRoot = typeboxEntry.replace(/\/build\/cjs\/index\.js$/, "");

	_aliases = {
		"@mariozechner/pi-coding-agent": packageIndex,
		"@mariozechner/pi-coding-agent/extensions": path.resolve(__dirname, "index.js"),
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

function resolvePath(extPath: string, cwd: string): string {
	const expanded = expandPath(extPath);
	if (path.isAbsolute(expanded)) {
		return expanded;
	}
	return path.resolve(cwd, expanded);
}

function createNoOpUIContext(): ExtensionUIContext {
	return {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		notify: () => {},
		setStatus: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		get theme() {
			return theme;
		},
	};
}

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

function createExtensionAPI(
	handlers: Map<string, HandlerFn[]>,
	tools: Map<string, RegisteredTool>,
	cwd: string,
	extensionPath: string,
	eventBus: EventBus,
	_sharedUI: { ui: ExtensionUIContext; hasUI: boolean },
): {
	api: ExtensionAPI;
	messageRenderers: Map<string, MessageRenderer>;
	commands: Map<string, RegisteredCommand>;
	flags: Map<string, ExtensionFlag>;
	flagValues: Map<string, boolean | string>;
	shortcuts: Map<KeyId, ExtensionShortcut>;
	setSendMessageHandler: (handler: SendMessageHandler) => void;
	setSendUserMessageHandler: (handler: SendUserMessageHandler) => void;
	setAppendEntryHandler: (handler: AppendEntryHandler) => void;
	setGetActiveToolsHandler: (handler: GetActiveToolsHandler) => void;
	setGetAllToolsHandler: (handler: GetAllToolsHandler) => void;
	setSetActiveToolsHandler: (handler: SetActiveToolsHandler) => void;
	setSetModelHandler: (handler: SetModelHandler) => void;
	setGetThinkingLevelHandler: (handler: GetThinkingLevelHandler) => void;
	setSetThinkingLevelHandler: (handler: SetThinkingLevelHandler) => void;
	setFlagValue: (name: string, value: boolean | string) => void;
} {
	let sendMessageHandler: SendMessageHandler = () => {};
	let sendUserMessageHandler: SendUserMessageHandler = () => {};
	let appendEntryHandler: AppendEntryHandler = () => {};
	let getActiveToolsHandler: GetActiveToolsHandler = () => [];
	let getAllToolsHandler: GetAllToolsHandler = () => [];
	let setActiveToolsHandler: SetActiveToolsHandler = () => {};
	let setModelHandler: SetModelHandler = async () => false;
	let getThinkingLevelHandler: GetThinkingLevelHandler = () => "off";
	let setThinkingLevelHandler: SetThinkingLevelHandler = () => {};

	const messageRenderers = new Map<string, MessageRenderer>();
	const commands = new Map<string, RegisteredCommand>();
	const flags = new Map<string, ExtensionFlag>();
	const flagValues = new Map<string, boolean | string>();
	const shortcuts = new Map<KeyId, ExtensionShortcut>();

	const api = {
		on(event: string, handler: HandlerFn): void {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},

		registerTool(tool: ToolDefinition): void {
			tools.set(tool.name, {
				definition: tool,
				extensionPath,
			});
		},

		registerCommand(name: string, options: { description?: string; handler: RegisteredCommand["handler"] }): void {
			commands.set(name, { name, ...options });
		},

		registerShortcut(
			shortcut: KeyId,
			options: {
				description?: string;
				handler: (ctx: import("./types.js").ExtensionContext) => Promise<void> | void;
			},
		): void {
			shortcuts.set(shortcut, { shortcut, extensionPath, ...options });
		},

		registerFlag(
			name: string,
			options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
		): void {
			flags.set(name, { name, extensionPath, ...options });
			if (options.default !== undefined) {
				flagValues.set(name, options.default);
			}
		},

		getFlag(name: string): boolean | string | undefined {
			return flagValues.get(name);
		},

		registerMessageRenderer<T>(customType: string, renderer: MessageRenderer<T>): void {
			messageRenderers.set(customType, renderer as MessageRenderer);
		},

		sendMessage(message, options): void {
			sendMessageHandler(message, options);
		},

		sendUserMessage(content, options): void {
			sendUserMessageHandler(content, options);
		},

		appendEntry(customType: string, data?: unknown): void {
			appendEntryHandler(customType, data);
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

		setModel(model) {
			return setModelHandler(model);
		},

		getThinkingLevel() {
			return getThinkingLevelHandler();
		},

		setThinkingLevel(level) {
			setThinkingLevelHandler(level);
		},

		events: eventBus,
	} as ExtensionAPI;

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
		setSendUserMessageHandler: (handler: SendUserMessageHandler) => {
			sendUserMessageHandler = handler;
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
		setSetModelHandler: (handler: SetModelHandler) => {
			setModelHandler = handler;
		},
		setGetThinkingLevelHandler: (handler: GetThinkingLevelHandler) => {
			getThinkingLevelHandler = handler;
		},
		setSetThinkingLevelHandler: (handler: SetThinkingLevelHandler) => {
			setThinkingLevelHandler = handler;
		},
		setFlagValue: (name: string, value: boolean | string) => {
			flagValues.set(name, value);
		},
	};
}

async function loadExtensionWithBun(
	resolvedPath: string,
	cwd: string,
	extensionPath: string,
	eventBus: EventBus,
	sharedUI: { ui: ExtensionUIContext; hasUI: boolean },
): Promise<{ extension: LoadedExtension | null; error: string | null }> {
	try {
		const module = await import(resolvedPath);
		const factory = (module.default ?? module) as ExtensionFactory;

		if (typeof factory !== "function") {
			return { extension: null, error: "Extension must export a default function" };
		}

		const handlers = new Map<string, HandlerFn[]>();
		const tools = new Map<string, RegisteredTool>();
		const {
			api,
			messageRenderers,
			commands,
			flags,
			flagValues,
			shortcuts,
			setSendMessageHandler,
			setSendUserMessageHandler,
			setAppendEntryHandler,
			setGetActiveToolsHandler,
			setGetAllToolsHandler,
			setSetActiveToolsHandler,
			setSetModelHandler,
			setGetThinkingLevelHandler,
			setSetThinkingLevelHandler,
			setFlagValue,
		} = createExtensionAPI(handlers, tools, cwd, extensionPath, eventBus, sharedUI);

		await factory(api);

		return {
			extension: {
				path: extensionPath,
				resolvedPath,
				handlers,
				tools,
				messageRenderers,
				commands,
				flags,
				flagValues,
				shortcuts,
				setSendMessageHandler,
				setSendUserMessageHandler,
				setAppendEntryHandler,
				setGetActiveToolsHandler,
				setGetAllToolsHandler,
				setSetActiveToolsHandler,
				setSetModelHandler,
				setGetThinkingLevelHandler,
				setSetThinkingLevelHandler,
				setFlagValue,
			},
			error: null,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		if (message.includes("Cannot find module") && message.includes("@mariozechner/")) {
			return {
				extension: null,
				error:
					`${message}\n` +
					"Note: Extensions importing from @mariozechner/* packages are not supported in the standalone binary.\n" +
					"Please install pi via npm: npm install -g @mariozechner/pi-coding-agent",
			};
		}

		return { extension: null, error: `Failed to load extension: ${message}` };
	}
}

async function loadExtension(
	extensionPath: string,
	cwd: string,
	eventBus: EventBus,
	sharedUI: { ui: ExtensionUIContext; hasUI: boolean },
): Promise<{ extension: LoadedExtension | null; error: string | null }> {
	const resolvedPath = resolvePath(extensionPath, cwd);

	if (isBunBinary) {
		return loadExtensionWithBun(resolvedPath, cwd, extensionPath, eventBus, sharedUI);
	}

	try {
		const jiti = createJiti(import.meta.url, {
			alias: getAliases(),
		});

		const module = await jiti.import(resolvedPath, { default: true });
		const factory = module as ExtensionFactory;

		if (typeof factory !== "function") {
			return { extension: null, error: "Extension must export a default function" };
		}

		const handlers = new Map<string, HandlerFn[]>();
		const tools = new Map<string, RegisteredTool>();
		const {
			api,
			messageRenderers,
			commands,
			flags,
			flagValues,
			shortcuts,
			setSendMessageHandler,
			setSendUserMessageHandler,
			setAppendEntryHandler,
			setGetActiveToolsHandler,
			setGetAllToolsHandler,
			setSetActiveToolsHandler,
			setSetModelHandler,
			setGetThinkingLevelHandler,
			setSetThinkingLevelHandler,
			setFlagValue,
		} = createExtensionAPI(handlers, tools, cwd, extensionPath, eventBus, sharedUI);

		await factory(api);

		return {
			extension: {
				path: extensionPath,
				resolvedPath,
				handlers,
				tools,
				messageRenderers,
				commands,
				flags,
				flagValues,
				shortcuts,
				setSendMessageHandler,
				setSendUserMessageHandler,
				setAppendEntryHandler,
				setGetActiveToolsHandler,
				setGetAllToolsHandler,
				setSetActiveToolsHandler,
				setSetModelHandler,
				setGetThinkingLevelHandler,
				setSetThinkingLevelHandler,
				setFlagValue,
			},
			error: null,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { extension: null, error: `Failed to load extension: ${message}` };
	}
}

/**
 * Create a LoadedExtension from an inline factory function.
 */
export async function loadExtensionFromFactory(
	factory: ExtensionFactory,
	cwd: string,
	eventBus: EventBus,
	sharedUI: { ui: ExtensionUIContext; hasUI: boolean },
	name = "<inline>",
): Promise<LoadedExtension> {
	const handlers = new Map<string, HandlerFn[]>();
	const tools = new Map<string, RegisteredTool>();
	const {
		api,
		messageRenderers,
		commands,
		flags,
		flagValues,
		shortcuts,
		setSendMessageHandler,
		setSendUserMessageHandler,
		setAppendEntryHandler,
		setGetActiveToolsHandler,
		setGetAllToolsHandler,
		setSetActiveToolsHandler,
		setSetModelHandler,
		setGetThinkingLevelHandler,
		setSetThinkingLevelHandler,
		setFlagValue,
	} = createExtensionAPI(handlers, tools, cwd, name, eventBus, sharedUI);

	await factory(api);

	return {
		path: name,
		resolvedPath: name,
		handlers,
		tools,
		messageRenderers,
		commands,
		flags,
		flagValues,
		shortcuts,
		setSendMessageHandler,
		setSendUserMessageHandler,
		setAppendEntryHandler,
		setGetActiveToolsHandler,
		setGetAllToolsHandler,
		setSetActiveToolsHandler,
		setSetModelHandler,
		setGetThinkingLevelHandler,
		setSetThinkingLevelHandler,
		setFlagValue,
	};
}

/**
 * Load extensions from paths.
 */
export async function loadExtensions(paths: string[], cwd: string, eventBus?: EventBus): Promise<LoadExtensionsResult> {
	const extensions: LoadedExtension[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	const resolvedEventBus = eventBus ?? createEventBus();
	const sharedUI = { ui: createNoOpUIContext(), hasUI: false };

	for (const extPath of paths) {
		const { extension, error } = await loadExtension(extPath, cwd, resolvedEventBus, sharedUI);

		if (error) {
			errors.push({ path: extPath, error });
			continue;
		}

		if (extension) {
			extensions.push(extension);
		}
	}

	return {
		extensions,
		errors,
		setUIContext(uiContext, hasUI) {
			sharedUI.ui = uiContext;
			sharedUI.hasUI = hasUI;
		},
	};
}

interface PiManifest {
	extensions?: string[];
	themes?: string[];
	skills?: string[];
}

function readPiManifest(packageJsonPath: string): PiManifest | null {
	try {
		const content = fs.readFileSync(packageJsonPath, "utf-8");
		const pkg = JSON.parse(content);
		if (pkg.pi && typeof pkg.pi === "object") {
			return pkg.pi as PiManifest;
		}
		return null;
	} catch {
		return null;
	}
}

function isExtensionFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".js");
}

/**
 * Resolve extension entry points from a directory.
 *
 * Checks for:
 * 1. package.json with "pi.extensions" field -> returns declared paths
 * 2. index.ts or index.js -> returns the index file
 *
 * Returns resolved paths or null if no entry points found.
 */
function resolveExtensionEntries(dir: string): string[] | null {
	// Check for package.json with "pi" field first
	const packageJsonPath = path.join(dir, "package.json");
	if (fs.existsSync(packageJsonPath)) {
		const manifest = readPiManifest(packageJsonPath);
		if (manifest?.extensions?.length) {
			const entries: string[] = [];
			for (const extPath of manifest.extensions) {
				const resolvedExtPath = path.resolve(dir, extPath);
				if (fs.existsSync(resolvedExtPath)) {
					entries.push(resolvedExtPath);
				}
			}
			if (entries.length > 0) {
				return entries;
			}
		}
	}

	// Check for index.ts or index.js
	const indexTs = path.join(dir, "index.ts");
	const indexJs = path.join(dir, "index.js");
	if (fs.existsSync(indexTs)) {
		return [indexTs];
	}
	if (fs.existsSync(indexJs)) {
		return [indexJs];
	}

	return null;
}

/**
 * Discover extensions in a directory.
 *
 * Discovery rules:
 * 1. Direct files: `extensions/*.ts` or `*.js` → load
 * 2. Subdirectory with index: `extensions/* /index.ts` or `index.js` → load
 * 3. Subdirectory with package.json: `extensions/* /package.json` with "pi" field → load what it declares
 *
 * No recursion beyond one level. Complex packages must use package.json manifest.
 */
function discoverExtensionsInDir(dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}

	const discovered: string[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = path.join(dir, entry.name);

			// 1. Direct files: *.ts or *.js
			if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
				discovered.push(entryPath);
				continue;
			}

			// 2 & 3. Subdirectories
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				const entries = resolveExtensionEntries(entryPath);
				if (entries) {
					discovered.push(...entries);
				}
			}
		}
	} catch {
		return [];
	}

	return discovered;
}

/**
 * Discover and load extensions from standard locations.
 */
export async function discoverAndLoadExtensions(
	configuredPaths: string[],
	cwd: string,
	agentDir: string = getAgentDir(),
	eventBus?: EventBus,
): Promise<LoadExtensionsResult> {
	const allPaths: string[] = [];
	const seen = new Set<string>();

	const addPaths = (paths: string[]) => {
		for (const p of paths) {
			const resolved = path.resolve(p);
			if (!seen.has(resolved)) {
				seen.add(resolved);
				allPaths.push(p);
			}
		}
	};

	// 1. Global extensions: agentDir/extensions/
	const globalExtDir = path.join(agentDir, "extensions");
	addPaths(discoverExtensionsInDir(globalExtDir));

	// 2. Project-local extensions: cwd/.pi/extensions/
	const localExtDir = path.join(cwd, ".pi", "extensions");
	addPaths(discoverExtensionsInDir(localExtDir));

	// 3. Explicitly configured paths
	for (const p of configuredPaths) {
		const resolved = resolvePath(p, cwd);
		if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
			const entries = resolveExtensionEntries(resolved);
			if (entries) {
				addPaths(entries);
				continue;
			}
		}

		addPaths([resolved]);
	}

	return loadExtensions(allPaths, cwd, eventBus);
}
