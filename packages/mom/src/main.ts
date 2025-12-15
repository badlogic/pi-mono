#!/usr/bin/env node

import type { ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { join, resolve } from "path";
import { type AgentRunner, getOrCreateRunner, getOrCreateRunnerForTransport, initializeModel } from "./agent.js";
import { MomSettingsManager, syncLogToContext } from "./context.js";
import { downloadChannel } from "./download.js";
import { createEventsWatcher } from "./events.js";
import * as log from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import { type MomHandler, type SlackBot, SlackBot as SlackBotClass, type SlackEvent } from "./slack.js";
import { ChannelStore } from "./store.js";
import type { ProfileRuntime } from "./tools/profile.js";
import {
	createMemoryEditModal,
	getMemoryPath,
	MomDiscordBot,
	readMemory,
	registerCommands,
	setupCommandHandlers,
	writeMemory,
} from "./transport/discord/index.js";
import { createSlackContext } from "./transport/slack/index.js";
import type { TransportContext } from "./transport/types.js";

type TransportArg = "slack" | "discord";

// ============================================================================
// Config
// ============================================================================

const MOM_SLACK_APP_TOKEN = process.env.MOM_SLACK_APP_TOKEN;
const MOM_SLACK_BOT_TOKEN = process.env.MOM_SLACK_BOT_TOKEN;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_OAUTH_TOKEN = process.env.ANTHROPIC_OAUTH_TOKEN;

interface ParsedArgs {
	workingDir?: string;
	sandbox: SandboxConfig;
	downloadChannel?: string;
	transport: TransportArg;
	model?: string;
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2);
	let sandbox: SandboxConfig = { type: "host" };
	let workingDir: string | undefined;
	let downloadChannelId: string | undefined;
	let transport: TransportArg = "slack";
	let model: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--sandbox=")) {
			sandbox = parseSandboxArg(arg.slice("--sandbox=".length));
		} else if (arg === "--sandbox") {
			const next = args[++i];
			if (!next) {
				console.error("Error: --sandbox requires a value (host or docker:<container-name>)");
				process.exit(1);
			}
			sandbox = parseSandboxArg(next);
		} else if (arg.startsWith("--transport=")) {
			const value = arg.slice("--transport=".length);
			if (value !== "slack" && value !== "discord") {
				console.error("Error: --transport must be 'slack' or 'discord'");
				process.exit(1);
			}
			transport = value;
		} else if (arg === "--transport") {
			const next = args[++i];
			if (!next) {
				console.error("Error: --transport requires a value (slack or discord)");
				process.exit(1);
			}
			if (next !== "slack" && next !== "discord") {
				console.error("Error: --transport must be 'slack' or 'discord'");
				process.exit(1);
			}
			transport = next;
		} else if (arg.startsWith("--download=")) {
			downloadChannelId = arg.slice("--download=".length);
		} else if (arg === "--download") {
			const next = args[++i];
			if (!next) {
				console.error("Error: --download requires a channel id");
				process.exit(1);
			}
			downloadChannelId = next;
		} else if (arg.startsWith("--model=")) {
			model = arg.slice("--model=".length);
		} else if (arg === "--model") {
			const next = args[++i];
			if (!next) {
				console.error("Error: --model requires a value (e.g., anthropic:claude-sonnet-4-5)");
				process.exit(1);
			}
			model = next;
		} else if (!arg.startsWith("-")) {
			workingDir = arg;
		} else {
			console.error(`Unknown option: ${arg}`);
			process.exit(1);
		}
	}

	return {
		workingDir: workingDir ? resolve(workingDir) : undefined,
		sandbox,
		downloadChannel: downloadChannelId,
		transport,
		model,
	};
}

const parsedArgs = parseArgs();

// Handle Slack-only download mode
if (parsedArgs.downloadChannel) {
	if (!MOM_SLACK_BOT_TOKEN) {
		console.error("Missing env: MOM_SLACK_BOT_TOKEN");
		process.exit(1);
	}
	await downloadChannel(parsedArgs.downloadChannel, MOM_SLACK_BOT_TOKEN);
	process.exit(0);
}

if (!parsedArgs.workingDir) {
	console.error("Usage: mom [options] <working-directory>");
	console.error("");
	console.error("Options:");
	console.error("  --transport=slack|discord     Transport to use (default: slack)");
	console.error("  --sandbox=host|docker:<name>  Sandbox mode (default: host)");
	console.error("  --model=provider:model-id     Model to use (default: anthropic:claude-sonnet-4-5)");
	console.error("  --download <channel-id>       Download Slack channel history (Slack only)");
	console.error("");
	console.error("Environment variables:");
	console.error("  MOM_MODEL                     Default model (overridden by --model)");
	process.exit(1);
}

const workingDir = parsedArgs.workingDir;
const sandbox = parsedArgs.sandbox;
const transport = parsedArgs.transport;

if (!ANTHROPIC_API_KEY && !ANTHROPIC_OAUTH_TOKEN) {
	console.error("Missing env: ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN");
	process.exit(1);
}

try {
	initializeModel(parsedArgs.model, workingDir);
} catch (err) {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
}

await validateSandbox(sandbox);

if (transport === "discord") {
	await startDiscordBot({ workingDir, sandbox });
} else {
	await startSlackBot({ workingDir, sandbox });
}

// ============================================================================
// Slack transport
// ============================================================================

async function startSlackBot({ workingDir, sandbox }: { workingDir: string; sandbox: SandboxConfig }): Promise<void> {
	if (!MOM_SLACK_APP_TOKEN || !MOM_SLACK_BOT_TOKEN) {
		console.error("Missing env: MOM_SLACK_APP_TOKEN, MOM_SLACK_BOT_TOKEN");
		process.exit(1);
	}

	log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);
	const settingsManager = new MomSettingsManager(workingDir);

	// ============================================================================
	// State (per channel)
	// ============================================================================

	interface ChannelState {
		running: boolean;
		runner: AgentRunner;
		stopRequested: boolean;
		stopMessageTs?: string;
	}

	const channelStates = new Map<string, ChannelState>();
	let slackBot: SlackBotClass | null = null;

	const getProfileRuntime = (): ProfileRuntime | null => {
		const bot = slackBot;
		if (!bot) return null;
		return {
			updateSlackProfile: async (updates) => {
				settingsManager.setSlackProfile(updates);
				bot.setProfileOverrides(updates);
				return { success: true, message: "Slack profile overrides updated" };
			},
		};
	};

	function getState(channelId: string): ChannelState {
		let state = channelStates.get(channelId);
		if (!state) {
			const channelDir = join(workingDir, channelId);
			state = {
				running: false,
				runner: getOrCreateRunner(sandbox, channelId, channelDir, getProfileRuntime),
				stopRequested: false,
			};
			channelStates.set(channelId, state);
		}
		return state;
	}

	// ============================================================================
	// Create Slack TransportContext adapter
	// ============================================================================

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
				state.stopMessageTs = ts;
			} else {
				await slack.postMessage(channelId, "_Nothing running_");
			}
		},

		async handleEvent(event: SlackEvent, slack: SlackBot, isEvent?: boolean): Promise<void> {
			const state = getState(event.channel);
			const channelDir = join(workingDir, event.channel);

			state.running = true;
			state.stopRequested = false;

			log.logInfo(`[${event.channel}] Starting run: ${event.text.substring(0, 50)}`);

			try {
				const syncedCount = syncLogToContext(channelDir, { mode: "slack", excludeAfterTs: event.ts });
				if (syncedCount > 0) {
					log.logInfo(`[${event.channel}] Synced ${syncedCount} messages from log to context`);
				}

				const ctx = createSlackContext({
					workingDir,
					channelDir,
					event,
					slack,
					isEvent,
				});

				await ctx.setTyping(true);
				await ctx.setWorking(true);
				const result = await state.runner.run(ctx);
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

	log.logInfo(`Starting Slack transport (socket mode) in ${workingDir}`);

	const sharedStore = new ChannelStore({ workingDir, botToken: MOM_SLACK_BOT_TOKEN });

	const bot = new SlackBotClass(handler, {
		appToken: MOM_SLACK_APP_TOKEN,
		botToken: MOM_SLACK_BOT_TOKEN,
		workingDir,
		store: sharedStore,
		settingsManager,
	});
	slackBot = bot;

	const eventsWatcher = createEventsWatcher(workingDir, bot);
	eventsWatcher.start();

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
}

// ============================================================================
// Discord transport
// ============================================================================

async function startDiscordBot({ workingDir, sandbox }: { workingDir: string; sandbox: SandboxConfig }): Promise<void> {
	if (!DISCORD_BOT_TOKEN) {
		console.error("Missing env: DISCORD_BOT_TOKEN");
		process.exit(1);
	}

	log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);
	const settingsManager = new MomSettingsManager(workingDir);

	type ActiveRun = { runner: AgentRunner; stopRequested: boolean; stopContext?: TransportContext };
	const activeRuns = new Map<string, ActiveRun>();

	const toRunnerKey = (channelId: string) => `discord:${channelId}`;

	const formatLogCtx = (ctx: TransportContext) => {
		const channelName = ctx.channelName
			? ctx.guildName
				? `${ctx.guildName}#${ctx.channelName}`
				: ctx.channelName
			: undefined;
		return { channelId: ctx.message.channelId, userName: ctx.message.userName, channelName };
	};

	const handleDiscordContext = async (ctx: TransportContext): Promise<void> => {
		const runnerKey = toRunnerKey(ctx.message.channelId);
		const logCtx = formatLogCtx(ctx);
		const messageText = ctx.message.text.trim().toLowerCase();

		if (messageText === "stop") {
			const active = activeRuns.get(runnerKey);
			if (active) {
				log.logStopRequest(logCtx);
				await ctx.setTyping(true);
				await ctx.replacePrimary(ctx.formatting.italic("Stopping..."));
				active.stopRequested = true;
				active.stopContext = ctx;
				active.runner.abort();
			} else {
				await ctx.setTyping(true);
				await ctx.replacePrimary(ctx.formatting.italic("Nothing running."));
			}
			return;
		}

		if (activeRuns.has(runnerKey)) {
			await ctx.setTyping(true);
			await ctx.replacePrimary(
				ctx.formatting.italic("Already working on something. Say `@mom stop` or use `/mom-stop`."),
			);
			return;
		}

		log.logUserMessage(logCtx, ctx.message.text);

		const runner = getOrCreateRunnerForTransport(sandbox, "discord", runnerKey, ctx.channelDir, workingDir, () => ({
			updateDiscordProfile: async (updates) => bot.updateProfile(updates),
		}));
		activeRuns.set(runnerKey, { runner, stopRequested: false });

		try {
			await ctx.setTyping(true);
			await ctx.setWorking(true);
			const result = await runner.run(ctx);
			await ctx.setWorking(false);

			const active = activeRuns.get(runnerKey);
			if (result.stopReason === "aborted" && active?.stopRequested) {
				if (active.stopContext) {
					try {
						await active.stopContext.setWorking(false);
						await active.stopContext.replacePrimary(active.stopContext.formatting.italic("Stopped."));
					} catch {
						// ignore
					}
				}
				try {
					await ctx.replacePrimary(ctx.formatting.italic("Stopped."));
				} catch {
					// ignore
				}
			}
		} catch (error) {
			log.logAgentError(logCtx, error instanceof Error ? error.message : String(error));
			try {
				await ctx.setWorking(false);
				await ctx.send(
					"secondary",
					ctx.formatting.italic(`Error: ${error instanceof Error ? error.message : String(error)}`),
					{
						log: false,
					},
				);
			} catch {
				// ignore
			}
		} finally {
			activeRuns.delete(runnerKey);
		}
	};

	const bot = new MomDiscordBot(
		{
			async onMention(ctx) {
				await handleDiscordContext(ctx);
			},
			async onDirectMessage(ctx) {
				await handleDiscordContext(ctx);
			},
			async onStopButton(channelId) {
				const active = activeRuns.get(toRunnerKey(channelId));
				if (active) {
					active.stopRequested = true;
					active.runner.abort();
				}
			},
			async onEvent(ctx, _isEvent) {
				const runnerKey = toRunnerKey(ctx.message.channelId);
				const maxWaitMs = 5 * 60 * 1000;
				const pollIntervalMs = 2000;
				const startTime = Date.now();

				while (activeRuns.has(runnerKey)) {
					if (Date.now() - startTime > maxWaitMs) {
						log.logWarning(
							`Event timed out waiting for agent: ${ctx.message.channelId}`,
							ctx.message.text.substring(0, 50),
						);
						return;
					}
					await new Promise((r) => setTimeout(r, pollIntervalMs));
				}

				await handleDiscordContext(ctx);
			},
		},
		{ botToken: DISCORD_BOT_TOKEN, workingDir, settingsManager },
	);

	// Slash command handlers
	setupCommandHandlers(bot.getClient(), {
		async onMomCommand(interaction: ChatInputCommandInteraction) {
			const messageText = interaction.options.getString("message", true);
			const channelId = interaction.channelId;
			const runnerKey = toRunnerKey(channelId);

			const isDM = interaction.guildId === null;
			if (isDM && !settingsManager.canUserDM(interaction.user.id)) {
				return;
			}

			if (activeRuns.has(runnerKey)) {
				await interaction.reply({
					content: "Already working on something. Use `/mom-stop` to cancel.",
					ephemeral: true,
				});
				return;
			}

			await interaction.deferReply();

			const ctx = await bot.createContextFromInteraction(interaction, messageText, workingDir);

			await bot.store.logMessage(
				channelId,
				{
					date: new Date().toISOString(),
					ts: interaction.id,
					user: interaction.user.id,
					userName: interaction.user.username,
					displayName: interaction.user.displayName || interaction.user.username,
					text: messageText,
					attachments: [],
					isBot: false,
				},
				interaction.guildId || undefined,
			);

			log.logUserMessage(formatLogCtx(ctx), messageText);

			const runner = getOrCreateRunnerForTransport(
				sandbox,
				"discord",
				runnerKey,
				ctx.channelDir,
				workingDir,
				() => ({
					updateDiscordProfile: async (updates) => bot.updateProfile(updates),
				}),
			);
			activeRuns.set(runnerKey, { runner, stopRequested: false });

			try {
				await ctx.setTyping(true);
				await ctx.setWorking(true);
				const result = await runner.run(ctx);
				await ctx.setWorking(false);
				const active = activeRuns.get(runnerKey);
				if (result.stopReason === "aborted" && active?.stopRequested) {
					try {
						await ctx.replacePrimary(ctx.formatting.italic("Stopped."));
					} catch {
						// ignore
					}
				}
			} finally {
				activeRuns.delete(runnerKey);
			}
		},

		async onStopCommand(interaction: ChatInputCommandInteraction) {
			const channelId = interaction.channelId;
			const runnerKey = toRunnerKey(channelId);
			const active = activeRuns.get(runnerKey);
			if (active) {
				active.stopRequested = true;
				active.runner.abort();
				await interaction.reply({ content: "Stopping...", ephemeral: true });
			} else {
				await interaction.reply({ content: "Nothing running.", ephemeral: true });
			}
		},

		async onMemoryCommand(interaction: ChatInputCommandInteraction) {
			const action = interaction.options.getString("action", true);
			const scope = (interaction.options.getString("scope") || "channel") as "channel" | "global";
			const channelId = interaction.channelId;
			const guildId = interaction.guildId || undefined;

			const memoryPath = getMemoryPath(workingDir, channelId, guildId, scope);
			const current = readMemory(memoryPath);

			if (action === "view") {
				const max = 1800;
				const shown = current.length > max ? current.slice(0, max) + "\n\n(truncated)" : current;
				await interaction.reply({ content: "```markdown\n" + shown + "\n```", ephemeral: true });
				return;
			}

			if (action === "edit") {
				const modal = createMemoryEditModal(scope, current, channelId);
				await interaction.showModal(modal);
			}
		},

		async onMemoryEditSubmit(interaction: ModalSubmitInteraction) {
			const customId = interaction.customId;
			const [, , scope, channelId] = customId.split("-");
			const guildId = interaction.guildId || undefined;

			const newContent = interaction.fields.getTextInputValue("memory-content");
			const memoryPath = getMemoryPath(workingDir, channelId, guildId, scope as "channel" | "global");

			try {
				await writeMemory(memoryPath, newContent);
				await interaction.reply({
					content: `${scope === "global" ? "Global" : "Channel"} memory updated.`,
					ephemeral: true,
				});
			} catch (error) {
				await interaction.reply({
					content: `Failed to update memory: ${error instanceof Error ? error.message : String(error)}`,
					ephemeral: true,
				});
			}
		},
	});

	// Register slash commands on ready (global by default)
	bot.getClient().once("ready", async () => {
		const clientId = bot.getClient().user?.id;
		if (!clientId) return;
		try {
			await registerCommands(clientId, DISCORD_BOT_TOKEN);
			log.logInfo("Discord slash commands registered");
		} catch (error) {
			log.logWarning("Failed to register Discord slash commands", String(error));
		}
	});

	const eventsWatcher = createEventsWatcher(workingDir, bot);

	process.on("SIGINT", () => {
		log.logInfo("Shutting down...");
		eventsWatcher.stop();
		void bot.stop().finally(() => process.exit(0));
	});

	process.on("SIGTERM", () => {
		log.logInfo("Shutting down...");
		eventsWatcher.stop();
		void bot.stop().finally(() => process.exit(0));
	});

	log.logInfo(`Starting Discord transport in ${workingDir}`);
	await bot.start(DISCORD_BOT_TOKEN);
	eventsWatcher.start();
}
