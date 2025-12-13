#!/usr/bin/env node

import { join, resolve } from "path";
import { type AgentRunner, createAgentRunner } from "./agent.js";
import {
	createMemoryEditModal,
	getMemoryPath,
	readMemory,
	registerCommands,
	setupCommandHandlers,
	writeMemory,
} from "./commands.js";
import { type DiscordContext, MomDiscordBot } from "./discord.js";
import * as log from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_OAUTH_TOKEN = process.env.ANTHROPIC_OAUTH_TOKEN;

function parseArgs(): { workingDir: string; sandbox: SandboxConfig } {
	const args = process.argv.slice(2);
	let sandbox: SandboxConfig = { type: "host" };
	let workingDir: string | undefined;

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
		} else if (!arg.startsWith("-")) {
			workingDir = arg;
		} else {
			console.error(`Unknown option: ${arg}`);
			process.exit(1);
		}
	}

	if (!workingDir) {
		console.error("Usage: mom-discord [--sandbox=host|docker:<container-name>] <working-directory>");
		console.error("");
		console.error("Options:");
		console.error("  --sandbox=host                  Run tools directly on host (default)");
		console.error("  --sandbox=docker:<container>    Run tools in Docker container");
		console.error("");
		console.error("Examples:");
		console.error("  mom-discord ./data");
		console.error("  mom-discord --sandbox=docker:mom-sandbox ./data");
		process.exit(1);
	}

	return { workingDir: resolve(workingDir), sandbox };
}

const { workingDir, sandbox } = parseArgs();

log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);

if (!DISCORD_BOT_TOKEN || (!ANTHROPIC_API_KEY && !ANTHROPIC_OAUTH_TOKEN)) {
	console.error("Missing required environment variables:");
	if (!DISCORD_BOT_TOKEN) console.error("  - DISCORD_BOT_TOKEN");
	if (!ANTHROPIC_API_KEY && !ANTHROPIC_OAUTH_TOKEN) console.error("  - ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN");
	process.exit(1);
}

await validateSandbox(sandbox);

// Track active agent runs per channel
const activeRuns = new Map<string, { runner: AgentRunner; context: DiscordContext; stopContext?: DiscordContext }>();

async function handleMessage(ctx: DiscordContext, _source: "channel" | "dm"): Promise<void> {
	const channelId = ctx.message.channel;
	const messageText = ctx.message.text.toLowerCase().trim();

	const logCtx = {
		channelId: ctx.message.channel,
		userName: ctx.message.userName,
		channelName: ctx.channelName,
		guildName: ctx.guildName,
	};

	// Check for stop command
	if (messageText === "stop") {
		const active = activeRuns.get(channelId);
		if (active) {
			log.logStopRequest(logCtx);
			await ctx.respond("*Stopping...*");
			active.stopContext = ctx;
			active.runner.abort();
		} else {
			await ctx.respond("*Nothing running.*");
		}
		return;
	}

	// Check if already running in this channel
	if (activeRuns.has(channelId)) {
		await ctx.respond("*Already working on something. Say `@mom stop` to cancel.*");
		return;
	}

	log.logUserMessage(logCtx, ctx.message.text);

	// Build channel directory path
	const channelDir = ctx.message.guild ? join(workingDir, ctx.message.guild, channelId) : join(workingDir, channelId);

	const runner = createAgentRunner(sandbox);
	activeRuns.set(channelId, { runner, context: ctx });

	await ctx.setTyping(true);
	await ctx.setWorking(true);

	const result = await runner.run(ctx, channelDir, ctx.store);

	await ctx.setWorking(false);

	const active = activeRuns.get(channelId);
	if (result.stopReason === "aborted") {
		if (active?.stopContext) {
			await active.stopContext.setWorking(false);
			await active.stopContext.replaceMessage("*Stopped*");
		}
	} else if (result.stopReason === "error") {
		log.logAgentError(logCtx, "Agent stopped with error");
	}

	activeRuns.delete(channelId);
}

const bot = new MomDiscordBot(
	{
		async onMention(ctx) {
			await handleMessage(ctx, "channel");
		},

		async onDirectMessage(ctx) {
			await handleMessage(ctx, "dm");
		},

		async onStopButton(channelId) {
			const active = activeRuns.get(channelId);
			if (active) {
				const logCtx = {
					channelId,
					userName: active.context.message.userName,
					channelName: active.context.channelName,
					guildName: active.context.guildName,
				};
				log.logStopRequest(logCtx);
				active.runner.abort();
			}
		},
	},
	{
		botToken: DISCORD_BOT_TOKEN,
		workingDir,
	},
);

// Set up slash command handlers
setupCommandHandlers(
	bot.getClient(),
	{
		async onMomCommand(interaction) {
			const messageText = interaction.options.getString("message", true);
			const channelId = interaction.channelId;

			// Check if already running
			if (activeRuns.has(channelId)) {
				await interaction.reply({
					content: "*Already working on something. Use `/mom-stop` to cancel.*",
					ephemeral: true,
				});
				return;
			}

			// Defer reply to allow long-running operations
			await interaction.deferReply();

			const logCtx = {
				channelId,
				userName: interaction.user.username,
				channelName:
					interaction.channel?.isTextBased() && !interaction.channel.isDMBased()
						? (interaction.channel as any).name
						: undefined,
				guildName: interaction.guild?.name,
			};

			log.logUserMessage(logCtx, messageText);

			// Build channel directory path
			const channelDir = interaction.guildId
				? join(workingDir, interaction.guildId, channelId)
				: join(workingDir, channelId);

			// Create context from interaction
			const ctx = await bot.createContextFromInteraction(interaction, messageText);

			// Log the slash command message to store so agent can see it
			await ctx.store.logMessage(
				channelId,
				{
					date: new Date().toISOString(),
					ts: interaction.id,
					user: interaction.user.id,
					userName: interaction.user.username,
					text: messageText,
					attachments: [],
					isBot: false,
				},
				interaction.guildId || undefined,
			);

			const runner = createAgentRunner(sandbox);
			activeRuns.set(channelId, { runner, context: ctx });

			await ctx.setTyping(true);
			await ctx.setWorking(true);

			const result = await runner.run(ctx, channelDir, ctx.store);

			await ctx.setWorking(false);

			if (result.stopReason === "error") {
				log.logAgentError(logCtx, "Agent stopped with error");
			}

			activeRuns.delete(channelId);
		},

		async onStopCommand(interaction) {
			const channelId = interaction.channelId;
			const active = activeRuns.get(channelId);

			if (active) {
				const logCtx = {
					channelId,
					userName: interaction.user.username,
					channelName:
						interaction.channel?.isTextBased() && !interaction.channel.isDMBased()
							? (interaction.channel as any).name
							: undefined,
					guildName: interaction.guild?.name,
				};
				log.logStopRequest(logCtx);
				active.runner.abort();
				await interaction.reply("*Stopping...*");
			} else {
				await interaction.reply({ content: "*Nothing running.*", ephemeral: true });
			}
		},

		async onMemoryCommand(interaction) {
			const action = interaction.options.getString("action", true) as "view" | "edit";
			const scope = (interaction.options.getString("scope") || "channel") as "channel" | "global";
			const channelId = interaction.channelId;
			const guildId = interaction.guildId || undefined;

			const memoryPath = getMemoryPath(workingDir, channelId, guildId, scope);
			const content = readMemory(memoryPath);

			if (action === "view") {
				const truncated = content.length > 1900 ? content.substring(0, 1897) + "..." : content;
				await interaction.reply({
					content: `**${scope === "global" ? "Global" : "Channel"} Memory:**\n\`\`\`\n${truncated}\n\`\`\``,
					ephemeral: true,
				});
			} else {
				// Show modal for editing
				const modal = createMemoryEditModal(scope, content, channelId);
				await interaction.showModal(modal);
			}
		},

		async onMemoryEditSubmit(interaction) {
			const customId = interaction.customId;
			const [, , scope, channelId] = customId.split("-");
			const guildId = interaction.guildId || undefined;

			const newContent = interaction.fields.getTextInputValue("memory-content");
			const memoryPath = getMemoryPath(workingDir, channelId, guildId, scope as "channel" | "global");

			try {
				await writeMemory(memoryPath, newContent);
				await interaction.reply({
					content: `*${scope === "global" ? "Global" : "Channel"} memory updated.*`,
					ephemeral: true,
				});
			} catch (error) {
				await interaction.reply({
					content: `*Failed to update memory: ${error instanceof Error ? error.message : String(error)}*`,
					ephemeral: true,
				});
			}
		},
	},
	workingDir,
);

// Register slash commands once the client is ready
bot.getClient().once("ready", async () => {
	const clientId = bot.getClient().user?.id;
	if (clientId) {
		try {
			// Register commands globally (for production)
			// Use guildId param for faster development testing
			await registerCommands(clientId, DISCORD_BOT_TOKEN);
			log.logInfo("Slash commands registered");
		} catch (error) {
			log.logWarning("Failed to register slash commands", String(error));
		}
	}
});

bot.start();
