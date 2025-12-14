import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	type ChatInputCommandInteraction,
	Client,
	EmbedBuilder,
	GatewayIntentBits,
	type Guild,
	type Message,
	Partials,
	type PartialTextBasedChannelFields,
} from "discord.js";
import { readFileSync } from "fs";
import { basename } from "path";
import * as log from "../../log.js";
import type { ChannelInfo, ToolResultData, TransportContext, UsageSummaryData, UserInfo } from "../types.js";
import { DiscordChannelStore } from "./store.js";

const DISCORD_PRIMARY_MAX_CHARS = 2000;
const DISCORD_SECONDARY_MAX_CHARS = 2000;
const DISCORD_EMBED_TITLE_MAX_CHARS = 256;
const DISCORD_EMBED_ARGS_MAX_CHARS = 1000;
const DISCORD_EMBED_DESCRIPTION_MAX_CHARS = 3900;

export interface MomDiscordHandler {
	onMention(ctx: TransportContext): Promise<void>;
	onDirectMessage(ctx: TransportContext): Promise<void>;
	onStopButton?(channelId: string): Promise<void>;
}

export interface MomDiscordConfig {
	botToken: string;
	workingDir: string;
}

export class MomDiscordBot {
	private client: Client;
	private handler: MomDiscordHandler;
	public readonly store: DiscordChannelStore;
	private botUserId: string | null = null;
	private userCache = new Map<string, { userName: string; displayName: string }>();
	private channelCache = new Map<string, string>();

	constructor(handler: MomDiscordHandler, config: MomDiscordConfig) {
		this.handler = handler;
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMembers,
			],
			// Needed to reliably receive Direct Messages (DM channels aren't always cached).
			partials: [Partials.Channel],
		});
		this.store = new DiscordChannelStore({ workingDir: config.workingDir });

		this.setupEventHandlers(config);
	}

	private setupEventHandlers(config: MomDiscordConfig): void {
		this.client.on("ready", async () => {
			this.botUserId = this.client.user?.id || null;
			log.logInfo(`Discord: logged in as ${this.client.user?.tag}`);

			for (const [, guild] of this.client.guilds.cache) {
				await this.fetchGuildData(guild);
			}
			log.logInfo(`Discord: loaded ${this.channelCache.size} channels, ${this.userCache.size} users`);
		});

		this.client.on("messageCreate", async (message: Message) => {
			if (message.author.bot) return;
			if (message.author.id === this.botUserId) return;
			if (!message.channel.isTextBased()) return;
			if (!this.isSendableTextChannel(message.channel)) return;

			const isDM = message.guild === null;
			const isMentioned = this.client.user ? message.mentions.has(this.client.user) : false;

			// Cache channel names on-the-fly (important for threads, which aren't included in guild.channels.fetch()).
			if (!isDM && "name" in message.channel) {
				const name = (message.channel as { name?: string }).name;
				if (name) {
					this.channelCache.set(message.channel.id, String(name));
				}
			}

			const attachments =
				message.attachments.size > 0
					? this.store.processAttachments(
							message.channel.id,
							Array.from(message.attachments.values()).flatMap((a) =>
								a.name && a.url ? [{ name: a.name, url: a.url }] : [],
							),
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

			if (isDM) {
				const ctx = await this.createContextFromMessage(
					message,
					attachments,
					userName,
					displayName,
					config.workingDir,
				);
				await this.handler.onDirectMessage(ctx);
			} else if (isMentioned) {
				const ctx = await this.createContextFromMessage(
					message,
					attachments,
					userName,
					displayName,
					config.workingDir,
				);
				await this.handler.onMention(ctx);
			}
		});

		this.client.on("guildCreate", async (guild: Guild) => {
			log.logInfo(`Discord: joined guild ${guild.name}`);
			await this.fetchGuildData(guild);
		});

		this.client.on("interactionCreate", async (interaction) => {
			if (!interaction.isButton()) return;

			if (interaction.customId.startsWith("mom-stop-")) {
				const channelId = interaction.customId.replace("mom-stop-", "");
				await interaction.deferUpdate();
				if (this.handler.onStopButton) {
					await this.handler.onStopButton(channelId);
				}
			}
		});
	}

	private async fetchGuildData(guild: Guild): Promise<void> {
		try {
			const channels = await guild.channels.fetch();
			for (const [id, channel] of channels) {
				if (!channel) continue;
				if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildForum) {
					this.channelCache.set(id, channel.name);
				}
			}

			const members = await guild.members.fetch({ limit: 1000 });
			for (const [id, member] of members) {
				this.userCache.set(id, {
					userName: member.user.username,
					displayName: member.displayName || member.user.username,
				});
			}
		} catch (error) {
			log.logWarning("Discord: failed to fetch guild metadata", `${guild.name}: ${String(error)}`);
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
		const cached = this.userCache.get(userId);
		if (cached) return cached;

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
			const fallback = { userName: userId, displayName: userId };
			this.userCache.set(userId, fallback);
			return fallback;
		}
	}

	private isSendableTextChannel(channel: unknown): channel is PartialTextBasedChannelFields<boolean> {
		if (typeof channel !== "object" || channel === null) return false;
		const maybeSend = (channel as { send?: unknown }).send;
		if (typeof maybeSend !== "function") return false;
		return true;
	}

	private splitMessage(text: string, maxLen: number): string[] {
		if (text.length <= maxLen) return [text];

		const parts: string[] = [];
		let remaining = text;
		while (remaining.length > 0) {
			let cut = Math.min(maxLen, remaining.length);
			const newlineCut = remaining.lastIndexOf("\n", cut);
			if (newlineCut > Math.floor(maxLen * 0.6)) cut = newlineCut;
			const head = remaining.slice(0, cut).trimEnd();
			parts.push(head.length > 0 ? head : remaining.slice(0, Math.min(maxLen, remaining.length)));
			remaining = remaining.slice(cut);
			if (remaining.startsWith("\n")) remaining = remaining.slice(1);
		}
		return parts;
	}

	private createDiscordContext(params: {
		workingDir: string;
		channelDir: string;
		channelName?: string;
		guildId?: string;
		guildName?: string;
		message: TransportContext["message"];

		sendTyping?: () => Promise<void>;
		postPrimary: (payload: { content: string; components: ActionRowBuilder<ButtonBuilder>[] }) => Promise<Message>;
		postText: (content: string) => Promise<Message>;
		postEmbed: (embed: EmbedBuilder) => Promise<Message>;
		uploadFile: (filePath: string, title?: string) => Promise<void>;
	}): TransportContext {
		let responseMessage: Message | null = null;
		let primaryComponents: ActionRowBuilder<ButtonBuilder>[] = [];

		// `overflowMessages` are used to hold overflow of the primary response (kept in sync via edits).
		// `secondaryMessages` are "append-only" auxiliary messages (tool results, explicit secondary sends, etc).
		const overflowMessages: Message[] = [];
		const secondaryMessages: Message[] = [];

		let accumulatedText = "";
		let isWorking = true;
		const workingIndicator = " ...";

		const formatting = {
			italic: (t: string) => `*${t}*`,
			bold: (t: string) => `**${t}**`,
			code: (t: string) => `\`${t}\``,
			codeBlock: (t: string) => `\`\`\`\n${t}\n\`\`\``,
		};

		const syncOverflowMessages = async (overflowParts: string[]): Promise<void> => {
			for (let i = 0; i < overflowParts.length; i++) {
				const part = overflowParts[i];
				const existing = overflowMessages[i];
				if (existing) {
					try {
						await existing.edit(part);
					} catch {
						const posted = await params.postText(part);
						try {
							await existing.delete();
						} catch {
							// ignore
						}
						overflowMessages[i] = posted;
					}
				} else {
					const posted = await params.postText(part);
					overflowMessages.push(posted);
				}
			}

			for (let i = overflowMessages.length - 1; i >= overflowParts.length; i--) {
				const msg = overflowMessages[i];
				try {
					await msg.delete();
				} catch {
					// ignore
				}
				overflowMessages.pop();
			}
		};

		const editOrSendPrimary = async (content: string): Promise<Message> => {
			if (responseMessage) {
				await responseMessage.edit({ content, components: primaryComponents });
				return responseMessage;
			}
			const posted = await params.postPrimary({ content, components: primaryComponents });
			responseMessage = posted;
			return posted;
		};

		const sendSecondary = async (content: string): Promise<void> => {
			const parts = this.splitMessage(content, DISCORD_SECONDARY_MAX_CHARS);
			for (const part of parts) {
				const msg = await params.postText(part);
				secondaryMessages.push(msg);
			}
		};

		const addStopButton = async (): Promise<void> => {
			const stopButton = new ButtonBuilder()
				.setCustomId(`mom-stop-${params.message.channelId}`)
				.setLabel("Stop")
				.setStyle(ButtonStyle.Danger);
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(stopButton);
			primaryComponents = [row];
			if (!responseMessage) return;
			await responseMessage.edit({ content: responseMessage.content, components: primaryComponents });
		};

		const removeStopButton = async (): Promise<void> => {
			primaryComponents = [];
			if (!responseMessage) return;
			await responseMessage.edit({ content: responseMessage.content, components: primaryComponents });
		};

		const sendToolResult = async (data: ToolResultData): Promise<void> => {
			const titlePrefix = data.isError ? "ERR" : "OK";
			const rawTitle = `${titlePrefix} ${data.toolName}${data.label ? `: ${data.label}` : ""}`;
			const title =
				rawTitle.length > DISCORD_EMBED_TITLE_MAX_CHARS
					? rawTitle.slice(0, DISCORD_EMBED_TITLE_MAX_CHARS - 3) + "..."
					: rawTitle;

			const embed = new EmbedBuilder()
				.setTitle(title)
				.setColor(data.isError ? 0xff0000 : 0x00ff00)
				.setFooter({ text: `Duration: ${data.durationSecs}s` });

			if (data.args?.trim()) {
				const truncatedArgs =
					data.args.length > DISCORD_EMBED_ARGS_MAX_CHARS
						? data.args.slice(0, DISCORD_EMBED_ARGS_MAX_CHARS - 3) + "..."
						: data.args;
				embed.addFields({ name: "Arguments", value: "```\n" + truncatedArgs + "\n```", inline: false });
			}

			const truncatedResult =
				data.result.length > DISCORD_EMBED_DESCRIPTION_MAX_CHARS
					? data.result.slice(0, DISCORD_EMBED_DESCRIPTION_MAX_CHARS - 3) + "..."
					: data.result;
			embed.setDescription("```\n" + truncatedResult + "\n```");

			const msg = await params.postEmbed(embed);
			secondaryMessages.push(msg);
		};

		const sendUsageSummary = async (data: UsageSummaryData): Promise<void> => {
			const formatNum = (n: number) => n.toLocaleString();
			const formatCost = (n: number) => `$${n.toFixed(4)}`;

			const embed = new EmbedBuilder()
				.setColor(0x2b2d31)
				.setAuthor({ name: "Usage Summary" })
				.addFields(
					{
						name: "Tokens",
						value: `\`${formatNum(data.tokens.input)}\` in  \`${formatNum(data.tokens.output)}\` out`,
						inline: true,
					},
					{
						name: "Context",
						value: `\`${data.context.percent}\` of ${formatNum(data.context.max)}`,
						inline: true,
					},
					{
						name: "Cost",
						value: `**${formatCost(data.cost.total)}**`,
						inline: true,
					},
				);

			if (data.cache.read > 0 || data.cache.write > 0) {
				embed.addFields({
					name: "Cache",
					value: `\`${formatNum(data.cache.read)}\` read  \`${formatNum(data.cache.write)}\` write`,
					inline: true,
				});
			}

			const costBreakdown = [
				`In: ${formatCost(data.cost.input)}`,
				`Out: ${formatCost(data.cost.output)}`,
				data.cache.read > 0 ? `Cache read: ${formatCost(data.cost.cacheRead)}` : null,
				data.cache.write > 0 ? `Cache write: ${formatCost(data.cost.cacheWrite)}` : null,
			]
				.filter(Boolean)
				.join(" | ");
			embed.setFooter({ text: costBreakdown });

			const summaryMsg = await params.postEmbed(embed);
			secondaryMessages.push(summaryMsg);
		};

		return {
			transport: "discord",
			workingDir: params.workingDir,
			channelDir: params.channelDir,
			channelName: params.channelName,
			guildId: params.guildId,
			guildName: params.guildName,
			message: params.message,
			channels: this.getChannels(),
			users: this.getUsers(),
			formatting,
			limits: { primaryMaxChars: DISCORD_PRIMARY_MAX_CHARS, secondaryMaxChars: DISCORD_SECONDARY_MAX_CHARS },

			send: async (target, content, opts) => {
				const shouldLog = opts?.log ?? true;
				if (target === "secondary") {
					await sendSecondary(content);
					return;
				}

				accumulatedText = accumulatedText ? accumulatedText + "\n" + content : content;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;

				const parts = this.splitMessage(displayText, DISCORD_PRIMARY_MAX_CHARS);
				const primary = await editOrSendPrimary(parts[0]);

				if (shouldLog) {
					await this.store.logBotResponse(params.message.channelId, content, primary.id, params.guildId);
				}

				await syncOverflowMessages(parts.slice(1));
			},

			replacePrimary: async (content) => {
				accumulatedText = content;
				const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
				const parts = this.splitMessage(displayText, DISCORD_PRIMARY_MAX_CHARS);
				await editOrSendPrimary(parts[0]);
				await syncOverflowMessages(parts.slice(1));
			},

			setTyping: async (isTyping) => {
				if (!isTyping) return;
				if (params.sendTyping) {
					await params.sendTyping();
				}
				if (!responseMessage) {
					accumulatedText = "-# *Thinking...*";
					await editOrSendPrimary(accumulatedText + workingIndicator);
				}
			},

			uploadFile: async (filePath, title) => {
				await params.uploadFile(filePath, title);
			},

			setWorking: async (working) => {
				isWorking = working;
				if (responseMessage) {
					const displayText = isWorking ? accumulatedText + workingIndicator : accumulatedText;
					const parts = this.splitMessage(displayText, DISCORD_PRIMARY_MAX_CHARS);
					await responseMessage.edit({ content: parts[0], components: primaryComponents });
					await syncOverflowMessages(parts.slice(1));
				}
			},

			deletePrimaryAndSecondary: async () => {
				for (let i = secondaryMessages.length - 1; i >= 0; i--) {
					try {
						await secondaryMessages[i].delete();
					} catch {
						// ignore
					}
				}
				secondaryMessages.length = 0;

				for (let i = overflowMessages.length - 1; i >= 0; i--) {
					try {
						await overflowMessages[i].delete();
					} catch {
						// ignore
					}
				}
				overflowMessages.length = 0;

				if (responseMessage) {
					try {
						await responseMessage.delete();
					} catch {
						// ignore
					}
					responseMessage = null;
					primaryComponents = [];
				}
			},

			sendToolResult,
			sendUsageSummary,
			addStopControl: addStopButton,
			removeStopControl: removeStopButton,
		};
	}

	private async createContextFromMessage(
		message: Message,
		attachments: Array<{ local: string }>,
		userName: string,
		displayName: string,
		workingDir: string,
	): Promise<TransportContext> {
		const rawText = message.content;
		// Remove only the bot mention, keep other user mentions intact.
		// Fallback to stripping all mentions if botUserId isn't available for some reason.
		const mentionPattern = this.botUserId ? new RegExp(`<@!?${this.botUserId}>`, "g") : /<@!?\d+>/g;
		const text = rawText.replace(mentionPattern, "").trim();

		const channelName =
			message.channel.type === ChannelType.DM
				? undefined
				: "name" in message.channel
					? String((message.channel as { name?: string }).name)
					: undefined;

		const guildId = message.guild?.id;
		const guildName = message.guild?.name;

		const channelDir = this.store.getChannelDir(message.channel.id, guildId);

		const channel = message.channel;
		if (!this.isSendableTextChannel(channel)) {
			throw new Error(`Unsupported Discord channel type for sending messages (channelId=${message.channel.id})`);
		}

		return this.createDiscordContext({
			workingDir,
			channelDir,
			channelName,
			guildId,
			guildName,
			message: {
				text,
				rawText,
				userId: message.author.id,
				userName,
				displayName,
				channelId: message.channel.id,
				messageId: message.id,
				attachments,
			},
			sendTyping: async () => {
				const maybeSendTyping = (channel as { sendTyping?: unknown }).sendTyping;
				if (typeof maybeSendTyping === "function") {
					await (channel as { sendTyping: () => Promise<void> }).sendTyping();
				}
			},
			postPrimary: async (payload) => channel.send(payload),
			postText: async (content) => channel.send(content),
			postEmbed: async (embed) => channel.send({ embeds: [embed] }),
			uploadFile: async (filePath, title) => {
				const fileName = title || basename(filePath);
				const fileContent = readFileSync(filePath);
				const attachment = new AttachmentBuilder(fileContent, { name: fileName });
				await channel.send({ files: [attachment] });
			},
		});
	}

	async createContextFromInteraction(
		interaction: ChatInputCommandInteraction,
		messageText: string,
		workingDir: string,
	): Promise<TransportContext> {
		const guildId = interaction.guildId || undefined;
		const guildName = interaction.guild?.name;
		const channelId = interaction.channelId;
		const channelDir = this.store.getChannelDir(channelId, guildId);

		const userName = interaction.user.username;
		const displayName = interaction.user.displayName || interaction.user.username;

		let channelName: string | undefined;
		if (interaction.channel?.isTextBased() && !interaction.channel.isDMBased() && "name" in interaction.channel) {
			channelName = String((interaction.channel as { name?: string }).name);
		}
		if (channelName) {
			this.channelCache.set(channelId, channelName);
		}

		return this.createDiscordContext({
			workingDir,
			channelDir,
			channelName,
			guildId,
			guildName,
			message: {
				text: messageText,
				rawText: messageText,
				userId: interaction.user.id,
				userName,
				displayName,
				channelId,
				messageId: interaction.id,
				attachments: [],
			},
			postPrimary: async (payload) => (await interaction.editReply(payload)) as Message,
			postText: async (content) => (await interaction.followUp(content)) as Message,
			postEmbed: async (embed) => (await interaction.followUp({ embeds: [embed] })) as Message,
			uploadFile: async (filePath, title) => {
				const fileName = title || basename(filePath);
				const fileContent = readFileSync(filePath);
				const attachment = new AttachmentBuilder(fileContent, { name: fileName });
				await interaction.followUp({ files: [attachment] });
			},
		});
	}

	getClient(): Client {
		return this.client;
	}

	async start(botToken: string): Promise<void> {
		await this.client.login(botToken);
	}

	async stop(): Promise<void> {
		await this.client.destroy();
	}
}
