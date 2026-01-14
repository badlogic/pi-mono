/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */

import { type ImageContent, supportsXhigh } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { existsSync } from "fs";
import { join } from "path";
import { type Args, parseArgs, printHelp } from "./cli/args.js";
import { processFileArguments } from "./cli/file-processor.js";
import { listModels } from "./cli/list-models.js";
import { selectSession } from "./cli/session-picker.js";
import { CONFIG_DIR_NAME, getAgentDir, getModelsPath, VERSION } from "./config.js";
import { createEventBus } from "./core/event-bus.js";
import { exportFromFile } from "./core/export-html/index.js";
import { discoverAndLoadExtensions, type LoadExtensionsResult, loadExtensions } from "./core/extensions/index.js";
import { KeybindingsManager } from "./core/keybindings.js";
import type { ModelRegistry } from "./core/model-registry.js";
import { resolveModelScope, type ScopedModel } from "./core/model-resolver.js";
import { type CreateAgentSessionOptions, createAgentSession, discoverAuthStorage, discoverModels } from "./core/sdk.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { resolvePromptInput } from "./core/system-prompt.js";
import { printTimings, time } from "./core/timings.js";
import { allTools } from "./core/tools/index.js";
import { runMigrations, showDeprecationWarnings } from "./migrations.js";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes/index.js";
import { initTheme, stopThemeWatcher } from "./modes/interactive/theme/theme.js";

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	if (parsed.fileArgs.length === 0) {
		return {};
	}

	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });

	let initialMessage: string;
	if (parsed.messages.length > 0) {
		initialMessage = text + parsed.messages[0];
		parsed.messages.shift();
	} else {
		initialMessage = text;
	}

	return {
		initialMessage,
		initialImages: images.length > 0 ? images : undefined,
	};
}

/**
 * Resolve a session argument to a file path.
 * If it looks like a path, use as-is. Otherwise try to match as session ID prefix.
 */
async function resolveSessionPath(sessionArg: string, cwd: string, sessionDir?: string): Promise<string> {
	// If it looks like a file path, use as-is
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return sessionArg;
	}

	// Try to match as session ID (full or partial UUID)
	const sessions = await SessionManager.list(cwd, sessionDir);
	const matches = sessions.filter((s) => s.id.startsWith(sessionArg));

	if (matches.length >= 1) {
		return matches[0].path; // Already sorted by modified time (most recent first)
	}

	// No match - return original (will create new session)
	return sessionArg;
}

async function createSessionManager(parsed: Args, cwd: string): Promise<SessionManager | undefined> {
	if (parsed.noSession) {
		return SessionManager.inMemory();
	}
	if (parsed.session) {
		const resolvedPath = await resolveSessionPath(parsed.session, cwd, parsed.sessionDir);
		return SessionManager.open(resolvedPath, parsed.sessionDir);
	}
	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, parsed.sessionDir);
	}
	// --resume is handled separately (needs picker UI)
	// If --session-dir provided without --continue/--resume, create new session there
	if (parsed.sessionDir) {
		return SessionManager.create(cwd, parsed.sessionDir);
	}
	// Default case (new session) returns undefined, SDK will create one
	return undefined;
}

/** Discover SYSTEM.md file if no CLI system prompt was provided */
function discoverSystemPromptFile(): string | undefined {
	// Check project-local first: .pi/SYSTEM.md
	const projectPath = join(process.cwd(), CONFIG_DIR_NAME, "SYSTEM.md");
	if (existsSync(projectPath)) {
		return projectPath;
	}

	// Fall back to global: ~/.pi/agent/SYSTEM.md
	const globalPath = join(getAgentDir(), "SYSTEM.md");
	if (existsSync(globalPath)) {
		return globalPath;
	}

	return undefined;
}

/** Discover APPEND_SYSTEM.md file if no CLI append system prompt was provided */
function discoverAppendSystemPromptFile(): string | undefined {
	// Check project-local first: .pi/APPEND_SYSTEM.md
	const projectPath = join(process.cwd(), CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
	if (existsSync(projectPath)) {
		return projectPath;
	}

	// Fall back to global: ~/.pi/agent/APPEND_SYSTEM.md
	const globalPath = join(getAgentDir(), "APPEND_SYSTEM.md");
	if (existsSync(globalPath)) {
		return globalPath;
	}

	return undefined;
}

function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	sessionManager: SessionManager | undefined,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
	extensionsResult?: LoadExtensionsResult,
): CreateAgentSessionOptions {
	const options: CreateAgentSessionOptions = {};

	// Auto-discover SYSTEM.md if no CLI system prompt provided
	const systemPromptSource = parsed.systemPrompt ?? discoverSystemPromptFile();
	// Auto-discover APPEND_SYSTEM.md if no CLI append system prompt provided
	const appendSystemPromptSource = parsed.appendSystemPrompt ?? discoverAppendSystemPromptFile();

	const resolvedSystemPrompt = resolvePromptInput(systemPromptSource, "system prompt");
	const resolvedAppendPrompt = resolvePromptInput(appendSystemPromptSource, "append system prompt");

	if (sessionManager) {
		options.sessionManager = sessionManager;
	}

	// Model from CLI
	if (parsed.provider && parsed.model) {
		const model = modelRegistry.find(parsed.provider, parsed.model);
		if (!model) {
			console.error(chalk.red(`Model ${parsed.provider}/${parsed.model} not found`));
			process.exit(1);
		}
		options.model = model;
	} else if (scopedModels.length > 0 && !parsed.continue && !parsed.resume) {
		options.model = scopedModels[0].model;
	}

	// Thinking level
	// Only use scoped model's thinking level if it was explicitly specified (e.g., "model:high")
	// Otherwise, let the SDK use defaultThinkingLevel from settings
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	} else if (scopedModels.length > 0 && scopedModels[0].thinkingLevel && !parsed.continue && !parsed.resume) {
		options.thinkingLevel = scopedModels[0].thinkingLevel;
	}

	// Scoped models for Ctrl+P cycling - fill in default thinking level for models without explicit level
	if (scopedModels.length > 0) {
		const defaultThinkingLevel = settingsManager.getDefaultThinkingLevel() ?? "off";
		options.scopedModels = scopedModels.map((sm) => ({
			model: sm.model,
			thinkingLevel: sm.thinkingLevel ?? defaultThinkingLevel,
		}));
	}

	// API key from CLI - set in authStorage
	// (handled by caller before createAgentSession)

	// System prompt
	if (resolvedSystemPrompt && resolvedAppendPrompt) {
		options.systemPrompt = `${resolvedSystemPrompt}\n\n${resolvedAppendPrompt}`;
	} else if (resolvedSystemPrompt) {
		options.systemPrompt = resolvedSystemPrompt;
	} else if (resolvedAppendPrompt) {
		options.systemPrompt = (defaultPrompt) => `${defaultPrompt}\n\n${resolvedAppendPrompt}`;
	}

	// Tools
	if (parsed.noTools) {
		// --no-tools: start with no built-in tools
		// --tools can still add specific ones back
		if (parsed.tools && parsed.tools.length > 0) {
			options.tools = parsed.tools.map((name) => allTools[name]);
		} else {
			options.tools = [];
		}
	} else if (parsed.tools) {
		options.tools = parsed.tools.map((name) => allTools[name]);
	}

	// Skills
	if (parsed.noSkills) {
		options.skills = [];
	}

	// Pre-loaded extensions (from early CLI flag discovery)
	if (extensionsResult && extensionsResult.extensions.length > 0) {
		options.preloadedExtensions = extensionsResult;
	}

	return options;
}

export async function main(args: string[]) {
	time("start");

	// Run migrations (pass cwd for project-local migrations)
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(process.cwd());

	// Create AuthStorage and ModelRegistry upfront
	const authStorage = discoverAuthStorage();
	const modelRegistry = discoverModels(authStorage);
	time("discoverModels");

	// First pass: parse args to get --extension paths
	const firstPass = parseArgs(args);
	time("parseArgs-firstPass");

	// Early load extensions to discover their CLI flags (unless --no-extensions)
	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const eventBus = createEventBus();
	const settingsManager = SettingsManager.create(cwd);
	time("SettingsManager.create");

	let extensionsResult: LoadExtensionsResult;
	if (firstPass.noExtensions) {
		// --no-extensions disables discovery, but explicit -e flags still work
		const explicitPaths = firstPass.extensions ?? [];
		extensionsResult = await loadExtensions(explicitPaths, cwd, eventBus);
		time("loadExtensions");
	} else {
		// Merge CLI --extension args with settings.json extensions
		const extensionPaths = [...settingsManager.getExtensionPaths(), ...(firstPass.extensions ?? [])];
		extensionsResult = await discoverAndLoadExtensions(extensionPaths, cwd, agentDir, eventBus);
		time("discoverExtensionFlags");
	}

	// Log extension loading errors
	for (const { path, error } of extensionsResult.errors) {
		console.error(chalk.red(`Failed to load extension "${path}": ${error}`));
	}

	// Collect all extension flags
	const extensionFlags = new Map<string, { type: "boolean" | "string" }>();
	for (const ext of extensionsResult.extensions) {
		for (const [name, flag] of ext.flags) {
			extensionFlags.set(name, { type: flag.type });
		}
	}

	// Second pass: parse args with extension flags
	const parsed = parseArgs(args, extensionFlags);
	time("parseArgs");

	// Pass flag values to extensions via runtime
	for (const [name, value] of parsed.unknownFlags) {
		extensionsResult.runtime.flagValues.set(name, value);
	}

	if (parsed.version) {
		console.log(VERSION);
		return;
	}

	if (parsed.help) {
		printHelp();
		return;
	}

	if (parsed.listModels !== undefined) {
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		return;
	}

	if (parsed.export) {
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			const result = await exportFromFile(parsed.export, outputPath);
			console.log(`Exported to: ${result}`);
			return;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, settingsManager.getImageAutoResize());
	time("prepareInitialMessage");
	const isInteractive = !parsed.print && parsed.mode === undefined;
	const mode = parsed.mode || "text";
	initTheme(settingsManager.getTheme(), isInteractive);
	time("initTheme");

	// Show deprecation warnings in interactive mode
	if (isInteractive && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	let scopedModels: ScopedModel[] = [];
	const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
	if (modelPatterns && modelPatterns.length > 0) {
		scopedModels = await resolveModelScope(modelPatterns, modelRegistry);
		time("resolveModelScope");
	}

	// Create session manager based on CLI flags
	let sessionManager = await createSessionManager(parsed, cwd);
	time("createSessionManager");

	// Handle --resume: show session picker
	if (parsed.resume) {
		// Initialize keybindings so session picker respects user config
		KeybindingsManager.create();

		const selectedPath = await selectSession(
			(onProgress) => SessionManager.list(cwd, parsed.sessionDir, onProgress),
			SessionManager.listAll,
		);
		time("selectSession");
		if (!selectedPath) {
			console.log(chalk.dim("No session selected"));
			return;
		}
		sessionManager = SessionManager.open(selectedPath);
	}

	const sessionOptions = buildSessionOptions(
		parsed,
		scopedModels,
		sessionManager,
		modelRegistry,
		settingsManager,
		extensionsResult,
	);
	sessionOptions.authStorage = authStorage;
	sessionOptions.modelRegistry = modelRegistry;
	sessionOptions.eventBus = eventBus;

	// Handle CLI --api-key as runtime override (not persisted)
	if (parsed.apiKey) {
		if (!sessionOptions.model) {
			console.error(chalk.red("--api-key requires a model to be specified via --provider/--model or -m/--models"));
			process.exit(1);
		}
		authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
	}

	time("buildSessionOptions");
	const { session, modelFallbackMessage } = await createAgentSession(sessionOptions);
	time("createAgentSession");

	if (!isInteractive && !session.model) {
		console.error(chalk.red("No models available."));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		console.error(chalk.yellow(`\nOr create ${getModelsPath()}`));
		process.exit(1);
	}

	// Clamp thinking level to model capabilities (for CLI override case)
	if (session.model && parsed.thinking) {
		let effectiveThinking = parsed.thinking;
		if (!session.model.reasoning) {
			effectiveThinking = "off";
		} else if (effectiveThinking === "xhigh" && !supportsXhigh(session.model)) {
			effectiveThinking = "high";
		}
		if (effectiveThinking !== session.thinkingLevel) {
			session.setThinkingLevel(effectiveThinking);
		}
	}

	if (mode === "rpc") {
		await runRpcMode(session);
	} else if (isInteractive) {
		if (scopedModels.length > 0) {
			const modelList = scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			console.log(chalk.dim(`Model scope: ${modelList} ${chalk.gray("(Ctrl+P to cycle)")}`));
		}

		printTimings();
		const mode = new InteractiveMode(session, {
			migratedProviders,
			modelFallbackMessage,
			initialMessage,
			initialImages,
			initialMessages: parsed.messages,
		});
		await mode.run();
	} else {
		await runPrintMode(session, {
			mode,
			messages: parsed.messages,
			initialMessage,
			initialImages,
		});
		stopThemeWatcher();
		if (process.stdout.writableLength > 0) {
			await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
		}
		process.exit(0);
	}
}
