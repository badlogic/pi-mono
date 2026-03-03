/**
 * startMom — launch the mom Slack bot with optional extensions.
 * This is the main entry point for programmatic use.
 * For CLI usage, see main.ts which parses args and calls this.
 */

import { join } from "path";
import { type AgentExtension, type AgentRunner, getOrCreateRunner } from "./agent.js";
import { createEventsWatcher } from "./events.js";
import * as log from "./log.js";
import type { SandboxConfig } from "./sandbox.js";
import { validateSandbox } from "./sandbox.js";
import { type MomHandler, type SlackBot, SlackBot as SlackBotClass, type SlackEvent } from "./slack.js";
import { ChannelStore } from "./store.js";

export interface MomStartOptions {
	workingDir: string;
	sandbox: SandboxConfig;
	appToken: string;
	botToken: string;
	extensions?: AgentExtension[];
}

interface ChannelState {
	running: boolean;
	runner: AgentRunner;
	store: ChannelStore;
	stopRequested: boolean;
	stopMessageTs?: string;
}

function createSlackContext(event: SlackEvent, slack: SlackBot, state: ChannelState, isEvent?: boolean) {
	let messageTs: string | null = null;
	const threadMessageTs: string[] = [];
	let accumulatedText = "";
	let isWorking = true;
	const workingIndicator = " ...";
	let updatePromise = Promise.resolve();

	const user = slack.getUser(event.user);
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
				accumulatedText = accumulatedText ? `${accumulatedText}\n${text}` : text;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

				if (messageTs) {
					await slack.updateMessage(event.channel, messageTs, displayText);
				} else {
					messageTs = await slack.postMessage(event.channel, displayText);
				}

				if (shouldLog && messageTs) {
					slack.logBotResponse(event.channel, text, messageTs);
				}
			});
			await updatePromise;
		},

		replaceMessage: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				accumulatedText = text;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
				if (messageTs) {
					await slack.updateMessage(event.channel, messageTs, displayText);
				} else {
					messageTs = await slack.postMessage(event.channel, displayText);
				}
			});
			await updatePromise;
		},

		respondInThread: async (text: string) => {
			updatePromise = updatePromise.then(async () => {
				if (messageTs) {
					const ts = await slack.postInThread(event.channel, messageTs, text);
					threadMessageTs.push(ts);
				}
			});
			await updatePromise;
		},

		setTyping: async (isTyping: boolean) => {
			if (isTyping && !messageTs) {
				updatePromise = updatePromise.then(async () => {
					if (!messageTs) {
						accumulatedText = eventFilename ? `_Starting event: ${eventFilename}_` : "_Thinking_";
						messageTs = await slack.postMessage(event.channel, accumulatedText + workingIndicator);
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
				isWorking = working;
				if (messageTs) {
					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
					await slack.updateMessage(event.channel, messageTs, displayText);
				}
			});
			await updatePromise;
		},

		deleteMessage: async () => {
			updatePromise = updatePromise.then(async () => {
				for (let i = threadMessageTs.length - 1; i >= 0; i--) {
					try {
						await slack.deleteMessage(event.channel, threadMessageTs[i]);
					} catch {
						// Ignore errors deleting thread messages
					}
				}
				threadMessageTs.length = 0;
				if (messageTs) {
					await slack.deleteMessage(event.channel, messageTs);
					messageTs = null;
				}
			});
			await updatePromise;
		},
	};
}

export async function startMom(options: MomStartOptions): Promise<void> {
	const { workingDir, sandbox, appToken, botToken, extensions } = options;

	await validateSandbox(sandbox);

	const channelStates = new Map<string, ChannelState>();

	function getState(channelId: string): ChannelState {
		let state = channelStates.get(channelId);
		if (!state) {
			const channelDir = join(workingDir, channelId);
			state = {
				running: false,
				runner: getOrCreateRunner(sandbox, channelId, channelDir, extensions),
				store: new ChannelStore({ workingDir, botToken }),
				stopRequested: false,
			};
			channelStates.set(channelId, state);
		}
		return state;
	}

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

		handleSteer(channelId: string, event: SlackEvent, slack: SlackBot): void {
			const state = channelStates.get(channelId);
			if (!state?.running) return;

			const user = slack.getUser(event.user);
			const now = new Date();
			const pad = (n: number) => n.toString().padStart(2, "0");
			const offset = -now.getTimezoneOffset();
			const offsetSign = offset >= 0 ? "+" : "-";
			const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
			const offsetMins = pad(Math.abs(offset) % 60);
			const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;

			const text = `[${timestamp}] [${user?.userName || "unknown"}]: ${event.text}`;
			const userMessage = {
				role: "user" as const,
				content: [{ type: "text" as const, text }],
				timestamp: Date.now(),
			};

			state.runner.steer(userMessage);
			log.logInfo(`[${channelId}] Steered new message into running agent: ${event.text.substring(0, 50)}`);
			slack.postMessage(channelId, `_Received — adding to the current run._`).catch(() => {});
		},

		async handleEvent(event: SlackEvent, slack: SlackBot, isEvent?: boolean): Promise<void> {
			const state = getState(event.channel);
			state.running = true;
			state.stopRequested = false;

			log.logInfo(`[${event.channel}] Starting run: ${event.text.substring(0, 50)}`);

			try {
				const ctx = createSlackContext(event, slack, state, isEvent);
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

	log.logStartup(workingDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);

	const sharedStore = new ChannelStore({ workingDir, botToken });

	const bot = new SlackBotClass(handler, {
		appToken,
		botToken,
		workingDir,
		store: sharedStore,
	});

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
