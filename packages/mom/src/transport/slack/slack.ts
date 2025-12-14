import type { SlackBot, SlackEvent } from "../../slack.js";
import type { TransportContext } from "../types.js";

export interface CreateSlackContextArgs {
	workingDir: string;
	channelDir: string;
	event: SlackEvent;
	slack: SlackBot;
	isEvent?: boolean;
}

export function createSlackContext({
	workingDir,
	channelDir,
	event,
	slack,
	isEvent,
}: CreateSlackContextArgs): TransportContext {
	let messageTs: string | null = null;
	const threadMessageTs: string[] = [];
	let accumulatedText = "";
	let isWorking = true;
	const workingIndicator = " ...";
	let updatePromise = Promise.resolve();
	let primaryOverflowed = false;
	const primaryMaxChars = 39000;
	const secondaryMaxChars = 39000;
	const overflowSuffix = "\n\n_(continued in thread)_";

	const user = slack.getUser(event.user);
	const eventFilename = isEvent ? event.text.match(/^\[EVENT:([^:]+):/)?.[1] : undefined;

	function splitText(text: string, maxChars: number): string[] {
		const parts: string[] = [];
		let remaining = text;
		while (remaining.length > maxChars) {
			let cut = remaining.lastIndexOf("\n", maxChars);
			if (cut < Math.floor(maxChars * 0.6)) cut = maxChars;
			const head = remaining.slice(0, cut).trimEnd();
			if (head) parts.push(head);
			remaining = remaining.slice(cut);
			if (remaining.startsWith("\n")) remaining = remaining.slice(1);
		}
		const tail = remaining.trimEnd();
		if (tail) parts.push(tail);
		return parts;
	}

	async function ensurePrimaryMessage(): Promise<void> {
		if (messageTs) return;
		accumulatedText = eventFilename ? `_Starting event: ${eventFilename}_` : "_Thinking_";
		messageTs = await slack.postMessage(event.channel, accumulatedText + workingIndicator);
	}

	async function postToThread(text: string): Promise<void> {
		if (!text.trim()) return;
		await ensurePrimaryMessage();
		if (!messageTs) return;
		const parts = splitText(text, secondaryMaxChars);
		for (const part of parts) {
			const ts = await slack.postInThread(event.channel, messageTs, part);
			threadMessageTs.push(ts);
		}
	}

	async function updatePrimary(displayText: string, shouldLog: boolean, logText: string): Promise<void> {
		await ensurePrimaryMessage();
		if (messageTs) {
			await slack.updateMessage(event.channel, messageTs, displayText);
		} else {
			messageTs = await slack.postMessage(event.channel, displayText);
		}
		if (shouldLog && messageTs && logText) {
			slack.logBotResponse(event.channel, logText, messageTs);
		}
	}

	return {
		transport: "slack",
		workingDir,
		channelDir,
		message: {
			text: event.text,
			rawText: event.text,
			userId: event.user,
			userName: user?.userName,
			displayName: user?.displayName,
			channelId: event.channel,
			messageId: event.ts,
			attachments: (event.attachments || []).map((a) => ({ local: a.local })),
		},
		channelName: slack.getChannel(event.channel)?.name,
		channels: slack.getAllChannels().map((c) => ({ id: c.id, name: c.name })),
		users: slack.getAllUsers().map((u) => ({ id: u.id, userName: u.userName, displayName: u.displayName })),
		formatting: {
			italic: (text: string) => `_${text}_`,
			bold: (text: string) => `*${text}*`,
			code: (text: string) => `\`${text}\``,
			codeBlock: (text: string) => `\`\`\`\n${text}\n\`\`\``,
		},
		limits: {
			primaryMaxChars,
			secondaryMaxChars,
		},
		send: async (target, text, opts) => {
			const shouldLog = opts?.log ?? true;
			updatePromise = updatePromise.then(async () => {
				if (target === "secondary") {
					await postToThread(text);
					return;
				}

				if (primaryOverflowed) {
					await postToThread(text);
					return;
				}

				const nextText = accumulatedText ? accumulatedText + "\n" + text : text;
				const nextDisplayText = isWorking ? nextText + workingIndicator : nextText;

				if (nextDisplayText.length <= primaryMaxChars) {
					accumulatedText = nextText;
					await updatePrimary(nextDisplayText, shouldLog, text);
					return;
				}

				primaryOverflowed = true;

				const maxWithoutIndicator = primaryMaxChars - (isWorking ? workingIndicator.length : 0);
				const maxWithoutSuffix = maxWithoutIndicator - overflowSuffix.length;
				const head = maxWithoutSuffix > 0 ? nextText.slice(0, maxWithoutSuffix) : "";
				accumulatedText = head + overflowSuffix;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

				await updatePrimary(displayText, shouldLog, text);

				const overflow = nextText.slice(head.length);
				await postToThread(overflow);
			});
			await updatePromise;
		},
		replacePrimary: async (text) => {
			updatePromise = updatePromise.then(async () => {
				accumulatedText = text;
				primaryOverflowed = false;

				const maxWithoutIndicator = primaryMaxChars - (isWorking ? workingIndicator.length : 0);
				const maxWithoutSuffix = maxWithoutIndicator - overflowSuffix.length;
				if (accumulatedText.length > maxWithoutIndicator) {
					primaryOverflowed = true;
					accumulatedText =
						(maxWithoutSuffix > 0 ? accumulatedText.slice(0, maxWithoutSuffix) : "") + overflowSuffix;
				}

				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
				await updatePrimary(displayText, false, "");
			});
			await updatePromise;
		},
		setTyping: async (isTyping) => {
			if (isTyping && !messageTs) {
				updatePromise = updatePromise.then(async () => {
					await ensurePrimaryMessage();
				});
				await updatePromise;
			}
		},
		uploadFile: async (filePath, title) => {
			await slack.uploadFile(event.channel, filePath, title);
		},
		setWorking: async (working) => {
			updatePromise = updatePromise.then(async () => {
				isWorking = working;
				if (messageTs) {
					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
					await slack.updateMessage(event.channel, messageTs, displayText);
				}
			});
			await updatePromise;
		},
		deletePrimaryAndSecondary: async () => {
			updatePromise = updatePromise.then(async () => {
				for (let i = threadMessageTs.length - 1; i >= 0; i--) {
					try {
						await slack.deleteMessage(event.channel, threadMessageTs[i]);
					} catch {
						// ignore
					}
				}
				threadMessageTs.length = 0;
				if (messageTs) {
					await slack.deleteMessage(event.channel, messageTs);
					messageTs = null;
				}
				accumulatedText = "";
				primaryOverflowed = false;
			});
			await updatePromise;
		},
	};
}
