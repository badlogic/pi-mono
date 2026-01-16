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
 * // Full control
 * const session = await createAgentSession({
 *   model: myModel,
 *   getApiKey: async () => process.env.MY_KEY,
 *   tools: [readTool, bashTool],
 *   skills: [],
 *   sessionFile: false,
 * });
 * ```
 */

import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import { join } from "path";
import { getAgentDir } from "../config.js";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "./auth-storage.js";
import { createEventBus, type EventBus } from "./event-bus.js";
import {
	createExtensionRuntime,
	discoverAndLoadExtensions,
	type ExtensionFactory,
	ExtensionRunner,
	type LoadExtensionsResult,
	loadExtensionFromFactory,
	type ToolDefinition,
	wrapRegisteredTools,
	wrapToolsWithExtensions,
} from "./extensions/index.js";
import { convertToLlm } from "./messages.js";
import { ModelRegistry } from "./model-registry.js";
import { loadPromptTemplates as loadPromptTemplatesInternal, type PromptTemplate } from "./prompt-templates.js";
import { SessionManager } from "./session-manager.js";
import { type Settings, SettingsManager, type SkillsSettings } from "./settings-manager.js";
import { loadSkills as loadSkillsInternal, type Skill, type SkillWarning } from "./skills.js";
import {
	buildSystemPrompt as buildSystemPromptInternal,
	loadProjectContextFiles as loadContextFilesInternal,
} from "./system-prompt.js";
import { time } from "./timings.js";
import {
	allTools,
	bashTool,
	codingTools,
	createAllTools,
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
	type ToolName,
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
	/** Custom tools to register (in addition to built-in tools). */
	customTools?: ToolDefinition[];
	/** Inline extensions. When provided (even if empty), skips file discovery. */
	extensions?: ExtensionFactory[];
	/** Additional extension paths to load (merged with discovery). */
	additionalExtensionPaths?: string[];
	/**
	 * Pre-loaded extensions result (skips file discovery).
	 * @internal Used by CLI when extensions are loaded early to parse custom flags.
	 */
	preloadedExtensions?: LoadExtensionsResult;

	/** Shared event bus for tool/extension communication. Default: creates new bus. */
	eventBus?: EventBus;

	/** Skills. Default: discovered from multiple locations */
	skills?: Skill[];
	/** Context files (AGENTS.md content). Default: discovered walking up from cwd */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Prompt templates. Default: discovered from cwd/.pi/prompts/ + agentDir/prompts/ */
	promptTemplates?: PromptTemplate[];

	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
	settingsManager?: SettingsManager;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Extensions result (for UI context setup in interactive mode) */
	extensionsResult: LoadExtensionsResult;
	/** Warning if session was restored with a different model than saved */
	modelFallbackMessage?: string;
}

// Re-exports

export type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	ToolDefinition,
} from "./extensions/index.js";
export type { PromptTemplate } from "./prompt-templates.js";
export type { Settings, SkillsSettings } from "./settings-manager.js";
export type { Skill } from "./skills.js";
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
 * Discover extensions from cwd and agentDir.
 * @param eventBus - Shared event bus for extension communication. Pass to createAgentSession too.
 * @param cwd - Current working directory
 * @param agentDir - Agent configuration directory
 */
export async function discoverExtensions(
	eventBus: EventBus,
	cwd?: string,
	agentDir?: string,
): Promise<LoadExtensionsResult> {
	const resolvedCwd = cwd ?? process.cwd();
	const resolvedAgentDir = agentDir ?? getDefaultAgentDir();

	const result = await discoverAndLoadExtensions([], resolvedCwd, resolvedAgentDir, eventBus);

	// Log errors but don't fail
	for (const { path, error } of result.errors) {
		console.error(`Failed to load extension "${path}": ${error}`);
	}

	return result;
}

/**
 * Discover skills from cwd and agentDir.
 */
export function discoverSkills(
	cwd?: string,
	agentDir?: string,
	settings?: SkillsSettings,
): { skills: Skill[]; warnings: SkillWarning[] } {
	return loadSkillsInternal({
		...settings,
		cwd: cwd ?? process.cwd(),
		agentDir: agentDir ?? getDefaultAgentDir(),
	});
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
 * Discover prompt templates from cwd and agentDir.
 */
export function discoverPromptTemplates(cwd?: string, agentDir?: string): PromptTemplate[] {
	return loadPromptTemplatesInternal({
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
		steeringMode: manager.getSteeringMode(),
		followUpMode: manager.getFollowUpMode(),
		theme: manager.getTheme(),
		compaction: manager.getCompactionSettings(),
		retry: manager.getRetrySettings(),
		hideThinkingBlock: manager.getHideThinkingBlock(),
		shellPath: manager.getShellPath(),
		collapseChangelog: manager.getCollapseChangelog(),
		extensions: manager.getExtensionPaths(),
		skills: manager.getSkillsSettings(),
		terminal: { showImages: manager.getShowImages() },
		images: { autoResize: manager.getImageAutoResize(), blockImages: manager.getBlockImages() },
	};
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
 *   skills: [],
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getDefaultAgentDir();
	const eventBus = options.eventBus ?? createEventBus();

	// Use provided or create AuthStorage and ModelRegistry
	const authStorage = options.authStorage ?? discoverAuthStorage(agentDir);
	const modelRegistry = options.modelRegistry ?? discoverModels(authStorage, agentDir);
	time("discoverModels");

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	time("settingsManager");
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd);
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

	let skills: Skill[];
	let skillWarnings: SkillWarning[];
	if (options.skills !== undefined) {
		skills = options.skills;
		skillWarnings = [];
	} else {
		const discovered = discoverSkills(cwd, agentDir, settingsManager.getSkillsSettings());
		skills = discovered.skills;
		skillWarnings = discovered.warnings;
	}
	time("discoverSkills");

	const contextFiles = options.contextFiles ?? discoverContextFiles(cwd, agentDir);
	time("discoverContextFiles");

	const autoResizeImages = settingsManager.getImageAutoResize();
	const shellCommandPrefix = settingsManager.getShellCommandPrefix();
	// Create ALL built-in tools for the registry (extensions can enable any of them)
	const allBuiltInToolsMap = createAllTools(cwd, {
		read: { autoResizeImages },
		bash: { commandPrefix: shellCommandPrefix },
	});
	// Determine initially active built-in tools (default: read, bash, edit, write)
	const defaultActiveToolNames: ToolName[] = ["read", "bash", "edit", "write"];
	const initialActiveToolNames: ToolName[] = options.tools
		? options.tools.map((t) => t.name).filter((n): n is ToolName => n in allBuiltInToolsMap)
		: defaultActiveToolNames;
	const initialActiveBuiltInTools = initialActiveToolNames.map((name) => allBuiltInToolsMap[name]);
	time("createAllTools");

	// Load extensions (discovers from standard locations + configured paths)
	let extensionsResult: LoadExtensionsResult;
	if (options.preloadedExtensions !== undefined) {
		// Use pre-loaded extensions (from early CLI flag discovery)
		extensionsResult = options.preloadedExtensions;
	} else if (options.extensions !== undefined) {
		// User explicitly provided extensions array (even if empty) - skip discovery
		// Create runtime for inline extensions
		const runtime = createExtensionRuntime();
		extensionsResult = {
			extensions: [],
			errors: [],
			runtime,
		};
	} else {
		// Discover extensions, merging with additional paths
		const configuredPaths = [...settingsManager.getExtensionPaths(), ...(options.additionalExtensionPaths ?? [])];
		extensionsResult = await discoverAndLoadExtensions(configuredPaths, cwd, agentDir, eventBus);
		time("discoverAndLoadExtensions");
		for (const { path, error } of extensionsResult.errors) {
			console.error(`Failed to load extension "${path}": ${error}`);
		}
	}

	// Load inline extensions from factories
	if (options.extensions && options.extensions.length > 0) {
		for (let i = 0; i < options.extensions.length; i++) {
			const factory = options.extensions[i];
			const loaded = await loadExtensionFromFactory(
				factory,
				cwd,
				eventBus,
				extensionsResult.runtime,
				`<inline-${i}>`,
			);
			extensionsResult.extensions.push(loaded);
		}
	}

	// Create extension runner if we have extensions or SDK custom tools
	// The runner provides consistent context for tool execution (shutdown, abort, etc.)
	let extensionRunner: ExtensionRunner | undefined;
	const hasExtensions = extensionsResult.extensions.length > 0;
	const hasCustomTools = options.customTools && options.customTools.length > 0;
	if (hasExtensions || hasCustomTools) {
		extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			cwd,
			sessionManager,
			modelRegistry,
		);
	}

	// Wrap extension-registered tools and SDK-provided custom tools
	// Tools use runner.createContext() for consistent context with event handlers
	let agent: Agent;
	const registeredTools = extensionRunner?.getAllRegisteredTools() ?? [];
	// Combine extension-registered tools with SDK-provided custom tools
	const allCustomTools = [
		...registeredTools,
		...(options.customTools?.map((def) => ({ definition: def, extensionPath: "<sdk>" })) ?? []),
	];

	// Wrap tools using runner's context (ensures shutdown, abort, etc. work correctly)
	const wrappedExtensionTools = extensionRunner ? wrapRegisteredTools(allCustomTools, extensionRunner) : [];

	// Create tool registry mapping name -> tool (for extension getTools/setTools)
	// Registry contains ALL built-in tools so extensions can enable any of them
	const toolRegistry = new Map<string, AgentTool>();
	for (const [name, tool] of Object.entries(allBuiltInToolsMap)) {
		toolRegistry.set(name, tool as AgentTool);
	}
	for (const tool of wrappedExtensionTools as AgentTool[]) {
		toolRegistry.set(tool.name, tool);
	}

	// Initially active tools = active built-in + extension tools
	// Extension tools can override built-in tools with the same name
	const extensionToolNames = new Set(wrappedExtensionTools.map((t) => t.name));
	const nonOverriddenBuiltInTools = initialActiveBuiltInTools.filter((t) => !extensionToolNames.has(t.name));
	let activeToolsArray: Tool[] = [...nonOverriddenBuiltInTools, ...wrappedExtensionTools];
	time("combineTools");

	// Wrap tools with extensions if available
	let wrappedToolRegistry: Map<string, AgentTool> | undefined;
	if (extensionRunner) {
		activeToolsArray = wrapToolsWithExtensions(activeToolsArray as AgentTool[], extensionRunner);
		// Wrap ALL registry tools (not just active) so extensions can enable any
		const allRegistryTools = Array.from(toolRegistry.values());
		const wrappedAllTools = wrapToolsWithExtensions(allRegistryTools, extensionRunner);
		wrappedToolRegistry = new Map<string, AgentTool>();
		for (const tool of wrappedAllTools) {
			wrappedToolRegistry.set(tool.name, tool);
		}
	}

	// Function to rebuild system prompt when tools change
	// Captures static options (cwd, agentDir, skills, contextFiles, customPrompt)
	const rebuildSystemPrompt = (toolNames: string[]): string => {
		// Filter to valid tool names
		const validToolNames = toolNames.filter((n): n is ToolName => n in allBuiltInToolsMap);
		const defaultPrompt = buildSystemPromptInternal({
			cwd,
			agentDir,
			skills,
			contextFiles,
			selectedTools: validToolNames,
		});

		if (options.systemPrompt === undefined) {
			return defaultPrompt;
		} else if (typeof options.systemPrompt === "string") {
			// String is a full replacement - use as-is without appending context/skills
			return options.systemPrompt;
		} else {
			return options.systemPrompt(defaultPrompt);
		}
	};

	const systemPrompt = rebuildSystemPrompt(initialActiveToolNames);
	time("buildSystemPrompt");

	const promptTemplates = options.promptTemplates ?? discoverPromptTemplates(cwd, agentDir);
	time("discoverPromptTemplates");

	// Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlm(messages);
		// Check setting dynamically so mid-session changes take effect
		if (!settingsManager.getBlockImages()) {
			return converted;
		}
		// Filter out ImageContent from all messages, replacing with text placeholder
		return converted.map((msg) => {
			if (msg.role === "user" || msg.role === "toolResult") {
				const content = msg.content;
				if (Array.isArray(content)) {
					const hasImages = content.some((c) => c.type === "image");
					if (hasImages) {
						const filteredContent = content
							.map((c) =>
								c.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : c,
							)
							.filter(
								(c, i, arr) =>
									// Dedupe consecutive "Image reading is disabled." texts
									!(
										c.type === "text" &&
										c.text === "Image reading is disabled." &&
										i > 0 &&
										arr[i - 1].type === "text" &&
										(arr[i - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
									),
							);
						return { ...msg, content: filteredContent };
					}
				}
			}
			return msg;
		});
	};

	agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel,
			tools: activeToolsArray,
		},
		convertToLlm: convertToLlmWithBlockImages,
		sessionId: sessionManager.getSessionId(),
		transformContext: extensionRunner
			? async (messages) => {
					return extensionRunner.emitContext(messages);
				}
			: undefined,
		steeringMode: settingsManager.getSteeringMode(),
		followUpMode: settingsManager.getFollowUpMode(),
		thinkingBudgets: settingsManager.getThinkingBudgets(),
		getApiKey: async (provider) => {
			// Use the provider argument from the in-flight request;
			// agent.state.model may already be switched mid-turn.
			const resolvedProvider = provider || agent.state.model?.provider;
			if (!resolvedProvider) {
				throw new Error("No model selected");
			}
			const key = await modelRegistry.getApiKeyForProvider(resolvedProvider);
			if (!key) {
				throw new Error(`No API key found for provider "${resolvedProvider}"`);
			}
			return key;
		},
	});
	time("createAgent");

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.replaceMessages(existingSession.messages);
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		if (model) {
			sessionManager.appendModelChange(model.provider, model.id);
		}
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		scopedModels: options.scopedModels,
		promptTemplates: promptTemplates,
		extensionRunner,
		skills,
		skillWarnings,
		skillsSettings: settingsManager.getSkillsSettings(),
		modelRegistry,
		toolRegistry: wrappedToolRegistry ?? toolRegistry,
		rebuildSystemPrompt,
	});
	time("createAgentSession");

	return {
		session,
		extensionsResult,
		modelFallbackMessage,
	};
}
