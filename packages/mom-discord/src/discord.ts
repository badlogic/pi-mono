import {
	Client,
	GatewayIntentBits,
	type Message,
	type TextChannel,
	type DMChannel,
	type NewsChannel,
	AttachmentBuilder,
	ChannelType,
	type Guild,
	type GuildMember,
} from "discord.js";
import { readFileSync } from "fs";
import { basename } from "path";
import * as log from "./log.js";
import { type Attachment, ChannelStore } from "./store.js";

export interface DiscordMessage {
	text: string; // message content (mentions stripped)
	rawText: string; // original text with mentions
	user: string; // user ID
	userName?: string; // Discord username
	displayName?: string; // Discord display name
	channel: string; // channel ID
	guild?: string; // guild ID (undefined for DMs)
	ts: string; // message ID (used as timestamp)
	attachments: Attachment[];
}

export interface DiscordContext {
	message: DiscordMessage;
	channelName?: string;
	guildName?: string;
	store: ChannelStore;
	channels: ChannelInfo[];
	users: UserInfo[];
	/** Send/update the main message (accumulates text). Set log=false to skip logging. */
	respond(text: string, log?: boolean): Promise<void>;
	/** Replace the entire message text (not append) */
	replaceMessage(text: string): Promise<void>;
	/** Post a follow-up message (for verbose details) */
	respondFollowUp(text: string): Promise<void>;
	/** Show typing indicator */
	setTyping(isTyping: boolean): Promise<void>;
	/** Upload a file to the channel */
	uploadFile(filePath: string, title?: string): Promise<void>;
	/** Set working state (adds/removes working indicator) */
	setWorking(working: boolean): Promise<void>;
}

export interface MomDiscordHandler {
	onMention(ctx: DiscordContext): Promise<void>;
	onDirectMessage(ctx: DiscordContext): Promise<void>;
}

export interface MomDiscordConfig {
	botToken: string;
	workingDir: string;
}

export interface ChannelInfo {
	id: string;
	name: string;
}

export interface UserInfo {
	id: string;
	userName: string;
	displayName: string;
}

export class MomDiscordBot {
	private client: Client;
	private handler: MomDiscordHandler;
	public readonly store: ChannelStore;
	private botUserId: string | null = null;
	private userCache: Map<string, { userName: string; displayName: string }> = new Map();
	private channelCache: Map<string, string> = new Map();
	private config: MomDiscordConfig;

	constructor(handler: MomDiscordHandler, config: MomDiscordConfig) {
		this.handler = handler;
		this.config = config;
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMembers,
			],
		});
		this.store = new ChannelStore({
			workingDir: config.workingDir,
			botToken: config.botToken,
		});

		this.setupEventHandlers();
	}

	private async fetchGuildData(guild: Guild): Promise<void> {
		try {
			// Fetch channels
			const channels = await guild.channels.fetch();
			for (const [id, channel] of channels) {
				if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildForum)) {
					this.channelCache.set(id, channel.name);
				}
			}

			// Fetch members (limited)
			const members = await guild.members.fetch({ limit: 1000 });
			for (const [id, member] of members) {
				this.userCache.set(id, {
					userName: member.user.username,
					displayName: member.displayName || member.user.username,
				});
			}
		} catch (error) {
			log.logWarning(`Failed to fetch data for guild ${guild.name}`, String(error));
		}
	}

	getChannels(): ChannelInfo[] {
		return Array.from(this.channelCache.entries()).map(([id, name]) => ({ id, name }));
	}

	getUsers(): UserInfo[] {
		return Array.from(this.userCache.entries()).map(([id, { userName, displayName }]) => ({
			id,
			userName,
			displayName,
		}));
	}

	private async getUserInfo(userId: string, guild?: Guild): Promise<{ userName: string; displayName: string }> {
		if (this.userCache.has(userId)) {
			return this.userCache.get(userId)!;
		}

		try {
			if (guild) {
				const member = await guild.members.fetch(userId);
				const info = {
					userName: member.user.username,
					displayName: member.displayName || member.user.username,
				};
				this.userCache.set(userId, info);
				return info;
			}

			const user = await this.client.users.fetch(userId);
			const info = {
				userName: user.username,
				displayName: user.displayName || user.username,
			};
			this.userCache.set(userId, info);
			return info;
		} catch {
			return { userName: userId, displayName: userId };
		}
	}

	private setupEventHandlers(): void {
		this.client.on("ready", async () => {
			this.botUserId = this.client.user?.id || null;
			log.logInfo(`Logged in as ${this.client.user?.tag}`);

			// Fetch data for all guilds
			for (const [, guild] of this.client.guilds.cache) {
				await this.fetchGuildData(guild);
			}
			log.logInfo(`Loaded ${this.channelCache.size} channels, ${this.userCache.size} users`);
			log.logConnected();
		});

		this.client.on("messageCreate", async (message: Message) => {
			// Ignore bot messages
			if (message.author.bot) return;

			// Ignore messages from the bot itself
			if (message.author.id === this.botUserId) return;

			const isDM = message.channel.type === ChannelType.DM;
			const isMentioned = message.mentions.has(this.client.user!);

			// Log all messages
			await this.logMessage(message);

			// Only handle DMs or mentions
			if (isDM) {
				const ctx = await this.createContext(message);
				await this.handler.onDirectMessage(ctx);
			} else if (isMentioned) {
				const ctx = await this.createContext(message);
				await this.handler.onMention(ctx);
			}
		});

		this.client.on("guildCreate", async (guild: Guild) => {
			log.logInfo(`Joined guild: ${guild.name}`);
			await this.fetchGuildData(guild);
		});
	}

	private async logMessage(message: Message): Promise<void> {
		const attachments = message.attachments.size > 0
			? this.store.processAttachments(
				message.channel.id,
				Array.from(message.attachments.values()).map(a => ({ name: a.name, url: a.url })),
				message.id,
				message.guild?.id,
			)
			: [];

		const { userName, displayName } = await this.getUserInfo(message.author.id, message.guild || undefined);

		await this.store.logMessage(
			message.channel.id,
			{
				date: message.createdAt.toISOString(),
				ts: message.id,
				user: message.author.id,
				userName,
				displayName,
				text: message.content,
				attachments,
				isBot: false,
			},
			message.guild?.id,
		);
	}

	private async createContext(message: Message): Promise<DiscordContext> {
		const rawText = message.content;
		// Strip bot mentions from text
		const text = rawText.replace(/<@!?\d+>/g, "").trim();

		const { userName, displayName } = await this.getUserInfo(message.author.id, message.guild || undefined);

		const channelName = message.channel.type === ChannelType.DM
			? undefined
			: (message.channel as TextChannel).name;

		const guildName = message.guild?.name;

		const attachments = message.attachments.size > 0
			? this.store.processAttachments(
				message.channel.id,
				Array.from(message.attachments.values()).map(a => ({ name: a.name, url: a.url })),
				message.id,
				message.guild?.id,
			)
			: [];

		let responseMessage: Message | null = null;
		let accumulatedText = "";
		let isWorking = true;
		const workingIndicator = " ...";

		const channel = message.channel as TextChannel | DMChannel | NewsChannel;

		// Helper to split long messages (Discord limit is 2000 chars)
		const splitMessage = (text: string): string[] => {
			const MAX_LENGTH = 2000;
			if (text.length <= MAX_LENGTH) return [text];

			const parts: string[] = [];
			let remaining = text;
			while (remaining.length > 0) {
				const chunk = remaining.substring(0, MAX_LENGTH - 50);
				remaining = remaining.substring(MAX_LENGTH - 50);
				const suffix = remaining.length > 0 ? "\n*(continued...)*" : "";
				parts.push(chunk + suffix);
			}
			return parts;
		};

		return {
			message: {
				text,
				rawText,
				user: message.author.id,
				userName,
				displayName,
				channel: message.channel.id,
				guild: message.guild?.id,
				ts: message.id,
				attachments,
			},
			channelName,
			guildName,
			store: this.store,
			channels: this.getChannels(),
			users: this.getUsers(),

			respond: async (responseText: string, shouldLog = true) => {
				if (!accumulatedText) {
					accumulatedText = responseText;
				} else {
					accumulatedText += "\n" + responseText;
				}

				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
				const parts = splitMessage(displayText);

				if (responseMessage) {
					await responseMessage.edit(parts[0]);
					// If there are additional parts, they'll be handled by respondFollowUp
				} else {
					responseMessage = await channel.send(parts[0]);
				}

				if (shouldLog) {
					await this.store.logBotResponse(
						message.channel.id,
						responseText,
						responseMessage.id,
						message.guild?.id,
					);
				}
			},

			replaceMessage: async (text: string) => {
				accumulatedText = text;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
				const parts = splitMessage(displayText);

				if (responseMessage) {
					await responseMessage.edit(parts[0]);
				} else {
					responseMessage = await channel.send(parts[0]);
				}
			},

			respondFollowUp: async (followUpText: string) => {
				const parts = splitMessage(followUpText);
				for (const part of parts) {
					await channel.send(part);
				}
			},

			setTyping: async (isTyping: boolean) => {
				if (isTyping) {
					await channel.sendTyping();
					// Post initial "thinking" message
					if (!responseMessage) {
						accumulatedText = "*Thinking...*";
						responseMessage = await channel.send(accumulatedText + workingIndicator);
					}
				}
			},

			uploadFile: async (filePath: string, title?: string) => {
				const fileName = title || basename(filePath);
				const fileContent = readFileSync(filePath);
				const attachment = new AttachmentBuilder(fileContent, { name: fileName });
				await channel.send({ files: [attachment] });
			},

			setWorking: async (working: boolean) => {
				isWorking = working;
				if (responseMessage && accumulatedText) {
					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
					const parts = splitMessage(displayText);
					await responseMessage.edit(parts[0]);
				}
			},
		};
	}

	async start(): Promise<void> {
		await this.client.login(this.config.botToken);
	}

	async stop(): Promise<void> {
		await this.client.destroy();
		log.logDisconnected();
	}
}
