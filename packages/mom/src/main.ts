#!/usr/bin/env node

import { join, resolve } from "path";
import { type AgentRunner, createAgentRunner } from "./agent.js";
import { MomBot, type SlackContext } from "./slack.js";

console.log("Starting mom bot...");

const MOM_SLACK_APP_TOKEN = process.env.MOM_SLACK_APP_TOKEN;
const MOM_SLACK_BOT_TOKEN = process.env.MOM_SLACK_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_OAUTH_TOKEN = process.env.ANTHROPIC_OAUTH_TOKEN;

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length !== 1) {
	console.error("Usage: mom <working-directory>");
	console.error("Example: mom ./mom-data");
	process.exit(1);
}

const workingDir = resolve(args[0]);

if (!MOM_SLACK_APP_TOKEN || !MOM_SLACK_BOT_TOKEN || (!ANTHROPIC_API_KEY && !ANTHROPIC_OAUTH_TOKEN)) {
	console.error("Missing required environment variables:");
	if (!MOM_SLACK_APP_TOKEN) console.error("  - MOM_SLACK_APP_TOKEN (xapp-...)");
	if (!MOM_SLACK_BOT_TOKEN) console.error("  - MOM_SLACK_BOT_TOKEN (xoxb-...)");
	if (!ANTHROPIC_API_KEY && !ANTHROPIC_OAUTH_TOKEN) console.error("  - ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN");
	process.exit(1);
}

// Track active agent runs per channel
const activeRuns = new Map<string, AgentRunner>();

async function handleMessage(ctx: SlackContext, source: "channel" | "dm"): Promise<void> {
	const channelId = ctx.message.channel;
	const messageText = ctx.message.text.toLowerCase().trim();

	// Check for stop command
	if (messageText === "stop") {
		const runner = activeRuns.get(channelId);
		if (runner) {
			console.log(`Stop requested for channel ${channelId}`);
			runner.abort();
			await ctx.respond("_Stopping..._");
		} else {
			await ctx.respond("_Nothing running._");
		}
		return;
	}

	// Check if already running in this channel
	if (activeRuns.has(channelId)) {
		await ctx.respond("_Already working on something. Say `@mom stop` to cancel._");
		return;
	}

	console.log(`${source === "channel" ? "Channel mention" : "DM"} from <@${ctx.message.user}>: ${ctx.message.text}`);
	const channelDir = join(workingDir, channelId);

	const runner = createAgentRunner();
	activeRuns.set(channelId, runner);

	await ctx.setTyping(true);
	try {
		await runner.run(ctx, channelDir, ctx.store);
	} catch (error) {
		// Don't report abort errors
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes("aborted") || msg.includes("Aborted")) {
			// Already said "Stopping..." - nothing more to say
		} else {
			console.error("Agent error:", error);
			await ctx.respond(`❌ Error: ${msg}`);
		}
	} finally {
		activeRuns.delete(channelId);
	}
}

const bot = new MomBot(
	{
		async onChannelMention(ctx) {
			await handleMessage(ctx, "channel");
		},

		async onDirectMessage(ctx) {
			await handleMessage(ctx, "dm");
		},
	},
	{
		appToken: MOM_SLACK_APP_TOKEN,
		botToken: MOM_SLACK_BOT_TOKEN,
		workingDir,
	},
);

bot.start();
