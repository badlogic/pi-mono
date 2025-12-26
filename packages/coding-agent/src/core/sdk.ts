/**
 * SDK for programmatic usage of AgentSession.
 *
 * Provides a factory function and discovery helpers that allow full control
 * over agent configuration, or sensible defaults that match CLI behavior.
 *
 * @example
 * ```typescript
 * // Minimal - everything auto-discovered
 * const session = await createAgentSession();
 *
 * // With custom hooks
 * const session = await createAgentSession({
 *   hooks: [
 *     ...await discoverHooks(),
 *     { factory: myHookFactory },
 *   ],
 * });
 *
 * // Full control
 * const session = await createAgentSession({
 *   model: myModel,
 *   getApiKey: async () => process.env.MY_KEY,
 *   tools: [readTool, bashTool],
 *   hooks: [],
 *   skills: [],
 *   sessionFile: false,
 * });
 * ```
 */

import { Agent, ProviderTransport, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { join } from "path";
import { getAgentDir } from "../config.js";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "./auth-storage.js";
import { discoverAndLoadCustomTools, type LoadedCustomTool } from "./custom-tools/index.js";
import type { CustomAgentTool } from "./custom-tools/types.js";
import { discoverAndLoadHooks, HookRunner, type LoadedHook, wrapToolsWithHooks } from "./hooks/index.js";
import type { HookFactory } from "./hooks/types.js";
import { messageTransformer } from "./messages.js";
import { ModelRegistry } from "./model-registry.js";
import { SessionManager } from "./session-manager.js";
import { type Settings, SettingsManager, type SkillsSettings } from "./settings-manager.js";
import { loadSkills as loadSkillsInternal, type Skill } from "./skills.js";
import { type FileSlashCommand, loadSlashCommands as loadSlashCommandsInternal } from "./slash-commands.js";
import {
	buildSystemPrompt as buildSystemPromptInternal,
	loadProjectContextFiles as loadContextFilesInternal,
} from "./system-prompt.js";
import { time } from "./timings.js";
import {
	allTools,
	bashTool,
	codingTools,
	createBashTool,
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	editTool,
	findTool,
	grepTool,
	lsTool,
	readOnlyTools,
	readTool,
	type Tool,
	writeTool,
} from "./tools/index.js";

// Types

export interface CreateAgentSessionOptions {
	/** Working directory for project-local discovery. Default: process.cwd() */
	cwd?: string;
	/** Global config directory. Default: ~/.pi/agent */
	agentDir?: string;

	/** Auth storage for credentials. Default: discoverAuthStorage(agentDir) */
	authStorage?: AuthStorage;
	/** Model registry. Default: discoverModels(authStorage, agentDir) */
	modelRegistry?: ModelRegistry;

	/** Model to use. Default: from settings, else first available */
	model?: Model<any>;
	/** Thinking level. Default: from settings, else 'off' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Models available for cycling (Ctrl+P in interactive mode) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;

	/** System prompt. String replaces default, function receives default and returns final. */
	systemPrompt?: string | ((defaultPrompt: string) => string);

	/** Built-in tools to use. Default: codingTools [read, bash, edit, write] */
	tools?: Tool[];
	/** Custom tools (replaces discovery). */
	customTools?: Array<{ path?: string; tool: CustomAgentTool }>;
	/** Additional custom tool paths to load (merged with discovery). */
	additionalCustomToolPaths?: string[];

	/** Hooks (replaces discovery). */
	hooks?: Array<{ path?: string; factory: HookFactory }>;
	/** Additional hook paths to load (merged with discovery). */
	additionalHookPaths?: string[];

	/** Skills. Default: discovered from multiple locations */
	skills?: Skill[];
	/** Context files (AGENTS.md content). Default: discovered walking up from cwd */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Slash commands. Default: discovered from cwd/.pi/commands/ + agentDir/commands/ */
	slashCommands?: FileSlashCommand[];

	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
	settingsManager?: SettingsManager;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Custom tools result (for UI context setup in interactive mode) */
	customToolsResult: {
		tools: LoadedCustomTool[];
		setUIContext: (uiContext: any, hasUI: boolean) => void;
	};
	/** Warning if session was restored with a different model than saved */
	modelFallbackMessage?: string;
}

// Re-exports

export type { CustomAgentTool } from "./custom-tools/types.js";
export type { HookAPI, HookFactory } from "./hooks/types.js";
export type { Settings, SkillsSettings } from "./settings-manager.js";
export type { Skill } from "./skills.js";
export type { FileSlashCommand } from "./slash-commands.js";
export type { Tool } from "./tools/index.js";

export {
	// Pre-built tools (use process.cwd())
	readTool,
	bashTool,
	editTool,
	writeTool,
	grepTool,
	findTool,
	lsTool,
	codingTools,
	readOnlyTools,
	allTools as allBuiltInTools,
	// Tool factories (for custom cwd)
	createCodingTools,
	createReadOnlyTools,
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createFindTool,
	createLsTool,
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

// Discovery Functions

/**
 * Create an AuthStorage instance for the given agent directory.
 */
export function discoverAuthStorage(agentDir: string = getDefaultAgentDir()): AuthStorage {
	return new AuthStorage(join(agentDir, "auth.json"));
}

/**
 * Create a ModelRegistry for the given agent directory.
 */
export function discoverModels(authStorage: AuthStorage, agentDir: string = getDefaultAgentDir()): ModelRegistry {
	return new ModelRegistry(authStorage, join(agentDir, "models.json"));
}

/**
 * Discover hooks from cwd and agentDir.
 */
export async function discoverHooks(
	cwd?: string,
	agentDir?: string,
): Promise<Array<{ path: string; factory: HookFactory }>> {
	const resolvedCwd = cwd ?? process.cwd();
	const resolvedAgentDir = agentDir ?? getDefaultAgentDir();

	const { hooks, errors } = await discoverAndLoadHooks([], resolvedCwd, resolvedAgentDir);

	// Log errors but don't fail
	for (const { path, error } of errors) {
		console.error(`Failed to load hook "${path}": ${error}`);
	}

	return hooks.map((h) => ({
		path: h.path,
		factory: createFactoryFromLoadedHook(h),
	}));
}

/**
 * Discover custom tools from cwd and agentDir.
 */
export async function discoverCustomTools(
	cwd?: string,
	agentDir?: string,
): Promise<Array<{ path: string; tool: CustomAgentTool }>> {
	const resolvedCwd = cwd ?? process.cwd();
	const resolvedAgentDir = agentDir ?? getDefaultAgentDir();

	const { tools, errors } = await discoverAndLoadCustomTools([], resolvedCwd, Object.keys(allTools), resolvedAgentDir);

	// Log errors but don't fail
	for (const { path, error } of errors) {
		console.error(`Failed to load custom tool "${path}": ${error}`);
	}

	return tools.map((t) => ({
		path: t.path,
		tool: t.tool,
	}));
}

/**
 * Discover skills from cwd and agentDir.
 */
export function discoverSkills(cwd?: string, agentDir?: string, settings?: SkillsSettings): Skill[] {
	const { skills } = loadSkillsInternal({
		...settings,
		cwd: cwd ?? process.cwd(),
		agentDir: agentDir ?? getDefaultAgentDir(),
	});
	return skills;
}

/**
 * Discover context files (AGENTS.md) walking up from cwd.
 */
export function discoverContextFiles(cwd?: string, agentDir?: string): Array<{ path: string; content: string }> {
	return loadContextFilesInternal({
		cwd: cwd ?? process.cwd(),
		agentDir: agentDir ?? getDefaultAgentDir(),
	});
}

/**
 * Discover slash commands from cwd and agentDir.
 */
export function discoverSlashCommands(cwd?: string, agentDir?: string): FileSlashCommand[] {
	return loadSlashCommandsInternal({
		cwd: cwd ?? process.cwd(),
		agentDir: agentDir ?? getDefaultAgentDir(),
	});
}

// API Key Helpers

// System Prompt

export interface BuildSystemPromptOptions {
	tools?: Tool[];
	skills?: Skill[];
	contextFiles?: Array<{ path: string; content: string }>;
	cwd?: string;
	appendPrompt?: string;
}

/**
 * Build the default system prompt.
 */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	return buildSystemPromptInternal({
		cwd: options.cwd,
		skills: options.skills,
		contextFiles: options.contextFiles,
		appendSystemPrompt: options.appendPrompt,
	});
}

// Settings

/**
 * Load settings from agentDir/settings.json merged with cwd/.pi/settings.json.
 */
export function loadSettings(cwd?: string, agentDir?: string): Settings {
	const manager = SettingsManager.create(cwd ?? process.cwd(), agentDir ?? getDefaultAgentDir());
	return {
		defaultProvider: manager.getDefaultProvider(),
		defaultModel: manager.getDefaultModel(),
		defaultThinkingLevel: manager.getDefaultThinkingLevel(),
		queueMode: manager.getQueueMode(),
		theme: manager.getTheme(),
		compaction: manager.getCompactionSettings(),
		retry: manager.getRetrySettings(),
		hideThinkingBlock: manager.getHideThinkingBlock(),
		shellPath: manager.getShellPath(),
		collapseChangelog: manager.getCollapseChangelog(),
		hooks: manager.getHookPaths(),
		hookTimeout: manager.getHookTimeout(),
		customTools: manager.getCustomToolPaths(),
		skills: manager.getSkillsSettings(),
		terminal: { showImages: manager.getShowImages() },
	};
}

// Internal Helpers

/**
 * Create a HookFactory from a LoadedHook.
 * This allows mixing discovered hooks with inline hooks.
 */
function createFactoryFromLoadedHook(loaded: LoadedHook): HookFactory {
	return (api) => {
		for (const [eventType, handlers] of loaded.handlers) {
			for (const handler of handlers) {
				api.on(eventType as any, handler as any);
			}
		}
	};
}

/**
 * Convert hook definitions to LoadedHooks for the HookRunner.
 */
function createLoadedHooksFromDefinitions(definitions: Array<{ path?: string; factory: HookFactory }>): LoadedHook[] {
	return definitions.map((def) => {
		const handlers = new Map<string, Array<(...args: unknown[]) => Promise<unknown>>>();
		let sendHandler: (text: string, attachments?: any[]) => void = () => {};

		const api = {
			on: (event: string, handler: (...args: unknown[]) => Promise<unknown>) => {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			},
			send: (text: string, attachments?: any[]) => {
				sendHandler(text, attachments);
			},
		};

		def.factory(api as any);

		return {
			path: def.path ?? "<inline>",
			resolvedPath: def.path ?? "<inline>",
			handlers,
			setSendHandler: (handler: (text: string, attachments?: any[]) => void) => {
				sendHandler = handler;
			},
		};
	});
}

// Factory

/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@mariozechner/pi-ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   getApiKey: async () => process.env.MY_KEY,
 *   systemPrompt: 'You are helpful.',
 *   tools: [readTool, bashTool],
 *   hooks: [],
 *   skills: [],
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getDefaultAgentDir();

	// Use provided or create AuthStorage and ModelRegistry
	const authStorage = options.authStorage ?? discoverAuthStorage(agentDir);
	const modelRegistry = options.modelRegistry ?? discoverModels(authStorage, agentDir);
	time("discoverModels");

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	time("settingsManager");
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd, agentDir);
	time("sessionManager");

	// Check if session has existing data to restore
	const existingSession = sessionManager.buildSessionContext();
	time("loadSession");
	const hasExistingSession = existingSession.messages.length > 0;

	let model = options.model;
	let modelFallbackMessage: string | undefined;

	// If session has data, try to restore model from it
	if (!model && hasExistingSession && existingSession.model) {
		const restoredModel = modelRegistry.find(existingSession.model.provider, existingSession.model.modelId);
		if (restoredModel && (await modelRegistry.getApiKey(restoredModel))) {
			model = restoredModel;
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${existingSession.model.provider}/${existingSession.model.modelId}`;
		}
	}

	// If still no model, try settings default
	if (!model) {
		const defaultProvider = settingsManager.getDefaultProvider();
		const defaultModelId = settingsManager.getDefaultModel();
		if (defaultProvider && defaultModelId) {
			const settingsModel = modelRegistry.find(defaultProvider, defaultModelId);
			if (settingsModel && (await modelRegistry.getApiKey(settingsModel))) {
				model = settingsModel;
			}
		}
	}

	// Fall back to first available model with a valid API key
	if (!model) {
		for (const m of modelRegistry.getAll()) {
			if (await modelRegistry.getApiKey(m)) {
				model = m;
				break;
			}
		}
		time("findAvailableModel");
		if (model) {
			if (modelFallbackMessage) {
				modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
			}
		} else {
			// No models available - set message so user knows to /login or configure keys
			modelFallbackMessage = "No models available. Use /login or set an API key environment variable.";
		}
	}

	let thinkingLevel = options.thinkingLevel;

	// If session has data, restore thinking level from it
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = existingSession.thinkingLevel as ThinkingLevel;
	}

	// Fall back to settings default
	if (thinkingLevel === undefined) {
		thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? "off";
	}

	// Clamp to model capabilities
	if (!model || !model.reasoning) {
		thinkingLevel = "off";
	}

	const skills = options.skills ?? discoverSkills(cwd, agentDir, settingsManager.getSkillsSettings());
	time("discoverSkills");

	const contextFiles = options.contextFiles ?? discoverContextFiles(cwd, agentDir);
	time("discoverContextFiles");

	const builtInTools = options.tools ?? createCodingTools(cwd);
	time("createCodingTools");

	let customToolsResult: { tools: LoadedCustomTool[]; setUIContext: (ctx: any, hasUI: boolean) => void };
	if (options.customTools !== undefined) {
		// Use provided custom tools
		const loadedTools: LoadedCustomTool[] = options.customTools.map((ct) => ({
			path: ct.path ?? "<inline>",
			resolvedPath: ct.path ?? "<inline>",
			tool: ct.tool,
		}));
		customToolsResult = {
			tools: loadedTools,
			setUIContext: () => {},
		};
	} else {
		// Discover custom tools, merging with additional paths
		const configuredPaths = [...settingsManager.getCustomToolPaths(), ...(options.additionalCustomToolPaths ?? [])];
		const result = await discoverAndLoadCustomTools(configuredPaths, cwd, Object.keys(allTools), agentDir);
		time("discoverAndLoadCustomTools");
		for (const { path, error } of result.errors) {
			console.error(`Failed to load custom tool "${path}": ${error}`);
		}
		customToolsResult = result;
	}

	let hookRunner: HookRunner | null = null;
	if (options.hooks !== undefined) {
		if (options.hooks.length > 0) {
			const loadedHooks = createLoadedHooksFromDefinitions(options.hooks);
			hookRunner = new HookRunner(loadedHooks, cwd, settingsManager.getHookTimeout());
		}
	} else {
		// Discover hooks, merging with additional paths
		const configuredPaths = [...settingsManager.getHookPaths(), ...(options.additionalHookPaths ?? [])];
		const { hooks, errors } = await discoverAndLoadHooks(configuredPaths, cwd, agentDir);
		time("discoverAndLoadHooks");
		for (const { path, error } of errors) {
			console.error(`Failed to load hook "${path}": ${error}`);
		}
		if (hooks.length > 0) {
			hookRunner = new HookRunner(hooks, cwd, settingsManager.getHookTimeout());
		}
	}

	let allToolsArray: Tool[] = [...builtInTools, ...customToolsResult.tools.map((lt) => lt.tool as unknown as Tool)];
	time("combineTools");
	if (hookRunner) {
		allToolsArray = wrapToolsWithHooks(allToolsArray, hookRunner) as Tool[];
	}

	let systemPrompt: string;
	const defaultPrompt = buildSystemPromptInternal({
		cwd,
		agentDir,
		skills,
		contextFiles,
	});
	time("buildSystemPrompt");

	if (options.systemPrompt === undefined) {
		systemPrompt = defaultPrompt;
	} else if (typeof options.systemPrompt === "string") {
		systemPrompt = buildSystemPromptInternal({
			cwd,
			agentDir,
			skills,
			contextFiles,
			customPrompt: options.systemPrompt,
		});
	} else {
		systemPrompt = options.systemPrompt(defaultPrompt);
	}

	const slashCommands = options.slashCommands ?? discoverSlashCommands(cwd, agentDir);
	time("discoverSlashCommands");

	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel,
			tools: allToolsArray,
		},
		messageTransformer,
		queueMode: settingsManager.getQueueMode(),
		transport: new ProviderTransport({
			getApiKey: async () => {
				const currentModel = agent.state.model;
				if (!currentModel) {
					throw new Error("No model selected");
				}
				const key = await modelRegistry.getApiKey(currentModel);
				if (!key) {
					throw new Error(`No API key found for provider "${currentModel.provider}"`);
				}
				return key;
			},
		}),
	});
	time("createAgent");

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.replaceMessages(existingSession.messages);
	}

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		scopedModels: options.scopedModels,
		fileCommands: slashCommands,
		hookRunner,
		customTools: customToolsResult.tools,
		skillsSettings: settingsManager.getSkillsSettings(),
		modelRegistry,
	});
	time("createAgentSession");

	return {
		session,
		customToolsResult,
		modelFallbackMessage,
	};
}
