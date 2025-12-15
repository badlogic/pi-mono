import {
	ActionRowBuilder,
	ActivityType,
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
	ThreadAutoArchiveDuration,
	type ThreadChannel,
} from "discord.js";
import { readFileSync, statSync } from "fs";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { basename, resolve } from "path";
import type {
	DiscordProfileActivityType,
	DiscordProfileSettings,
	MomSettingsManager,
	ResolvedUsageSummarySettings,
} from "../../context.js";
import * as log from "../../log.js";
import { interpolate } from "../../log.js";
import type {
	ChannelInfo,
	FormatterOutput,
	ToolResultData,
	TransportContext,
	UsageSummaryData,
	UserInfo,
} from "../types.js";
import { DiscordChannelStore } from "./store.js";

const DISCORD_PRIMARY_MAX_CHARS = 2000;
const DISCORD_SECONDARY_MAX_CHARS = 2000;
const DISCORD_EMBED_TITLE_MAX_CHARS = 256;
const DISCORD_EMBED_ARGS_MAX_CHARS = 1000;
const DISCORD_EMBED_DESCRIPTION_MAX_CHARS = 3900;
const MAX_EVENT_QUEUE_SIZE = 5;

type QueuedWork = () => Promise<void>;

class ChannelQueue {
	private queue: QueuedWork[] = [];
	private processing = false;

	enqueue(work: QueuedWork): void {
		this.queue.push(work);
		this.processNext();
	}

	size(): number {
		return this.queue.length;
	}

	private async processNext(): Promise<void> {
		if (this.processing || this.queue.length === 0) return;
		this.processing = true;
		const work = this.queue.shift()!;
		try {
			await work();
		} catch (err) {
			log.logWarning("Discord queue error", err instanceof Error ? err.message : String(err));
		}
		this.processing = false;
		this.processNext();
	}
}

export interface MomDiscordHandler {
	onMention(ctx: TransportContext): Promise<void>;
	onDirectMessage(ctx: TransportContext): Promise<void>;
	onStopButton?(channelId: string): Promise<void>;
	onEvent?(ctx: TransportContext, isEvent: boolean): Promise<void>;
}

export interface MomDiscordConfig {
	botToken: string;
	workingDir: string;
	settingsManager?: MomSettingsManager;
}

export class MomDiscordBot {
	private client: Client;
	private handler: MomDiscordHandler;
	public readonly store: DiscordChannelStore;
	private botUserId: string | null = null;
	private userCache = new Map<string, { userName: string; displayName: string }>();
	private channelCache = new Map<string, string>();
	private queues = new Map<string, ChannelQueue>();
	private workingDir: string;
	private settingsManager?: MomSettingsManager;

	constructor(handler: MomDiscordHandler, config: MomDiscordConfig) {
		this.handler = handler;
		this.workingDir = config.workingDir;
		this.settingsManager = config.settingsManager;
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMembers,
			],
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

			if (this.settingsManager) {
				const profile = this.settingsManager.getDiscordProfileSettings();
				if (Object.keys(profile).length > 0) {
					const result = await this.applyProfileUpdates(profile);
					if (!result.success) {
						log.logWarning("Discord profile apply failed", result.message);
					}
				}
			}
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

		// Thread for tool results (created lazily from primary message)
		let toolThread: ThreadChannel | null = null;

		let accumulatedText = "";
		let isWorking = true;
		const workingIndicator = " ...";

		const formatting = {
			italic: (t: string) => `*${t}*`,
			bold: (t: string) => `**${t}**`,
			code: (t: string) => `\`${t}\``,
			codeBlock: (t: string) => `\`\`\`\n${t}\n\`\`\``,
		};

		const getOrCreateThread = async (): Promise<ThreadChannel | null> => {
			if (toolThread) return toolThread;
			if (!responseMessage) return null;
			if (!responseMessage.channel || responseMessage.channel.type === ChannelType.DM) return null;
			try {
				toolThread = await responseMessage.startThread({
					name: "Tool Results",
					autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
				});
				return toolThread;
			} catch (err) {
				log.logWarning(
					"Failed to create thread for tool results",
					err instanceof Error ? err.message : String(err),
				);
				return null;
			}
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

			const thread = await getOrCreateThread();
			if (thread) {
				const msg = await thread.send({ embeds: [embed] });
				secondaryMessages.push(msg);
			} else {
				const msg = await params.postEmbed(embed);
				secondaryMessages.push(msg);
			}
		};

		const sendUsageSummary = async (
			data: UsageSummaryData,
			settings: ResolvedUsageSummarySettings,
			formatterOutput?: FormatterOutput,
		): Promise<void> => {
			// If custom formatter output is provided, use it directly
			if (formatterOutput) {
				const embed = new EmbedBuilder()
					.setColor(formatterOutput.color ?? 0x2b2d31)
					.setAuthor({ name: formatterOutput.title ?? "Usage Summary" });

				if (formatterOutput.fields) {
					for (const field of formatterOutput.fields) {
						embed.addFields({ name: field.name, value: field.value, inline: field.inline ?? true });
					}
				}

				if (formatterOutput.footer) {
					embed.setFooter({ text: formatterOutput.footer });
				}

				const summaryMsg = await params.postEmbed(embed);
				secondaryMessages.push(summaryMsg);
				return;
			}

			// Otherwise use template system
			const formatNum = (n: number) => n.toLocaleString();
			const formatCost = (n: number) => `$${n.toFixed(4)}`;
			const { fields } = settings;

			const embed = new EmbedBuilder().setColor(0x2b2d31).setAuthor({ name: settings.title });

			if (fields.tokens.enabled) {
				const value = interpolate(fields.tokens.format!, {
					input: formatNum(data.tokens.input),
					output: formatNum(data.tokens.output),
				});
				embed.addFields({ name: fields.tokens.label!, value, inline: true });
			}

			if (fields.context.enabled) {
				const value = interpolate(fields.context.format!, {
					used: formatNum(data.context.used),
					max: formatNum(data.context.max),
					percent: data.context.percent,
				});
				embed.addFields({ name: fields.context.label!, value, inline: true });
			}

			if (fields.cost.enabled) {
				const value = interpolate(fields.cost.format!, {
					total: formatCost(data.cost.total),
					input: formatCost(data.cost.input),
					output: formatCost(data.cost.output),
					cacheRead: formatCost(data.cost.cacheRead),
					cacheWrite: formatCost(data.cost.cacheWrite),
				});
				embed.addFields({ name: fields.cost.label!, value, inline: true });
			}

			if (fields.cache.enabled && (data.cache.read > 0 || data.cache.write > 0)) {
				const value = interpolate(fields.cache.format!, {
					read: formatNum(data.cache.read),
					write: formatNum(data.cache.write),
				});
				embed.addFields({ name: fields.cache.label!, value, inline: true });
			}

			if (settings.footer.enabled) {
				const footerText = interpolate(settings.footer.format, {
					input: formatCost(data.cost.input),
					output: formatCost(data.cost.output),
					cacheRead: formatCost(data.cost.cacheRead),
					cacheWrite: formatCost(data.cost.cacheWrite),
				});
				embed.setFooter({ text: footerText });
			}

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
				// Delete thread first (this also deletes messages inside it)
				if (toolThread) {
					try {
						await toolThread.delete();
					} catch {
						// ignore
					}
					toolThread = null;
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

	public async applyProfileUpdates(
		updates: Partial<DiscordProfileSettings>,
	): Promise<{ success: boolean; message: string }> {
		const user = this.client.user;
		if (!user) {
			return { success: false, message: "Discord client user not available yet (not ready)" };
		}

		const warnings: string[] = [];

		if (updates.status) {
			try {
				user.setStatus(updates.status);
			} catch (err) {
				warnings.push(`status: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		if (updates.activity) {
			try {
				user.setActivity(updates.activity.name, {
					type: mapDiscordActivityType(updates.activity.type),
				});
			} catch (err) {
				warnings.push(`activity: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		if (updates.username) {
			try {
				await user.setUsername(updates.username);
			} catch (err) {
				warnings.push(`username: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		if (updates.avatar !== undefined) {
			try {
				const avatar = updates.avatar.trim();
				if (avatar === "") {
					await user.setAvatar(null);
				} else {
					const buffer = await resolveAvatarBuffer(avatar, this.workingDir);
					await user.setAvatar(buffer);
				}
			} catch (err) {
				warnings.push(`avatar: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		if (warnings.length > 0) {
			return { success: false, message: `Some profile updates failed: ${warnings.join("; ")}` };
		}

		return { success: true, message: "Profile updates applied" };
	}

	public async updateProfile(
		updates: Partial<DiscordProfileSettings>,
	): Promise<{ success: boolean; message: string }> {
		if (!this.settingsManager) {
			return { success: false, message: "Discord settingsManager not configured; cannot persist profile updates" };
		}
		this.settingsManager.setDiscordProfile(updates);
		return await this.applyProfileUpdates(updates);
	}

	private getQueue(channelId: string): ChannelQueue {
		let queue = this.queues.get(channelId);
		if (!queue) {
			queue = new ChannelQueue();
			this.queues.set(channelId, queue);
		}
		return queue;
	}

	async enqueueEvent(event: { channelId: string; text: string }): Promise<boolean> {
		if (!this.handler.onEvent) {
			log.logWarning("Discord: onEvent handler not configured, cannot process event");
			return false;
		}

		const queue = this.getQueue(event.channelId);
		if (queue.size() >= MAX_EVENT_QUEUE_SIZE) {
			log.logWarning(`Discord: Event queue full for ${event.channelId}, discarding: ${event.text.substring(0, 50)}`);
			return false;
		}

		log.logInfo(`Discord: Enqueueing event for ${event.channelId}: ${event.text.substring(0, 50)}`);

		queue.enqueue(async () => {
			try {
				const channel = await this.client.channels.fetch(event.channelId);
				if (!channel || !channel.isTextBased()) {
					log.logWarning(`Discord: Channel ${event.channelId} not found or not text-based`);
					return;
				}

				const guildId = "guildId" in channel ? (channel.guildId as string | null) : null;
				const channelName = "name" in channel ? (channel as { name?: string }).name : undefined;
				const guild = guildId ? await this.client.guilds.fetch(guildId).catch(() => null) : null;
				const guildName = guild?.name;
				const channelDir = this.store.getChannelDir(event.channelId, guildId || undefined);

				const ctx = this.createDiscordContext({
					workingDir: this.workingDir,
					channelDir,
					channelName: channelName || undefined,
					guildId: guildId || undefined,
					guildName,
					message: {
						text: event.text,
						rawText: event.text,
						userId: "EVENT",
						userName: "EVENT",
						displayName: "EVENT",
						channelId: event.channelId,
						messageId: Date.now().toString(),
						attachments: [],
					},
					postPrimary: async (payload) => (channel as PartialTextBasedChannelFields<boolean>).send(payload),
					postText: async (content) => (channel as PartialTextBasedChannelFields<boolean>).send(content),
					postEmbed: async (embed) =>
						(channel as PartialTextBasedChannelFields<boolean>).send({ embeds: [embed] }),
					uploadFile: async (filePath, title) => {
						const fileName = title || basename(filePath);
						const fileContent = readFileSync(filePath);
						const attachment = new AttachmentBuilder(fileContent, { name: fileName });
						await (channel as PartialTextBasedChannelFields<boolean>).send({ files: [attachment] });
					},
				});

				await this.handler.onEvent!(ctx, true);
			} catch (err) {
				log.logWarning("Discord: Failed to process event", err instanceof Error ? err.message : String(err));
			}
		});

		return true;
	}
}

const DISCORD_AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const DISCORD_AVATAR_DOWNLOAD_TIMEOUT_MS = 10_000;

function mapDiscordActivityType(type: DiscordProfileActivityType): ActivityType {
	switch (type) {
		case "Playing":
			return ActivityType.Playing;
		case "Watching":
			return ActivityType.Watching;
		case "Listening":
			return ActivityType.Listening;
		case "Competing":
			return ActivityType.Competing;
		case "Streaming":
			return ActivityType.Streaming;
		default: {
			const exhaustive: never = type;
			return exhaustive;
		}
	}
}

function isHttpUrl(value: string): boolean {
	return value.startsWith("https://") || value.startsWith("http://");
}

async function resolveAvatarBuffer(avatar: string, workingDir: string): Promise<Buffer> {
	if (isHttpUrl(avatar)) {
		return await downloadUrlToBuffer(avatar, DISCORD_AVATAR_MAX_BYTES, 3);
	}

	let filePath = avatar;
	if (filePath.startsWith("/workspace/")) {
		filePath = filePath.replace("/workspace/", "");
	} else if (filePath === "/workspace") {
		filePath = "";
	}
	const resolved = resolve(workingDir, filePath);
	const stats = statSync(resolved);
	if (!stats.isFile()) {
		throw new Error(`Avatar path is not a file: ${resolved}`);
	}
	if (stats.size > DISCORD_AVATAR_MAX_BYTES) {
		throw new Error(`Avatar file too large: ${stats.size} bytes (max ${DISCORD_AVATAR_MAX_BYTES})`);
	}
	return readFileSync(resolved);
}

async function downloadUrlToBuffer(urlStr: string, maxBytes: number, remainingRedirects: number): Promise<Buffer> {
	const url = new URL(urlStr);
	const reqFn = url.protocol === "https:" ? httpsRequest : url.protocol === "http:" ? httpRequest : null;
	if (!reqFn) throw new Error(`Unsupported URL protocol: ${url.protocol}`);

	return await new Promise<Buffer>((resolvePromise, rejectPromise) => {
		const req = reqFn(url, (res) => {
			const statusCode = res.statusCode ?? 0;
			const location = res.headers.location;

			if (statusCode >= 300 && statusCode < 400 && location) {
				if (remainingRedirects <= 0) {
					rejectPromise(new Error("Too many redirects while downloading avatar"));
					res.resume();
					return;
				}
				const nextUrl = new URL(location, url).toString();
				res.resume();
				downloadUrlToBuffer(nextUrl, maxBytes, remainingRedirects - 1)
					.then(resolvePromise)
					.catch(rejectPromise);
				return;
			}

			if (statusCode >= 400) {
				rejectPromise(new Error(`HTTP ${statusCode} while downloading avatar`));
				res.resume();
				return;
			}

			const chunks: Buffer[] = [];
			let totalBytes = 0;

			res.on("data", (chunk: Buffer) => {
				totalBytes += chunk.length;
				if (totalBytes > maxBytes) {
					req.destroy(new Error(`Downloaded avatar exceeds max size (${maxBytes} bytes)`));
					return;
				}
				chunks.push(chunk);
			});

			res.on("end", () => {
				resolvePromise(Buffer.concat(chunks));
			});

			res.on("error", (err) => {
				rejectPromise(err);
			});
		});

		req.setTimeout(DISCORD_AVATAR_DOWNLOAD_TIMEOUT_MS, () => {
			req.destroy(new Error(`Avatar download timed out after ${DISCORD_AVATAR_DOWNLOAD_TIMEOUT_MS}ms`));
		});

		req.on("error", (err) => rejectPromise(err));
		req.end();
	});
}
