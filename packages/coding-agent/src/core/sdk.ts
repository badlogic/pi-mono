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
import { getAgentDir } from "../config.js";
import { AgentSession } from "./agent-session.js";
import { discoverAndLoadCustomTools, type LoadedCustomTool } from "./custom-tools/index.js";
import type { CustomAgentTool } from "./custom-tools/types.js";
import { discoverAndLoadHooks, HookRunner, type LoadedHook, wrapToolsWithHooks } from "./hooks/index.js";
import type { HookFactory } from "./hooks/types.js";
import { messageTransformer } from "./messages.js";
import {
	findModel as findModelInternal,
	getApiKeyForModel,
	getAvailableModels,
	loadAndMergeModels,
} from "./model-config.js";
import { SessionManager } from "./session-manager.js";
import { type Settings, SettingsManager, type SkillsSettings } from "./settings-manager.js";
import { loadSkills as loadSkillsInternal, type Skill } from "./skills.js";
import { type FileSlashCommand, loadSlashCommands as loadSlashCommandsInternal } from "./slash-commands.js";
import {
	buildSystemPrompt as buildSystemPromptInternal,
	loadProjectContextFiles as loadContextFilesInternal,
} from "./system-prompt.js";
import {
	allTools,
	bashTool,
	codingTools,
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

	/** Model to use. Default: from settings, else first available */
	model?: Model<any>;
	/** Thinking level. Default: from settings, else 'off' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Models available for cycling (Ctrl+P in interactive mode) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;

	/** API key resolver. Default: defaultGetApiKey() */
	getApiKey?: (model: Model<any>) => Promise<string | undefined>;

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

	/** Settings overrides (merged with agentDir/settings.json) */
	settings?: Partial<Settings>;
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
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

// Discovery Functions

/**
 * Get all models (built-in + custom from models.json).
 * Note: Uses default agentDir for models.json location.
 */
export function discoverModels(): Model<any>[] {
	const { models, error } = loadAndMergeModels();
	if (error) {
		throw new Error(error);
	}
	return models;
}

/**
 * Get models that have valid API keys available.
 * Note: Uses default agentDir for models.json and oauth.json location.
 */
export async function discoverAvailableModels(): Promise<Model<any>[]> {
	const { models, error } = await getAvailableModels();
	if (error) {
		throw new Error(error);
	}
	return models;
}

/**
 * Find a model by provider and ID.
 * Note: Uses default agentDir for models.json location.
 * @returns The model, or null if not found
 */
export function findModel(provider: string, modelId: string): Model<any> | null {
	const { model, error } = findModelInternal(provider, modelId);
	if (error) {
		throw new Error(error);
	}
	return model;
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

/**
 * Create the default API key resolver.
 * Checks custom providers (models.json), OAuth, and environment variables.
 * Note: Uses default agentDir for models.json and oauth.json location.
 */
export function defaultGetApiKey(): (model: Model<any>) => Promise<string | undefined> {
	return getApiKeyForModel;
}

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
 * Load settings from agentDir/settings.json.
 */
export function loadSettings(agentDir?: string): Settings {
	const manager = new SettingsManager(agentDir ?? getDefaultAgentDir());
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
 * const { session } = await createAgentSession({
 *   model: findModel('anthropic', 'claude-sonnet-4-20250514'),
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

	const settingsManager = new SettingsManager(agentDir);
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd);

	// Check if session has existing data to restore
	const existingSession = sessionManager.loadSession();
	const hasExistingSession = existingSession.messages.length > 0;

	let model = options.model;
	let modelFallbackMessage: string | undefined;

	// If session has data, try to restore model from it
	if (!model && hasExistingSession && existingSession.model) {
		const restoredModel = findModel(existingSession.model.provider, existingSession.model.modelId);
		if (restoredModel) {
			const key = await getApiKeyForModel(restoredModel);
			if (key) {
				model = restoredModel;
			}
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
			const settingsModel = findModel(defaultProvider, defaultModelId);
			if (settingsModel) {
				const key = await getApiKeyForModel(settingsModel);
				if (key) {
					model = settingsModel;
				}
			}
		}
	}

	// Fall back to first available
	if (!model) {
		const available = await discoverAvailableModels();
		if (available.length === 0) {
			throw new Error(
				"No models available. Set an API key environment variable " +
					"(ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) or provide a model explicitly.",
			);
		}
		model = available[0];
		if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
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
	if (!model.reasoning) {
		thinkingLevel = "off";
	}

	const getApiKey = options.getApiKey ?? defaultGetApiKey();

	const skills = options.skills ?? discoverSkills(cwd, agentDir, settingsManager.getSkillsSettings());

	const contextFiles = options.contextFiles ?? discoverContextFiles(cwd, agentDir);

	const builtInTools = options.tools ?? codingTools;

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
		for (const { path, error } of errors) {
			console.error(`Failed to load hook "${path}": ${error}`);
		}
		if (hooks.length > 0) {
			hookRunner = new HookRunner(hooks, cwd, settingsManager.getHookTimeout());
		}
	}

	let allToolsArray: Tool[] = [...builtInTools, ...customToolsResult.tools.map((lt) => lt.tool as unknown as Tool)];
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

	if (options.systemPrompt === undefined) {
		systemPrompt = defaultPrompt;
	} else if (typeof options.systemPrompt === "string") {
		systemPrompt = options.systemPrompt;
	} else {
		systemPrompt = options.systemPrompt(defaultPrompt);
	}

	const slashCommands = options.slashCommands ?? discoverSlashCommands(cwd, agentDir);

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
				const key = await getApiKey(currentModel);
				if (!key) {
					throw new Error(`No API key found for provider "${currentModel.provider}"`);
				}
				return key;
			},
		}),
	});

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
	});

	return {
		session,
		customToolsResult,
		modelFallbackMessage,
	};
}
