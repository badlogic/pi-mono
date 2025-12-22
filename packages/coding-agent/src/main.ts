/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */

import type { Attachment } from "@mariozechner/pi-agent-core";
import { supportsXhigh } from "@mariozechner/pi-ai";
import chalk from "chalk";

import { type Args, parseArgs, printHelp } from "./cli/args.js";
import { processFileArguments } from "./cli/file-processor.js";
import { listModels } from "./cli/list-models.js";
import { selectSession } from "./cli/session-picker.js";
import { getModelsPath, VERSION } from "./config.js";
import type { AgentSession } from "./core/agent-session.js";
import type { LoadedCustomTool } from "./core/custom-tools/index.js";
import { exportFromFile } from "./core/export-html.js";
import { findModel } from "./core/model-config.js";
import { resolveModelScope, type ScopedModel } from "./core/model-resolver.js";
import { type CreateAgentSessionOptions, configureOAuthStorage, createAgentSession } from "./core/sdk.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { allTools } from "./core/tools/index.js";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes/index.js";
import { initTheme, stopThemeWatcher } from "./modes/interactive/theme/theme.js";
import { getChangelogPath, getNewEntries, parseChangelog } from "./utils/changelog.js";
import { ensureTool } from "./utils/tools-manager.js";

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
		return null;
	}
}

async function runInteractiveMode(
	session: AgentSession,
	version: string,
	changelogMarkdown: string | null,
	modelFallbackMessage: string | undefined,
	versionCheckPromise: Promise<string | null>,
	initialMessages: string[],
	customTools: LoadedCustomTool[],
	setToolUIContext: (uiContext: import("./core/hooks/types.js").HookUIContext, hasUI: boolean) => void,
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
		return SessionManager.open(parsed.session);
	}
	if (parsed.continue) {
		return SessionManager.continueRecent(cwd);
	}
	// --resume is handled separately (needs picker UI)
	// Default case (new session) returns null, SDK will create one
	return null;
}

function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	sessionManager: SessionManager | null,
): CreateAgentSessionOptions {
	const options: CreateAgentSessionOptions = {};

	if (sessionManager) {
		options.sessionManager = sessionManager;
	}

	// Model from CLI
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

	// API key from CLI
	if (parsed.apiKey) {
		options.getApiKey = async () => parsed.apiKey!;
	}

	// System prompt
	if (parsed.systemPrompt && parsed.appendSystemPrompt) {
		options.systemPrompt = `${parsed.systemPrompt}\n\n${parsed.appendSystemPrompt}`;
	} else if (parsed.systemPrompt) {
		options.systemPrompt = parsed.systemPrompt;
	} else if (parsed.appendSystemPrompt) {
		options.systemPrompt = (defaultPrompt) => `${defaultPrompt}\n\n${parsed.appendSystemPrompt}`;
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
	configureOAuthStorage();

	const parsed = parseArgs(args);

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
		await listModels(searchPattern);
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
	const isInteractive = !parsed.print && parsed.mode === undefined;
	const mode = parsed.mode || "text";

	const settingsManager = new SettingsManager();
	initTheme(settingsManager.getTheme(), isInteractive);

	let scopedModels: ScopedModel[] = [];
	if (parsed.models && parsed.models.length > 0) {
		scopedModels = await resolveModelScope(parsed.models);
	}

	// Create session manager based on CLI flags
	let sessionManager = createSessionManager(parsed, cwd);

	// Handle --resume: show session picker
	if (parsed.resume) {
		const sessions = SessionManager.list(cwd);
		if (sessions.length === 0) {
			console.log(chalk.dim("No sessions found"));
			return;
		}
		const selectedPath = await selectSession(sessions);
		if (!selectedPath) {
			console.log(chalk.dim("No session selected"));
			return;
		}
		sessionManager = SessionManager.open(selectedPath);
	}

	const sessionOptions = buildSessionOptions(parsed, scopedModels, sessionManager);
	const { session, customToolsResult, modelFallbackMessage } = await createAgentSession(sessionOptions);

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

		await runInteractiveMode(
			session,
			VERSION,
			changelogMarkdown,
			modelFallbackMessage,
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
