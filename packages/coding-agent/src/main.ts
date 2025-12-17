/**
 * Main entry point for the coding agent
 */

import { Agent, type Attachment, ProviderTransport, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import { type Args, parseArgs, printHelp } from "./cli/args.js";
import { processFileArguments } from "./cli/file-processor.js";
import { listModels } from "./cli/list-models.js";
import { selectSession } from "./cli/session-picker.js";
import { getModelsPath, VERSION } from "./config.js";
import { AgentSession } from "./core/agent-session.js";
import { discoverAndLoadCustomTools, type LoadedCustomTool } from "./core/custom-tools/index.js";
import { exportFromFile } from "./core/export-html.js";
import { discoverAndLoadHooks, HookRunner, wrapToolsWithHooks } from "./core/hooks/index.js";
import { messageTransformer } from "./core/messages.js";
import { findModel, getApiKeyForModel, getAvailableModels } from "./core/model-config.js";
import { resolveModelScope, restoreModelFromSession, type ScopedModel } from "./core/model-resolver.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { loadSlashCommands } from "./core/slash-commands.js";
import { buildSystemPrompt } from "./core/system-prompt.js";
import { allTools, codingTools } from "./core/tools/index.js";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes/index.js";
import { initTheme, stopThemeWatcher } from "./modes/interactive/theme/theme.js";
import { getChangelogPath, getNewEntries, parseChangelog } from "./utils/changelog.js";
import { ensureTool } from "./utils/tools-manager.js";

/** Check npm registry for new version (non-blocking) */
async function checkForNewVersion(currentVersion: string): Promise<string | null> {
	try {
		const response = await fetch("https://registry.npmjs.org/@mariozechner/pi-coding-agent/latest");
		if (!response.ok) return null;

		const data = (await response.json()) as { version?: string };
		const latestVersion = data.version;

		if (latestVersion && latestVersion !== currentVersion) {
			return latestVersion;
		}

		return null;
	} catch {
		// Silently fail - don't disrupt the user experience
		return null;
	}
}

/** Run interactive mode with TUI */
async function runInteractiveMode(
	session: AgentSession,
	version: string,
	changelogMarkdown: string | null,
	modelFallbackMessage: string | null,
	versionCheckPromise: Promise<string | null>,
	initialMessages: string[],
	customTools: LoadedCustomTool[],
	setToolUIContext: (uiContext: import("./core/hooks/types.js").HookUIContext, hasUI: boolean) => void,
	initialMessage?: string,
	initialAttachments?: Attachment[],
	fdPath: string | null = null,
): Promise<void> {
	const mode = new InteractiveMode(session, version, changelogMarkdown, customTools, setToolUIContext, fdPath);

	// Initialize TUI (subscribes to agent events internally)
	await mode.init();

	// Handle version check result when it completes (don't block)
	versionCheckPromise.then((newVersion) => {
		if (newVersion) {
			mode.showNewVersionNotification(newVersion);
		}
	});

	// Render any existing messages (from --continue mode)
	mode.renderInitialMessages(session.state);

	// Show model fallback warning at the end of the chat if applicable
	if (modelFallbackMessage) {
		mode.showWarning(modelFallbackMessage);
	}

	// Process initial message with attachments if provided (from @file args)
	if (initialMessage) {
		try {
			await session.prompt(initialMessage, { attachments: initialAttachments });
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}

	// Process remaining initial messages if provided (from CLI args)
	for (const message of initialMessages) {
		try {
			await session.prompt(message);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}

	// Interactive loop
	while (true) {
		const userInput = await mode.getUserInput();

		// Process the message
		try {
			await session.prompt(userInput);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}
}

/** Prepare initial message from @file arguments */
async function prepareInitialMessage(parsed: Args): Promise<{
	initialMessage?: string;
	initialAttachments?: Attachment[];
}> {
	if (parsed.fileArgs.length === 0) {
		return {};
	}

	const { textContent, imageAttachments } = await processFileArguments(parsed.fileArgs);

	// Combine file content with first plain text message (if any)
	let initialMessage: string;
	if (parsed.messages.length > 0) {
		initialMessage = textContent + parsed.messages[0];
		parsed.messages.shift(); // Remove first message as it's been combined
	} else {
		initialMessage = textContent;
	}

	return {
		initialMessage,
		initialAttachments: imageAttachments.length > 0 ? imageAttachments : undefined,
	};
}

export async function main(args: string[]) {
	const parsed = parseArgs(args);

	if (parsed.version) {
		console.log(VERSION);
		return;
	}

	if (parsed.help) {
		printHelp();
		return;
	}

	// Handle --list-models flag: list available models and exit
	if (parsed.listModels !== undefined) {
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(searchPattern);
		return;
	}

	// Handle --export flag: convert session file to HTML and exit
	if (parsed.export) {
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			const result = exportFromFile(parsed.export, outputPath);
			console.log(`Exported to: ${result}`);
			return;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
	}

	// Validate: RPC mode doesn't support @file arguments
	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	// Process @file arguments
	const { initialMessage, initialAttachments } = await prepareInitialMessage(parsed);

	// Determine if we're in interactive mode (needed for theme watcher)
	const isInteractive = !parsed.print && parsed.mode === undefined;

	// Initialize theme (before any TUI rendering)
	const settingsManager = new SettingsManager();
	const themeName = settingsManager.getTheme();
	initTheme(themeName, isInteractive);

	// Setup session manager
	const sessionManager = new SessionManager(parsed.continue && !parsed.resume, parsed.session);

	if (parsed.noSession) {
		sessionManager.disable();
	}

	// Handle --resume flag: show session selector
	if (parsed.resume) {
		const selectedSession = await selectSession(sessionManager);
		if (!selectedSession) {
			console.log(chalk.dim("No session selected"));
			return;
		}
		sessionManager.setSessionFile(selectedSession);
	}

	// Resolve model scope early if provided
	let scopedModels: ScopedModel[] = [];
	if (parsed.models && parsed.models.length > 0) {
		scopedModels = await resolveModelScope(parsed.models);
	}

	// Determine mode and output behavior
	const mode = parsed.mode || "text";
	const shouldPrintMessages = isInteractive;

	// Find initial model
	let initialModel = await findInitialModelForSession(parsed, scopedModels, settingsManager);
	let initialThinking: ThinkingLevel = "off";

	// Get thinking level from scoped models if applicable
	if (scopedModels.length > 0 && !parsed.continue && !parsed.resume) {
		initialThinking = scopedModels[0].thinkingLevel;
	} else {
		// Try saved thinking level
		const savedThinking = settingsManager.getDefaultThinkingLevel();
		if (savedThinking) {
			initialThinking = savedThinking;
		}
	}

	// Non-interactive mode: fail early if no model available
	if (!isInteractive && !initialModel) {
		console.error(chalk.red("No models available."));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		console.error(chalk.yellow(`\nOr create ${getModelsPath()}`));
		process.exit(1);
	}

	// Non-interactive mode: validate API key exists
	if (!isInteractive && initialModel) {
		const apiKey = parsed.apiKey || (await getApiKeyForModel(initialModel));
		if (!apiKey) {
			console.error(chalk.red(`No API key found for ${initialModel.provider}`));
			process.exit(1);
		}
	}

	// Build system prompt
	const skillsEnabled = !parsed.noSkills && settingsManager.getSkillsEnabled();
	const systemPrompt = buildSystemPrompt({
		customPrompt: parsed.systemPrompt,
		selectedTools: parsed.tools,
		appendSystemPrompt: parsed.appendSystemPrompt,
		skillsEnabled,
	});

	// Handle session restoration
	let modelFallbackMessage: string | null = null;

	if (parsed.continue || parsed.resume || parsed.session) {
		const savedModel = sessionManager.loadModel();
		if (savedModel) {
			const result = await restoreModelFromSession(
				savedModel.provider,
				savedModel.modelId,
				initialModel,
				shouldPrintMessages,
			);

			if (result.model) {
				initialModel = result.model;
			}
			modelFallbackMessage = result.fallbackMessage;
		}

		// Load and restore thinking level
		const thinkingLevel = sessionManager.loadThinkingLevel() as ThinkingLevel;
		if (thinkingLevel) {
			initialThinking = thinkingLevel;
			if (shouldPrintMessages) {
				console.log(chalk.dim(`Restored thinking level: ${thinkingLevel}`));
			}
		}
	}

	// CLI --thinking flag takes highest priority
	if (parsed.thinking) {
		initialThinking = parsed.thinking;
	}

	// Determine which tools to use
	let selectedTools = parsed.tools ? parsed.tools.map((name) => allTools[name]) : codingTools;

	// Discover and load hooks from:
	// 1. ~/.pi/agent/hooks/*.ts (global)
	// 2. cwd/.pi/hooks/*.ts (project-local)
	// 3. Explicit paths in settings.json
	// 4. CLI --hook flags
	let hookRunner: HookRunner | null = null;
	const cwd = process.cwd();
	const configuredHookPaths = [...settingsManager.getHookPaths(), ...(parsed.hooks ?? [])];
	const { hooks, errors } = await discoverAndLoadHooks(configuredHookPaths, cwd);

	// Report hook loading errors
	for (const { path, error } of errors) {
		console.error(chalk.red(`Failed to load hook "${path}": ${error}`));
	}

	if (hooks.length > 0) {
		const timeout = settingsManager.getHookTimeout();
		hookRunner = new HookRunner(hooks, cwd, timeout);

		// Wrap tools with hook callbacks
		selectedTools = wrapToolsWithHooks(selectedTools, hookRunner);
	}

	// Discover and load custom tools from:
	// 1. ~/.pi/agent/tools/*.ts (global)
	// 2. cwd/.pi/tools/*.ts (project-local)
	// 3. Explicit paths in settings.json
	// 4. CLI --tool flags
	const configuredToolPaths = [...settingsManager.getCustomToolPaths(), ...(parsed.customTools ?? [])];
	const builtInToolNames = Object.keys(allTools);
	const {
		tools: loadedCustomTools,
		errors: toolErrors,
		setUIContext: setToolUIContext,
	} = await discoverAndLoadCustomTools(configuredToolPaths, cwd, builtInToolNames);

	// Report custom tool loading errors
	for (const { path, error } of toolErrors) {
		console.error(chalk.red(`Failed to load custom tool "${path}": ${error}`));
	}

	// Add custom tools to selected tools
	if (loadedCustomTools.length > 0) {
		const customToolInstances = loadedCustomTools.map((lt) => lt.tool);
		selectedTools = [...selectedTools, ...customToolInstances] as typeof selectedTools;
	}

	// Create agent
	const agent = new Agent({
		initialState: {
			systemPrompt,
			model: initialModel as any, // Can be null in interactive mode
			thinkingLevel: initialThinking,
			tools: selectedTools,
		},
		messageTransformer,
		queueMode: settingsManager.getQueueMode(),
		transport: new ProviderTransport({
			getApiKey: async () => {
				const currentModel = agent.state.model;
				if (!currentModel) {
					throw new Error("No model selected");
				}

				if (parsed.apiKey) {
					return parsed.apiKey;
				}

				const key = await getApiKeyForModel(currentModel);
				if (!key) {
					throw new Error(
						`No API key found for provider "${currentModel.provider}". Please set the appropriate environment variable or update ${getModelsPath()}`,
					);
				}
				return key;
			},
		}),
	});

	// If initial thinking was requested but model doesn't support it, reset to off
	if (initialThinking !== "off" && initialModel && !initialModel.reasoning) {
		agent.setThinkingLevel("off");
	}

	// Load previous messages if continuing, resuming, or using --session
	if (parsed.continue || parsed.resume || parsed.session) {
		const messages = sessionManager.loadMessages();
		if (messages.length > 0) {
			agent.replaceMessages(messages);
		}
	}

	// Load file commands for slash command expansion
	const fileCommands = loadSlashCommands();

	// Create session
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		scopedModels,
		fileCommands,
		hookRunner,
		customTools: loadedCustomTools,
	});

	// Route to appropriate mode
	if (mode === "rpc") {
		await runRpcMode(session);
	} else if (isInteractive) {
		// Check for new version in the background
		const versionCheckPromise = checkForNewVersion(VERSION).catch(() => null);

		// Check if we should show changelog
		const changelogMarkdown = getChangelogForDisplay(parsed, settingsManager);

		// Show model scope if provided
		if (scopedModels.length > 0) {
			const modelList = scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel !== "off" ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			console.log(chalk.dim(`Model scope: ${modelList} ${chalk.gray("(Ctrl+P to cycle)")}`));
		}

		// Ensure fd tool is available for file autocomplete
		const fdPath = await ensureTool("fd");

		await runInteractiveMode(
			session,
			VERSION,
			changelogMarkdown,
			modelFallbackMessage,
			versionCheckPromise,
			parsed.messages,
			loadedCustomTools,
			setToolUIContext,
			initialMessage,
			initialAttachments,
			fdPath,
		);
	} else {
		// Non-interactive mode (--print flag or --mode flag)
		await runPrintMode(session, mode, parsed.messages, initialMessage, initialAttachments);
		// Clean up and exit (file watchers keep process alive)
		stopThemeWatcher();
		process.exit(0);
	}
}

/** Find initial model based on CLI args, scoped models, settings, or available models */
async function findInitialModelForSession(parsed: Args, scopedModels: ScopedModel[], settingsManager: SettingsManager) {
	// 1. CLI args take priority
	if (parsed.provider && parsed.model) {
		const { model, error } = findModel(parsed.provider, parsed.model);
		if (error) {
			console.error(chalk.red(error));
			process.exit(1);
		}
		if (!model) {
			console.error(chalk.red(`Model ${parsed.provider}/${parsed.model} not found`));
			process.exit(1);
		}
		return model;
	}

	// 2. Use first model from scoped models (skip if continuing/resuming)
	if (scopedModels.length > 0 && !parsed.continue && !parsed.resume) {
		return scopedModels[0].model;
	}

	// 3. Try saved default from settings
	const defaultProvider = settingsManager.getDefaultProvider();
	const defaultModelId = settingsManager.getDefaultModel();
	if (defaultProvider && defaultModelId) {
		const { model, error } = findModel(defaultProvider, defaultModelId);
		if (error) {
			console.error(chalk.red(error));
			process.exit(1);
		}
		if (model) {
			return model;
		}
	}

	// 4. Try first available model with valid API key
	const { models: availableModels, error } = await getAvailableModels();

	if (error) {
		console.error(chalk.red(error));
		process.exit(1);
	}

	if (availableModels.length > 0) {
		return availableModels[0];
	}

	return null;
}

/** Get changelog markdown to display (only for new sessions with updates) */
function getChangelogForDisplay(parsed: Args, settingsManager: SettingsManager): string | null {
	if (parsed.continue || parsed.resume) {
		return null;
	}

	const lastVersion = settingsManager.getLastChangelogVersion();
	const changelogPath = getChangelogPath();
	const entries = parseChangelog(changelogPath);

	if (!lastVersion) {
		// First run - show all entries
		if (entries.length > 0) {
			settingsManager.setLastChangelogVersion(VERSION);
			return entries.map((e) => e.content).join("\n\n");
		}
	} else {
		// Check for new entries since last version
		const newEntries = getNewEntries(entries, lastVersion);
		if (newEntries.length > 0) {
			settingsManager.setLastChangelogVersion(VERSION);
			return newEntries.map((e) => e.content).join("\n\n");
		}
	}

	return null;
}
