/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */

import type { Attachment } from "@mariozechner/pi-agent-core";
import { supportsXhigh } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { existsSync } from "fs";
import { join } from "path";
import { type Args, parseArgs, printHelp } from "./cli/args.js";
import { processFileArguments } from "./cli/file-processor.js";
import { listModels } from "./cli/list-models.js";
import { selectSession } from "./cli/session-picker.js";
import { CONFIG_DIR_NAME, getAgentDir, getModelsPath, VERSION } from "./config.js";
import type { AgentSession } from "./core/agent-session.js";
import { AuthStorage } from "./core/auth-storage.js";
import type { LoadedCustomTool } from "./core/custom-tools/index.js";
import { exportFromFile } from "./core/export-html.js";
import type { HookUIContext } from "./core/index.js";
import type { ModelRegistry } from "./core/model-registry.js";
import { resolveModelScope, type ScopedModel } from "./core/model-resolver.js";
import { type CreateAgentSessionOptions, createAgentSession, discoverAuthStorage, discoverModels } from "./core/sdk.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { resolvePromptInput } from "./core/system-prompt.js";
import { printTimings, time } from "./core/timings.js";
import { allTools } from "./core/tools/index.js";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes/index.js";
import { initTheme, stopThemeWatcher } from "./modes/interactive/theme/theme.js";
import { getChangelogPath, getNewEntries, parseChangelog } from "./utils/changelog.js";
import { ensureTool } from "./utils/tools-manager.js";

async function checkForNewVersion(currentVersion: string): Promise<string | null> {
	try {
		const response = await fetch("https://registry.npmjs.org/@mariozechner/pi -coding-agent/latest");
		if (!response.ok) return null;

		const data = (await response.json()) as { version?: string };
		const latestVersion = data.version;

		if (latestVersion && latestVersion !== currentVersion) {
			return latestVersion;
		}

		return null;
	} catch {
		return null;
	}
}

async function runInteractiveMode(
	session: AgentSession,
	version: string,
	changelogMarkdown: string | null,
	modelFallbackMessage: string | undefined,
	modelsJsonError: string | null,
	migratedProviders: string[],
	versionCheckPromise: Promise<string | null>,
	initialMessages: string[],
	customTools: LoadedCustomTool[],
	setToolUIContext: (uiContext: HookUIContext, hasUI: boolean) => void,
	initialMessage?: string,
	initialAttachments?: Attachment[],
	fdPath: string | null = null,
): Promise<void> {
	const mode = new InteractiveMode(session, version, changelogMarkdown, customTools, setToolUIContext, fdPath);

	await mode.init();

	versionCheckPromise.then((newVersion) => {
		if (newVersion) {
			mode.showNewVersionNotification(newVersion);
		}
	});

	mode.renderInitialMessages(session.state);

	if (migratedProviders.length > 0) {
		mode.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
	}

	if (modelsJsonError) {
		mode.showError(`models.json error: ${modelsJsonError}`);
	}

	if (modelFallbackMessage) {
		mode.showWarning(modelFallbackMessage);
	}

	if (initialMessage) {
		try {
			await session.prompt(initialMessage, { attachments: initialAttachments });
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}

	for (const message of initialMessages) {
		try {
			await session.prompt(message);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}

	while (true) {
		const userInput = await mode.getUserInput();
		try {
			await session.prompt(userInput);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			mode.showError(errorMessage);
		}
	}
}

async function prepareInitialMessage(parsed: Args): Promise<{
	initialMessage?: string;
	initialAttachments?: Attachment[];
}> {
	if (parsed.fileArgs.length === 0) {
		return {};
	}

	const { textContent, imageAttachments } = await processFileArguments(parsed.fileArgs);

	let initialMessage: string;
	if (parsed.messages.length > 0) {
		initialMessage = textContent + parsed.messages[0];
		parsed.messages.shift();
	} else {
		initialMessage = textContent;
	}

	return {
		initialMessage,
		initialAttachments: imageAttachments.length > 0 ? imageAttachments : undefined,
	};
}

function getChangelogForDisplay(parsed: Args, settingsManager: SettingsManager): string | null {
	if (parsed.continue || parsed.resume) {
		return null;
	}

	const lastVersion = settingsManager.getLastChangelogVersion();
	const changelogPath = getChangelogPath();
	const entries = parseChangelog(changelogPath);

	if (!lastVersion) {
		if (entries.length > 0) {
			settingsManager.setLastChangelogVersion(VERSION);
			return entries.map((e) => e.content).join("\n\n");
		}
	} else {
		const newEntries = getNewEntries(entries, lastVersion);
		if (newEntries.length > 0) {
			settingsManager.setLastChangelogVersion(VERSION);
			return newEntries.map((e) => e.content).join("\n\n");
		}
	}

	return null;
}

function createSessionManager(parsed: Args, cwd: string): SessionManager | null {
	if (parsed.noSession) {
		return SessionManager.inMemory();
	}
	if (parsed.session) {
		return SessionManager.open(parsed.session, parsed.sessionDir);
	}
	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, parsed.sessionDir);
	}
	// --resume is handled separately (needs picker UI)
	// If --session-dir provided without --continue/--resume, create new session there
	if (parsed.sessionDir) {
		return SessionManager.create(cwd, parsed.sessionDir);
	}
	// Default case (new session) returns null, SDK will create one
	return null;
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

function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	sessionManager: SessionManager | null,
	modelRegistry: ModelRegistry,
): CreateAgentSessionOptions {
	const options: CreateAgentSessionOptions = {};

	// Auto-discover SYSTEM.md if no CLI system prompt provided
	const systemPromptSource = parsed.systemPrompt ?? discoverSystemPromptFile();
	const resolvedSystemPrompt = resolvePromptInput(systemPromptSource, "system prompt");
	const resolvedAppendPrompt = resolvePromptInput(parsed.appendSystemPrompt, "append system prompt");

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
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	} else if (scopedModels.length > 0 && !parsed.continue && !parsed.resume) {
		options.thinkingLevel = scopedModels[0].thinkingLevel;
	}

	// Scoped models for Ctrl+P cycling
	if (scopedModels.length > 0) {
		options.scopedModels = scopedModels;
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
	if (parsed.tools) {
		options.tools = parsed.tools.map((name) => allTools[name]);
	}

	// Skills
	if (parsed.noSkills) {
		options.skills = [];
	}

	// Additional hook paths from CLI
	if (parsed.hooks && parsed.hooks.length > 0) {
		options.additionalHookPaths = parsed.hooks;
	}

	// Additional custom tool paths from CLI
	if (parsed.customTools && parsed.customTools.length > 0) {
		options.additionalCustomToolPaths = parsed.customTools;
	}

	return options;
}

export async function main(args: string[]) {
	time("start");

	// Migrate legacy oauth.json and settings.json apiKeys to auth.json
	const agentDir = getAgentDir();
	const migratedProviders = AuthStorage.migrateLegacy(join(agentDir, "auth.json"), agentDir);

	// Create AuthStorage and ModelRegistry upfront
	const authStorage = discoverAuthStorage();
	const modelRegistry = discoverModels(authStorage);
	time("discoverModels");

	const parsed = parseArgs(args);
	time("parseArgs");

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
			const result = exportFromFile(parsed.export, outputPath);
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

	const cwd = process.cwd();
	const { initialMessage, initialAttachments } = await prepareInitialMessage(parsed);
	time("prepareInitialMessage");
	const isInteractive = !parsed.print && parsed.mode === undefined;
	const mode = parsed.mode || "text";

	const settingsManager = SettingsManager.create(cwd);
	time("SettingsManager.create");
	initTheme(settingsManager.getTheme(), isInteractive);
	time("initTheme");

	let scopedModels: ScopedModel[] = [];
	if (parsed.models && parsed.models.length > 0) {
		scopedModels = await resolveModelScope(parsed.models, modelRegistry);
		time("resolveModelScope");
	}

	// Create session manager based on CLI flags
	let sessionManager = createSessionManager(parsed, cwd);
	time("createSessionManager");

	// Handle --resume: show session picker
	if (parsed.resume) {
		const sessions = SessionManager.list(cwd, parsed.sessionDir);
		time("SessionManager.list");
		if (sessions.length === 0) {
			console.log(chalk.dim("No sessions found"));
			return;
		}
		const selectedPath = await selectSession(sessions);
		time("selectSession");
		if (!selectedPath) {
			console.log(chalk.dim("No session selected"));
			return;
		}
		sessionManager = SessionManager.open(selectedPath);
	}

	const sessionOptions = buildSessionOptions(parsed, scopedModels, sessionManager, modelRegistry);
	sessionOptions.authStorage = authStorage;
	sessionOptions.modelRegistry = modelRegistry;

	// Handle CLI --api-key as runtime override (not persisted)
	if (parsed.apiKey) {
		if (!sessionOptions.model) {
			console.error(chalk.red("--api-key requires a model to be specified via --provider/--model or -m/--models"));
			process.exit(1);
		}
		authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
	}

	time("buildSessionOptions");
	const { session, customToolsResult, modelFallbackMessage } = await createAgentSession(sessionOptions);
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
		const versionCheckPromise = checkForNewVersion(VERSION).catch(() => null);
		const changelogMarkdown = getChangelogForDisplay(parsed, settingsManager);

		if (scopedModels.length > 0) {
			const modelList = scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel !== "off" ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			console.log(chalk.dim(`Model scope: ${modelList} ${chalk.gray("(Ctrl+P to cycle)")}`));
		}

		const fdPath = await ensureTool("fd");
		time("ensureTool(fd)");

		printTimings();
		await runInteractiveMode(
			session,
			VERSION,
			changelogMarkdown,
			modelFallbackMessage,
			modelRegistry.getError(),
			migratedProviders,
			versionCheckPromise,
			parsed.messages,
			customToolsResult.tools,
			customToolsResult.setUIContext,
			initialMessage,
			initialAttachments,
			fdPath,
		);
	} else {
		await runPrintMode(session, mode, parsed.messages, initialMessage, initialAttachments);
		stopThemeWatcher();
		if (process.stdout.writableLength > 0) {
			await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
		}
		process.exit(0);
	}
}
