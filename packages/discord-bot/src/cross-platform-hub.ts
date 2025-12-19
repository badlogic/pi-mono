/**
 * Cross-Platform Hub - Unified messaging for Discord, Slack, Telegram, and GitHub
 *
 * Architecture:
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 * │   Discord   │     │    Slack    │     │  Telegram   │     │   GitHub    │
 * │    Bot      │     │    (MOM)    │     │    Bot      │     │   Action    │
 * └──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
 *        │                   │                   │                   │
 *        ▼                   ▼                   ▼                   ▼
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │                         CROSS-PLATFORM HUB                               │
 * │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
 * │  │  Event Bus  │  │   Router    │  │   Context   │  │  Webhooks   │     │
 * │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { Client, TextChannel } from "discord.js";
import { EventEmitter } from "events";
import type { Telegraf } from "telegraf";

// ============================================================================
// Types
// ============================================================================

export type Platform = "discord" | "slack" | "telegram" | "github";

export interface CrossPlatformMessage {
	id: string;
	timestamp: Date;
	source: Platform;
	sourceId: string; // channel ID, chat ID, or issue/PR number
	sourceUser: string;
	sourceUserName?: string;
	content: string;
	attachments?: string[];
	metadata?: Record<string, unknown>;
}

export interface BroadcastOptions {
	platforms?: Platform[];
	excludeSource?: boolean;
	priority?: "normal" | "high" | "urgent";
	format?: "markdown" | "plain";
}

export interface PlatformConfig {
	discord?: {
		client: Client;
		reportChannelId?: string;
		webhookUrl?: string;
	};
	slack?: {
		webClient: unknown;
		reportChannelId?: string;
	};
	telegram?: {
		bot: Telegraf;
		reportChatId?: string;
	};
	github?: {
		webhookUrl?: string;
		token?: string;
	};
}

export interface RouteRule {
	id: string;
	from: Platform;
	fromPattern?: string; // Regex pattern for source ID
	to: Platform[];
	toIds: Record<Platform, string>; // Target channel/chat IDs
	filter?: (msg: CrossPlatformMessage) => boolean;
	transform?: (msg: CrossPlatformMessage) => CrossPlatformMessage;
	enabled: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

export interface HubEvents {
	message: [CrossPlatformMessage];
	broadcast: [CrossPlatformMessage, Platform[]];
	error: [Error, Platform];
	route: [CrossPlatformMessage, RouteRule];
	"platform:connect": [Platform];
	"platform:disconnect": [Platform];
}

// ============================================================================
// Cross-Platform Hub
// ============================================================================

export class CrossPlatformHub extends EventEmitter {
	private platforms: PlatformConfig = {};
	private routes: RouteRule[] = [];
	private messageHistory: CrossPlatformMessage[] = [];
	private maxHistory = 1000;
	private connectedPlatforms = new Set<Platform>();

	constructor() {
		super();
		this.setupDefaultRoutes();
	}

	// ========================================================================
	// Platform Registration
	// ========================================================================

	registerDiscord(client: Client, reportChannelId?: string): void {
		this.platforms.discord = {
			client,
			reportChannelId: reportChannelId || process.env.REPORT_CHANNEL_ID,
			webhookUrl: process.env.DISCORD_WEBHOOK_URL,
		};
		this.connectedPlatforms.add("discord");
		this.emit("platform:connect", "discord");
		console.log("[HUB] Discord platform registered");
	}

	registerSlack(webClient: unknown, reportChannelId?: string): void {
		this.platforms.slack = {
			webClient,
			reportChannelId,
		};
		this.connectedPlatforms.add("slack");
		this.emit("platform:connect", "slack");
		console.log("[HUB] Slack platform registered");
	}

	registerTelegram(bot: Telegraf, reportChatId?: string): void {
		this.platforms.telegram = {
			bot,
			reportChatId: reportChatId || process.env.TELEGRAM_REPORT_CHAT_ID,
		};
		this.connectedPlatforms.add("telegram");
		this.emit("platform:connect", "telegram");
		console.log("[HUB] Telegram platform registered");
	}

	registerGitHub(webhookUrl?: string, token?: string): void {
		this.platforms.github = {
			webhookUrl: webhookUrl || process.env.GITHUB_WEBHOOK_URL,
			token: token || process.env.GITHUB_TOKEN,
		};
		this.connectedPlatforms.add("github");
		this.emit("platform:connect", "github");
		console.log("[HUB] GitHub platform registered");
	}

	// ========================================================================
	// Routing Rules
	// ========================================================================

	private setupDefaultRoutes(): void {
		// Default: broadcast trading alerts to all platforms
		this.addRoute({
			id: "trading-alerts",
			from: "discord",
			fromPattern: "trading|signals|alerts",
			to: ["telegram", "slack"],
			toIds: {
				discord: "",
				telegram: process.env.TELEGRAM_REPORT_CHAT_ID || "",
				slack: process.env.SLACK_REPORT_CHANNEL_ID || "",
				github: "",
			},
			filter: (msg) => msg.content.toLowerCase().includes("signal") || msg.content.toLowerCase().includes("alert"),
			enabled: true,
		});

		// GitHub PR mentions → Discord & Slack
		this.addRoute({
			id: "github-notifications",
			from: "github",
			to: ["discord", "slack"],
			toIds: {
				discord: process.env.REPORT_CHANNEL_ID || "",
				telegram: "",
				slack: process.env.SLACK_REPORT_CHANNEL_ID || "",
				github: "",
			},
			enabled: true,
		});
	}

	addRoute(rule: RouteRule): void {
		// Remove existing route with same ID
		this.routes = this.routes.filter((r) => r.id !== rule.id);
		this.routes.push(rule);
		console.log(`[HUB] Route added: ${rule.id} (${rule.from} → ${rule.to.join(", ")})`);
	}

	removeRoute(id: string): boolean {
		const initialLength = this.routes.length;
		this.routes = this.routes.filter((r) => r.id !== id);
		return this.routes.length < initialLength;
	}

	getRoutes(): RouteRule[] {
		return [...this.routes];
	}

	// ========================================================================
	// Message Handling
	// ========================================================================

	async ingest(message: CrossPlatformMessage): Promise<void> {
		// Store in history
		this.messageHistory.push(message);
		if (this.messageHistory.length > this.maxHistory) {
			this.messageHistory = this.messageHistory.slice(-this.maxHistory);
		}

		// Emit for listeners
		this.emit("message", message);

		// Apply routing rules
		for (const rule of this.routes) {
			if (!rule.enabled) continue;
			if (rule.from !== message.source) continue;

			// Check pattern match
			if (rule.fromPattern) {
				const pattern = new RegExp(rule.fromPattern, "i");
				if (!pattern.test(message.sourceId)) continue;
			}

			// Check filter
			if (rule.filter && !rule.filter(message)) continue;

			// Transform if needed
			const transformedMsg = rule.transform ? rule.transform(message) : message;

			// Route to targets
			this.emit("route", transformedMsg, rule);
			await this.routeMessage(transformedMsg, rule);
		}
	}

	private async routeMessage(message: CrossPlatformMessage, rule: RouteRule): Promise<void> {
		for (const targetPlatform of rule.to) {
			if (targetPlatform === message.source) continue; // Don't route back to source

			const targetId = rule.toIds[targetPlatform];
			if (!targetId) continue;

			try {
				await this.sendToPlatform(targetPlatform, targetId, message);
			} catch (error) {
				console.error(`[HUB] Failed to route to ${targetPlatform}:`, error);
				this.emit("error", error instanceof Error ? error : new Error(String(error)), targetPlatform);
			}
		}
	}

	// ========================================================================
	// Broadcasting
	// ========================================================================

	async broadcast(content: string, options: BroadcastOptions = {}): Promise<void> {
		const message: CrossPlatformMessage = {
			id: `broadcast-${Date.now()}`,
			timestamp: new Date(),
			source: "discord", // Default source
			sourceId: "hub",
			sourceUser: "system",
			content,
		};

		const platforms = options.platforms || Array.from(this.connectedPlatforms);
		this.emit("broadcast", message, platforms);

		for (const platform of platforms) {
			try {
				await this.sendToPlatform(platform, this.getReportChannel(platform), message);
			} catch (error) {
				console.error(`[HUB] Broadcast failed to ${platform}:`, error);
			}
		}
	}

	private getReportChannel(platform: Platform): string {
		switch (platform) {
			case "discord":
				return this.platforms.discord?.reportChannelId || "";
			case "slack":
				return this.platforms.slack?.reportChannelId || "";
			case "telegram":
				return this.platforms.telegram?.reportChatId || "";
			case "github":
				return "";
			default:
				return "";
		}
	}

	// ========================================================================
	// Platform-Specific Sending
	// ========================================================================

	async sendToPlatform(platform: Platform, targetId: string, message: CrossPlatformMessage): Promise<boolean> {
		const formattedContent = this.formatForPlatform(message, platform);

		switch (platform) {
			case "discord":
				return this.sendToDiscord(targetId, formattedContent);
			case "telegram":
				return this.sendToTelegram(targetId, formattedContent);
			case "slack":
				return this.sendToSlack(targetId, formattedContent);
			case "github":
				return this.sendToGitHub(message);
			default:
				return false;
		}
	}

	private formatForPlatform(message: CrossPlatformMessage, platform: Platform): string {
		const header = `[From ${message.source}${message.sourceUserName ? ` - @${message.sourceUserName}` : ""}]`;

		switch (platform) {
			case "discord":
				return `**${header}**\n${message.content}`;
			case "telegram":
				return `*${header}*\n${message.content}`;
			case "slack":
				return `*${header}*\n${message.content}`;
			case "github":
				return `${header}\n\n${message.content}`;
			default:
				return `${header}\n${message.content}`;
		}
	}

	private async sendToDiscord(channelId: string, content: string): Promise<boolean> {
		const discord = this.platforms.discord;
		if (!discord) return false;

		// Try webhook first (faster, doesn't need bot permissions)
		if (discord.webhookUrl) {
			try {
				const response = await fetch(discord.webhookUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ content: content.slice(0, 2000) }),
				});
				if (response.ok) return true;
			} catch {
				// Fall through to client method
			}
		}

		// Use Discord client
		if (discord.client && channelId) {
			try {
				const channel = await discord.client.channels.fetch(channelId);
				if (channel && "send" in channel) {
					await (channel as TextChannel).send(content.slice(0, 2000));
					return true;
				}
			} catch (error) {
				console.error("[HUB] Discord send failed:", error);
			}
		}

		return false;
	}

	private async sendToTelegram(chatId: string, content: string): Promise<boolean> {
		const telegram = this.platforms.telegram;
		if (!telegram?.bot || !chatId) return false;

		try {
			await telegram.bot.telegram.sendMessage(chatId, content.slice(0, 4096), {
				parse_mode: "Markdown",
			});
			return true;
		} catch (error) {
			// Try without markdown if parsing fails
			try {
				await telegram.bot.telegram.sendMessage(chatId, content.slice(0, 4096));
				return true;
			} catch {
				console.error("[HUB] Telegram send failed:", error);
				return false;
			}
		}
	}

	private async sendToSlack(channelId: string, content: string): Promise<boolean> {
		const slack = this.platforms.slack;
		if (!slack?.webClient || !channelId) return false;

		try {
			const webClient = slack.webClient as { chat: { postMessage: (args: unknown) => Promise<unknown> } };
			await webClient.chat.postMessage({
				channel: channelId,
				text: content,
				mrkdwn: true,
			});
			return true;
		} catch (error) {
			console.error("[HUB] Slack send failed:", error);
			return false;
		}
	}

	private async sendToGitHub(message: CrossPlatformMessage): Promise<boolean> {
		const github = this.platforms.github;
		if (!github?.webhookUrl) return false;

		try {
			const response = await fetch(github.webhookUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(github.token && { Authorization: `Bearer ${github.token}` }),
				},
				body: JSON.stringify({
					event: "cross_platform_message",
					source: message.source,
					content: message.content,
					timestamp: message.timestamp.toISOString(),
				}),
			});
			return response.ok;
		} catch (error) {
			console.error("[HUB] GitHub webhook failed:", error);
			return false;
		}
	}

	// ========================================================================
	// Utility Methods
	// ========================================================================

	getConnectedPlatforms(): Platform[] {
		return Array.from(this.connectedPlatforms);
	}

	getMessageHistory(limit = 100): CrossPlatformMessage[] {
		return this.messageHistory.slice(-limit);
	}

	getMessagesByPlatform(platform: Platform, limit = 50): CrossPlatformMessage[] {
		return this.messageHistory.filter((m) => m.source === platform).slice(-limit);
	}

	getStats(): Record<string, number | string[]> {
		return {
			connectedPlatforms: this.connectedPlatforms.size,
			platforms: Array.from(this.connectedPlatforms),
			activeRoutes: this.routes.filter((r) => r.enabled).length,
			totalRoutes: this.routes.length,
			messagesInHistory: this.messageHistory.length,
		};
	}
}

// ============================================================================
// Webhook Handlers for GitHub Actions
// ============================================================================

export interface GitHubWebhookPayload {
	action: string;
	issue?: {
		number: number;
		title: string;
		body: string;
		user: { login: string };
	};
	pull_request?: {
		number: number;
		title: string;
		body: string;
		user: { login: string };
	};
	comment?: {
		body: string;
		user: { login: string };
	};
	repository: {
		full_name: string;
	};
}

export function createGitHubWebhookHandler(hub: CrossPlatformHub) {
	return async (payload: GitHubWebhookPayload): Promise<void> => {
		let content = "";
		let sourceId = "";

		if (payload.comment && payload.comment.body.includes("@pi")) {
			// @pi mention in comment
			const issueOrPr = payload.issue || payload.pull_request;
			const number = issueOrPr?.number || 0;
			const type = payload.pull_request ? "PR" : "Issue";

			content = `**GitHub @pi Mention**\n`;
			content += `${type} #${number}: ${issueOrPr?.title || "Unknown"}\n`;
			content += `From: @${payload.comment.user.login}\n`;
			content += `Repo: ${payload.repository.full_name}\n\n`;
			content += payload.comment.body.replace(/@pi\s*/gi, "").trim();

			sourceId = `${payload.repository.full_name}#${number}`;
		} else if (payload.pull_request && payload.action === "opened") {
			// New PR
			content = `**New PR Opened**\n`;
			content += `#${payload.pull_request.number}: ${payload.pull_request.title}\n`;
			content += `By: @${payload.pull_request.user.login}\n`;
			content += `Repo: ${payload.repository.full_name}`;

			sourceId = `${payload.repository.full_name}#${payload.pull_request.number}`;
		} else if (payload.issue && payload.action === "opened") {
			// New Issue
			content = `**New Issue Opened**\n`;
			content += `#${payload.issue.number}: ${payload.issue.title}\n`;
			content += `By: @${payload.issue.user.login}\n`;
			content += `Repo: ${payload.repository.full_name}`;

			sourceId = `${payload.repository.full_name}#${payload.issue.number}`;
		}

		if (content) {
			await hub.ingest({
				id: `github-${Date.now()}`,
				timestamp: new Date(),
				source: "github",
				sourceId,
				sourceUser:
					payload.comment?.user.login ||
					payload.issue?.user.login ||
					payload.pull_request?.user.login ||
					"unknown",
				content,
			});
		}
	};
}

// ============================================================================
// Express Middleware for Hub Webhooks
// ============================================================================

import type { NextFunction, Request, Response } from "express";

export function createHubWebhookMiddleware(hub: CrossPlatformHub) {
	return {
		// POST /hub/message - Ingest a message
		ingestMessage: async (req: Request, res: Response) => {
			try {
				const { source, sourceId, sourceUser, content, metadata } = req.body;

				if (!source || !content) {
					res.status(400).json({ error: "Missing required fields: source, content" });
					return;
				}

				await hub.ingest({
					id: `webhook-${Date.now()}`,
					timestamp: new Date(),
					source: source as Platform,
					sourceId: sourceId || "webhook",
					sourceUser: sourceUser || "webhook",
					content,
					metadata,
				});

				res.json({ status: "ingested", platforms: hub.getConnectedPlatforms() });
			} catch (error) {
				res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
			}
		},

		// POST /hub/broadcast - Broadcast to all platforms
		broadcast: async (req: Request, res: Response) => {
			try {
				const { content, platforms, priority } = req.body;

				if (!content) {
					res.status(400).json({ error: "Missing required field: content" });
					return;
				}

				await hub.broadcast(content, { platforms, priority });

				res.json({ status: "broadcast", platforms: platforms || hub.getConnectedPlatforms() });
			} catch (error) {
				res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
			}
		},

		// POST /hub/github - GitHub webhook handler
		githubWebhook: async (req: Request, res: Response) => {
			try {
				const handler = createGitHubWebhookHandler(hub);
				await handler(req.body as GitHubWebhookPayload);
				res.json({ status: "processed" });
			} catch (error) {
				res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
			}
		},

		// GET /hub/stats - Get hub statistics
		stats: (_req: Request, res: Response) => {
			res.json(hub.getStats());
		},

		// GET /hub/routes - List routing rules
		routes: (_req: Request, res: Response) => {
			res.json(hub.getRoutes());
		},

		// POST /hub/routes - Add a routing rule
		addRoute: (req: Request, res: Response) => {
			try {
				const rule = req.body as RouteRule;
				if (!rule.id || !rule.from || !rule.to) {
					res.status(400).json({ error: "Missing required fields: id, from, to" });
					return;
				}
				hub.addRoute(rule);
				res.json({ status: "added", rule });
			} catch (error) {
				res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
			}
		},

		// DELETE /hub/routes/:id - Remove a routing rule
		removeRoute: (req: Request, res: Response) => {
			const { id } = req.params;
			const removed = hub.removeRoute(id);
			if (removed) {
				res.json({ status: "removed", id });
			} else {
				res.status(404).json({ error: "Route not found" });
			}
		},
	};
}

// ============================================================================
// Singleton Instance
// ============================================================================

let hubInstance: CrossPlatformHub | null = null;

export function getHub(): CrossPlatformHub {
	if (!hubInstance) {
		hubInstance = new CrossPlatformHub();
	}
	return hubInstance;
}

export function createHub(): CrossPlatformHub {
	hubInstance = new CrossPlatformHub();
	return hubInstance;
}
