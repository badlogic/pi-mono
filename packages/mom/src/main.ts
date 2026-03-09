#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import {
	type AgentRunner,
	getModelRegistrySnapshot,
	getOrCreateRunner,
	type ModelSelection,
	type RunnerConfig,
	resolveConfiguredModel,
} from "./agent.js";
import { downloadChannel } from "./download.js";
import { createEventsWatcher } from "./events.js";
import {
	approveSensitiveCommandRequest,
	denySensitiveCommandRequest,
	isSensitiveCommandApprover,
} from "./guardrails.js";
import * as log from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import { type MomHandler, type SlackBot, SlackBot as SlackBotClass, type SlackEvent } from "./slack.js";
import { ChannelStore } from "./store.js";

// ============================================================================
// Config
// ============================================================================

const MOM_SLACK_APP_TOKEN = process.env.MOM_SLACK_APP_TOKEN;
const MOM_SLACK_BOT_TOKEN = process.env.MOM_SLACK_BOT_TOKEN;

interface ParsedArgs {
	workingDir?: string;
	sandbox: SandboxConfig;
	downloadChannel?: string;
	modelSelection: ModelSelection;
	authFile?: string;
	modelsFile?: string;
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2);
	let sandbox: SandboxConfig = { type: "host" };
	let workingDir: string | undefined;
	let downloadChannelId: string | undefined;
	let provider = process.env.MOM_PROVIDER;
	let model = process.env.MOM_MODEL;
	let authFile = process.env.MOM_AUTH_FILE;
	let modelsFile = process.env.MOM_MODELS_FILE;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--sandbox=")) {
			sandbox = parseSandboxArg(arg.slice("--sandbox=".length));
		} else if (arg === "--sandbox") {
			sandbox = parseSandboxArg(args[++i] || "");
		} else if (arg.startsWith("--download=")) {
			downloadChannelId = arg.slice("--download=".length);
		} else if (arg === "--download") {
			downloadChannelId = args[++i];
		} else if (arg.startsWith("--provider=")) {
			provider = arg.slice("--provider=".length);
		} else if (arg === "--provider") {
			provider = args[++i];
		} else if (arg.startsWith("--model=")) {
			model = arg.slice("--model=".length);
		} else if (arg === "--model") {
			model = args[++i];
		} else if (arg.startsWith("--auth-file=")) {
			authFile = arg.slice("--auth-file=".length);
		} else if (arg === "--auth-file") {
			authFile = args[++i];
		} else if (arg.startsWith("--models-file=")) {
			modelsFile = arg.slice("--models-file=".length);
		} else if (arg === "--models-file") {
			modelsFile = args[++i];
		} else if (!arg.startsWith("-")) {
			workingDir = arg;
		}
	}

	if (model && !provider) {
		log.logWarning("--model specified without --provider", "Model ID lookup may be ambiguous across providers.");
	}

	return {
		workingDir: workingDir ? resolve(workingDir) : undefined,
		sandbox,
		downloadChannel: downloadChannelId,
		modelSelection: { provider, model },
		authFile: authFile ? resolve(authFile) : undefined,
		modelsFile: modelsFile ? resolve(modelsFile) : undefined,
	};
}

const parsedArgs = parseArgs();

function resolveDefaultModelsFile(explicitModelsFile: string | undefined): string | undefined {
	if (explicitModelsFile) {
		return explicitModelsFile;
	}

	const momModelsPath = join(homedir(), ".pi", "mom", "models.json");
	if (existsSync(momModelsPath)) {
		return momModelsPath;
	}

	return undefined;
}

// Handle --download mode
if (parsedArgs.downloadChannel) {
	if (!MOM_SLACK_BOT_TOKEN) {
		console.error("Missing env: MOM_SLACK_BOT_TOKEN");
		process.exit(1);
	}
	await downloadChannel(parsedArgs.downloadChannel, MOM_SLACK_BOT_TOKEN);
	process.exit(0);
}

// Normal bot mode - require working dir
if (!parsedArgs.workingDir) {
	console.error(
		"Usage: mom [--sandbox=host|docker:<name>] [--provider <id>] [--model <id>] [--auth-file <path>] [--models-file <path>] <working-directory>",
	);
	console.error("       mom --download <channel-id>");
	process.exit(1);
}

const { workingDir, sandbox } = { workingDir: parsedArgs.workingDir, sandbox: parsedArgs.sandbox };
const runnerConfig: RunnerConfig = {
	modelSelection: parsedArgs.modelSelection,
	authFile: parsedArgs.authFile,
	modelsFile: resolveDefaultModelsFile(parsedArgs.modelsFile),
};

if (!MOM_SLACK_APP_TOKEN || !MOM_SLACK_BOT_TOKEN) {
	console.error("Missing env: MOM_SLACK_APP_TOKEN, MOM_SLACK_BOT_TOKEN");
	process.exit(1);
}

await validateSandbox(sandbox);

// ============================================================================
// State (per channel)
// ============================================================================

interface ChannelState {
	running: boolean;
	runner: AgentRunner;
	store: ChannelStore;
	stopRequested: boolean;
	stopMessageTs?: string;
}

const channelStates = new Map<string, ChannelState>();

const CHANNEL_MODEL_SELECTION_FILENAME = "model.json";

function getChannelModelSelectionPath(channelId: string): string {
	return join(workingDir, channelId, CHANNEL_MODEL_SELECTION_FILENAME);
}

function loadChannelModelSelection(channelId: string): ModelSelection | undefined {
	const path = getChannelModelSelectionPath(channelId);
	if (!existsSync(path)) return undefined;

	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as ModelSelection;
		const provider = parsed.provider?.trim();
		const model = parsed.model?.trim();
		if (!provider || !model) return undefined;
		return { provider, model };
	} catch (error) {
		log.logWarning(`[${channelId}] Failed to read model selection`, String(error));
		return undefined;
	}
}

function saveChannelModelSelection(channelId: string, selection: ModelSelection): void {
	const path = getChannelModelSelectionPath(channelId);
	mkdirSync(join(workingDir, channelId), { recursive: true });
	writeFileSync(path, `${JSON.stringify(selection, null, 2)}\n`, "utf-8");
}

function getRunnerConfigForChannel(channelId: string): RunnerConfig {
	const channelSelection = loadChannelModelSelection(channelId);
	return {
		...runnerConfig,
		modelSelection: channelSelection ?? runnerConfig.modelSelection,
	};
}

function buildState(channelId: string): ChannelState {
	const channelDir = join(workingDir, channelId);
	const config = getRunnerConfigForChannel(channelId);
	return {
		running: false,
		runner: getOrCreateRunner(sandbox, channelId, channelDir, config),
		store: new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN! }),
		stopRequested: false,
	};
}

function getState(channelId: string): ChannelState {
	let state = channelStates.get(channelId);
	if (!state) {
		state = buildState(channelId);
		channelStates.set(channelId, state);
	}
	return state;
}

function refreshRunner(state: ChannelState, channelId: string): void {
	const channelDir = join(workingDir, channelId);
	state.runner = getOrCreateRunner(sandbox, channelId, channelDir, getRunnerConfigForChannel(channelId));
}

function parseModelCommand(text: string): { command: "models" | "model"; args: string } | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const firstSpace = trimmed.indexOf(" ");
	const command = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
	if (command !== "models" && command !== "model") return null;

	return {
		command,
		args: firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim(),
	};
}

function parseApprovalCommand(text: string): { action: "approve" | "deny"; id: string } | null {
	const trimmed = text.trim();
	const match = trimmed.match(/^(approve|deny)\s+([a-z0-9-]+)$/i);
	if (!match) return null;

	return {
		action: match[1].toLowerCase() as "approve" | "deny",
		id: match[2],
	};
}

function parseModelsArgs(args: string): { filter?: string; page: number; providersOnly: boolean } | { error: string } {
	const trimmed = args.trim();
	let page = 1;
	let remaining = trimmed;

	const pageMatch = trimmed.match(/(?:^|\s+)page\s+(\d+)\s*$/i);
	if (pageMatch) {
		page = Number.parseInt(pageMatch[1], 10);
		remaining = trimmed.slice(0, pageMatch.index).trim();
	}

	if (!Number.isInteger(page) || page < 1) {
		return { error: "Page must be a positive integer." };
	}

	const normalized = remaining.toLowerCase();
	if (normalized === "providers" || normalized === "provider") {
		return { page, providersOnly: true };
	}

	if (remaining === "" || normalized === "list") {
		return { page, providersOnly: false };
	}

	return { filter: remaining, page, providersOnly: false };
}

function formatModelList(
	_currentChannelId: string,
	currentSelection: ModelSelection | undefined,
	availableModels: Array<{ provider: string; id: string }>,
	filter?: string,
	page = 1,
): string {
	const currentLabel =
		currentSelection?.provider && currentSelection?.model
			? `${currentSelection.provider}/${currentSelection.model}`
			: "(auto)";
	const pageSize = 100;
	const totalPages = Math.max(1, Math.ceil(availableModels.length / pageSize));
	const safePage = Math.min(page, totalPages);
	const startIndex = (safePage - 1) * pageSize;
	const shownModels = availableModels.slice(startIndex, startIndex + pageSize);
	const header = [`Current model: \`${currentLabel}\``];
	if (filter) {
		header.push(`Filter: \`${filter}\``);
	}
	header.push(`Page: ${safePage}/${totalPages}`);
	header.push("", "Available models:");
	const lines = shownModels.map((model) => {
		const label = `${model.provider}/${model.id}`;
		const isCurrent = currentSelection?.provider === model.provider && currentSelection?.model === model.id;
		return `${isCurrent ? "•" : "-"} \`${label}\`${isCurrent ? " <- current" : ""}`;
	});

	if (lines.length === 0) {
		lines.push("_No authenticated models available. Configure provider credentials first._");
	}

	header.push(...lines);
	if (page !== safePage) {
		header.push("", `_Requested page ${page}; showing last available page instead._`);
	}
	if (availableModels.length > shownModels.length || safePage > 1) {
		header.push(
			"",
			`_Showing ${startIndex + 1}-${startIndex + shownModels.length} of ${availableModels.length} available models._`,
		);
	}
	header.push(
		"",
		"Commands: `models`, `models page <n>`, `models <filter>`, `models <filter> page <n>`, `models providers`, `model`, `model <provider>/<id>`, `model <id>`",
	);
	return header.join("\n");
}

function formatProviderList(
	currentSelection: ModelSelection | undefined,
	availableModels: Array<{ provider: string; id: string }>,
): string {
	const currentLabel =
		currentSelection?.provider && currentSelection?.model
			? `${currentSelection.provider}/${currentSelection.model}`
			: "(auto)";
	const providerCounts = new Map<string, number>();
	for (const model of availableModels) {
		providerCounts.set(model.provider, (providerCounts.get(model.provider) ?? 0) + 1);
	}

	const lines = Array.from(providerCounts.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([provider, count]) => {
			const isCurrentProvider = currentSelection?.provider === provider;
			return `${isCurrentProvider ? "•" : "-"} \`${provider}\` (${count})${isCurrentProvider ? " <- current provider" : ""}`;
		});

	if (lines.length === 0) {
		lines.push("_No authenticated providers available._");
	}

	return [
		`Current model: \`${currentLabel}\``,
		"",
		"Available providers:",
		...lines,
		"",
		"Commands: `models`, `models page <n>`, `models <filter>`, `models <filter> page <n>`, `models providers`, `model <provider>/<id>`, `model <id>`",
	].join("\n");
}

async function handleModelCommand(event: SlackEvent, slack: SlackBot): Promise<boolean> {
	const parsed = parseModelCommand(event.text);
	if (!parsed) return false;

	const state = getState(event.channel);
	const baseConfig = getRunnerConfigForChannel(event.channel);
	const snapshot = getModelRegistrySnapshot(baseConfig);
	if (snapshot.loadError) {
		log.logWarning(`[${event.channel}] Failed to load model registry`, snapshot.loadError);
	}

	const currentSelection =
		loadChannelModelSelection(event.channel) ??
		(baseConfig.modelSelection?.provider && baseConfig.modelSelection?.model ? baseConfig.modelSelection : undefined);
	const availableModels = snapshot.availableModels
		.map((model) => ({ provider: model.provider, id: model.id }))
		.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));

	if (parsed.command === "models") {
		log.logInfo(`[${event.channel}] Handling built-in command: ${parsed.command}`);
		const listArgs = parseModelsArgs(parsed.args);
		if ("error" in listArgs) {
			const ts = await slack.postMessage(event.channel, listArgs.error);
			slack.logBotResponse(event.channel, listArgs.error, ts);
			return true;
		}
		let text: string;
		if (listArgs.providersOnly) {
			text = formatProviderList(currentSelection, availableModels);
		} else if (listArgs.filter) {
			const normalizedFilter = listArgs.filter.toLowerCase();
			const filteredModels = availableModels.filter((model) => {
				const haystack = `${model.provider}/${model.id}`.toLowerCase();
				return haystack.includes(normalizedFilter);
			});
			text = formatModelList(event.channel, currentSelection, filteredModels, listArgs.filter, listArgs.page);
		} else {
			text = formatModelList(event.channel, currentSelection, availableModels, undefined, listArgs.page);
		}
		const ts = await slack.postMessage(event.channel, text);
		slack.logBotResponse(event.channel, text, ts);
		return true;
	}

	const requested = parsed.args;
	let nextSelection: ModelSelection;
	if (requested.includes("/")) {
		const [provider, ...rest] = requested.split("/");
		nextSelection = { provider: provider.trim(), model: rest.join("/").trim() };
	} else {
		const currentProvider = currentSelection?.provider;
		const providerScopedConfig = currentProvider
			? {
					...baseConfig,
					modelSelection: { provider: currentProvider, model: requested },
				}
			: undefined;
		if (providerScopedConfig) {
			try {
				const resolved = resolveConfiguredModel(providerScopedConfig);
				nextSelection = { provider: resolved.provider, model: resolved.id };
			} catch {
				nextSelection = { model: requested };
			}
		} else {
			nextSelection = { model: requested };
		}
	}

	try {
		const resolvedModel = resolveConfiguredModel({
			...baseConfig,
			modelSelection: nextSelection,
		});
		const resolvedSelection = { provider: resolvedModel.provider, model: resolvedModel.id };
		saveChannelModelSelection(event.channel, resolvedSelection);
		refreshRunner(state, event.channel);
		log.logInfo(
			`[${event.channel}] Handling built-in command: model -> ${resolvedSelection.provider}/${resolvedSelection.model}`,
		);
		const text = `Switched model to \`${resolvedSelection.provider}/${resolvedSelection.model}\``;
		const ts = await slack.postMessage(event.channel, text);
		slack.logBotResponse(event.channel, text, ts);
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.logWarning(`[${event.channel}] Built-in model command failed`, message);
		const text = `Could not change model.\n\n${message}`;
		const ts = await slack.postMessage(event.channel, text);
		slack.logBotResponse(event.channel, text, ts);
		return true;
	}
}

async function handleApprovalCommand(event: SlackEvent, slack: SlackBot): Promise<boolean> {
	const parsed = parseApprovalCommand(event.text);
	if (!parsed) return false;

	if (!isSensitiveCommandApprover(workingDir, event.user)) {
		const text = "Only configured approvers can approve or deny sensitive command requests.";
		const ts = await slack.postMessage(event.channel, text);
		slack.logBotResponse(event.channel, text, ts);
		return true;
	}

	const user = slack.getUser(event.user);
	const channelDir = join(workingDir, event.channel);
	const approval =
		parsed.action === "approve"
			? approveSensitiveCommandRequest(workingDir, channelDir, parsed.id, event.user, user?.userName)
			: denySensitiveCommandRequest(workingDir, channelDir, parsed.id, event.user, user?.userName);

	if (!approval) {
		const text = `Could not find sensitive command request \`${parsed.id}\`.`;
		const ts = await slack.postMessage(event.channel, text);
		slack.logBotResponse(event.channel, text, ts);
		return true;
	}

	const requesterMention = `<@${approval.requesterId}>`;
	const text =
		parsed.action === "approve"
			? `Approved sensitive command request \`${approval.id}\` for ${requesterMention}. Ask Mom to retry the command.`
			: `Denied sensitive command request \`${approval.id}\` for ${requesterMention}.`;
	const ts = await slack.postMessage(event.channel, text);
	slack.logBotResponse(event.channel, text, ts);
	return true;
}

// ============================================================================
// Create SlackContext adapter
// ============================================================================

function createSlackContext(event: SlackEvent, slack: SlackBot, state: ChannelState, isEvent?: boolean) {
	let messageTs: string | null = null;
	const threadMessageTs: string[] = [];
	let accumulatedText = "";
	let isWorking = true;
	const workingIndicator = " ...";
	let updatePromise = Promise.resolve();

	const user = slack.getUser(event.user);

	// Extract event filename for status message
	const eventFilename = isEvent ? event.text.match(/^\[EVENT:([^:]+):/)?.[1] : undefined;

	return {
		message: {
			text: event.text,
			rawText: event.text,
			user: event.user,
			userName: user?.userName,
			channel: event.channel,
			ts: event.ts,
			attachments: (event.attachments || []).map((a) => ({ local: a.local })),
		},
		channelName: slack.getChannel(event.channel)?.name,
		store: state.store,
		channels: slack.getAllChannels().map((c) => ({ id: c.id, name: c.name })),
		users: slack.getAllUsers().map((u) => ({ id: u.id, userName: u.userName, displayName: u.displayName })),

		respond: async (text: string, shouldLog = true) => {
			updatePromise = updatePromise.then(async () => {
				try {
					accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;

					// Truncate accumulated text if too long (Slack limit is 40K, we use 35K for safety)
					const MAX_MAIN_LENGTH = 35000;
					const truncationNote = "\n\n_(message truncated, ask me to elaborate on specific parts)_";
					if (accumulatedText.length > MAX_MAIN_LENGTH) {
						accumulatedText =
							accumulatedText.substring(0, MAX_MAIN_LENGTH - truncationNote.length) + truncationNote;
					}

					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

					if (messageTs) {
						await slack.updateMessage(event.channel, messageTs, displayText);
					} else {
						messageTs = await slack.postMessage(event.channel, displayText);
					}

					if (shouldLog && messageTs) {
						slack.logBotResponse(event.channel, text, messageTs);
					}
				} catch (err) {
					log.logWarning("Slack respond error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		replaceMessage: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				try {
					// Replace the accumulated text entirely, with truncation
					const MAX_MAIN_LENGTH = 35000;
					const truncationNote = "\n\n_(message truncated, ask me to elaborate on specific parts)_";
					if (text.length > MAX_MAIN_LENGTH) {
						accumulatedText = text.substring(0, MAX_MAIN_LENGTH - truncationNote.length) + truncationNote;
					} else {
						accumulatedText = text;
					}

					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

					if (messageTs) {
						await slack.updateMessage(event.channel, messageTs, displayText);
					} else {
						messageTs = await slack.postMessage(event.channel, displayText);
					}
				} catch (err) {
					log.logWarning("Slack replaceMessage error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		respondInThread: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				try {
					if (messageTs) {
						// Truncate thread messages if too long (20K limit for safety)
						const MAX_THREAD_LENGTH = 20000;
						let threadText = text;
						if (threadText.length > MAX_THREAD_LENGTH) {
							threadText = `${threadText.substring(0, MAX_THREAD_LENGTH - 50)}\n\n_(truncated)_`;
						}

						const ts = await slack.postInThread(event.channel, messageTs, threadText);
						threadMessageTs.push(ts);
					}
				} catch (err) {
					log.logWarning("Slack respondInThread error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		setTyping: async (isTyping: boolean) => {
			if (isTyping && !messageTs) {
				updatePromise = updatePromise.then(async () => {
					try {
						if (!messageTs) {
							accumulatedText = eventFilename ? `_Starting event: ${eventFilename}_` : "_Thinking_";
							messageTs = await slack.postMessage(event.channel, accumulatedText + workingIndicator);
						}
					} catch (err) {
						log.logWarning("Slack setTyping error", err instanceof Error ? err.message : String(err));
					}
				});
				await updatePromise;
			}
		},

		uploadFile: async (filePath: string, title?: string) => {
			await slack.uploadFile(event.channel, filePath, title);
		},

		setWorking: async (working: boolean) => {
			updatePromise = updatePromise.then(async () => {
				try {
					isWorking = working;
					if (messageTs) {
						const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
						await slack.updateMessage(event.channel, messageTs, displayText);
					}
				} catch (err) {
					log.logWarning("Slack setWorking error", err instanceof Error ? err.message : String(err));
				}
			});
			await updatePromise;
		},

		deleteMessage: async () => {
			updatePromise = updatePromise.then(async () => {
				// Delete thread messages first (in reverse order)
				for (let i = threadMessageTs.length - 1; i >= 0; i--) {
					try {
						await slack.deleteMessage(event.channel, threadMessageTs[i]);
					} catch {
						// Ignore errors deleting thread messages
					}
				}
				threadMessageTs.length = 0;
				// Then delete main message
				if (messageTs) {
					await slack.deleteMessage(event.channel, messageTs);
					messageTs = null;
				}
			});
			await updatePromise;
		},
	};
}

// ============================================================================
// Handler
// ============================================================================

const handler: MomHandler = {
	isRunning(channelId: string): boolean {
		const state = channelStates.get(channelId);
		return state?.running ?? false;
	},

	async handleStop(channelId: string, slack: SlackBot): Promise<void> {
		const state = channelStates.get(channelId);
		if (state?.running) {
			state.stopRequested = true;
			state.runner.abort();
			const ts = await slack.postMessage(channelId, "_Stopping..._");
			state.stopMessageTs = ts; // Save for updating later
		} else {
			await slack.postMessage(channelId, "_Nothing running_");
		}
	},

	async handleEvent(event: SlackEvent, slack: SlackBot, isEvent?: boolean): Promise<void> {
		const state = getState(event.channel);
		refreshRunner(state, event.channel);

		if (!isEvent && (await handleApprovalCommand(event, slack))) {
			return;
		}

		if (!isEvent && (await handleModelCommand(event, slack))) {
			return;
		}

		// Start run
		state.running = true;
		state.stopRequested = false;

		log.logInfo(`[${event.channel}] Starting run: ${event.text.substring(0, 50)}`);

		try {
			// Create context adapter
			const ctx = createSlackContext(event, slack, state, isEvent);

			// Run the agent
			await ctx.setTyping(true);
			await ctx.setWorking(true);
			const result = await state.runner.run(ctx as any, state.store);
			await ctx.setWorking(false);

			if (result.stopReason === "aborted" && state.stopRequested) {
				if (state.stopMessageTs) {
					await slack.updateMessage(event.channel, state.stopMessageTs, "_Stopped_");
					state.stopMessageTs = undefined;
				} else {
					await slack.postMessage(event.channel, "_Stopped_");
				}
			}
		} catch (err) {
			log.logWarning(`[${event.channel}] Run error`, err instanceof Error ? err.message : String(err));
		} finally {
			state.running = false;
		}
	},
};

// ============================================================================
// Start
// ============================================================================

log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`, {
	provider: runnerConfig.modelSelection?.provider,
	model: runnerConfig.modelSelection?.model,
	authFile: runnerConfig.authFile,
	modelsFile: runnerConfig.modelsFile,
});

// Shared store for attachment downloads (also used per-channel in getState)
const sharedStore = new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN! });

const bot = new SlackBotClass(handler, {
	appToken: MOM_SLACK_APP_TOKEN,
	botToken: MOM_SLACK_BOT_TOKEN,
	workingDir,
	store: sharedStore,
});

// Start events watcher
const eventsWatcher = createEventsWatcher(workingDir, bot);
eventsWatcher.start();

// Handle shutdown
process.on("SIGINT", () => {
	log.logInfo("Shutting down...");
	eventsWatcher.stop();
	process.exit(0);
});

process.on("SIGTERM", () => {
	log.logInfo("Shutting down...");
	eventsWatcher.stop();
	process.exit(0);
});

bot.start();
