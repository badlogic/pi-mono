import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { dirname, join, relative } from "path";
import * as log from "../../log.js";

export interface DiscordAttachment {
	original: string;
	local: string; // path relative to working dir (e.g., "discord/<guildId>/<channelId>/attachments/<file>")
}

export interface DiscordLoggedMessage {
	date: string; // ISO 8601 date
	ts: string; // Discord message ID (snowflake) or epoch ms
	user: string; // user ID (or "bot" for bot responses)
	userName?: string;
	displayName?: string;
	text: string;
	attachments: DiscordAttachment[];
	isBot: boolean;
}

export interface DiscordChannelStoreConfig {
	workingDir: string;
}

interface PendingDownload {
	localPath: string; // relative to workingDir
	url: string;
}

export class DiscordChannelStore {
	private workingDir: string;
	private pendingDownloads: PendingDownload[] = [];
	private isDownloading = false;
	private recentlyLogged = new Map<string, number>();

	constructor(config: DiscordChannelStoreConfig) {
		this.workingDir = config.workingDir;

		if (!existsSync(this.workingDir)) {
			mkdirSync(this.workingDir, { recursive: true });
		}
	}

	getChannelDir(channelId: string, guildId?: string): string {
		const dir = guildId
			? join(this.workingDir, "discord", guildId, channelId)
			: join(this.workingDir, "discord", "dm", channelId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	generateLocalFilename(originalName: string, timestamp: string): string {
		// Discord message IDs are snowflakes and can exceed JS safe integer range.
		// Use the raw timestamp/id string when possible to preserve uniqueness and avoid precision loss.
		const ts = /^[0-9]+$/.test(timestamp) ? timestamp : String(Date.now());
		const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
		return `${ts}_${sanitized}`;
	}

	processAttachments(
		channelId: string,
		files: Array<{ name: string; url: string }>,
		timestamp: string,
		guildId?: string,
	): DiscordAttachment[] {
		const attachments: DiscordAttachment[] = [];
		const channelDir = this.getChannelDir(channelId, guildId);

		for (const file of files) {
			if (!file.url || !file.name) continue;

			const filename = this.generateLocalFilename(file.name, timestamp);
			const localPath = join(channelDir, "attachments", filename);
			const relativeLocalPath = relative(this.workingDir, localPath).replaceAll("\\", "/");

			attachments.push({
				original: file.name,
				local: relativeLocalPath,
			});

			this.pendingDownloads.push({ localPath: relativeLocalPath, url: file.url });
		}

		this.processDownloadQueue();
		return attachments;
	}

	async logMessage(channelId: string, message: DiscordLoggedMessage, guildId?: string): Promise<boolean> {
		// Only dedupe user messages. For bot messages we intentionally allow repeated logs even if the message is edited
		// (Discord "primary" output is typically an edited message, reusing the same messageId).
		if (!message.isBot) {
			const dedupeKey = `${guildId || "dm"}:${channelId}:${message.ts}`;
			if (this.recentlyLogged.has(dedupeKey)) return false;

			this.recentlyLogged.set(dedupeKey, Date.now());
			setTimeout(() => this.recentlyLogged.delete(dedupeKey), 60000);
		}

		const logPath = join(this.getChannelDir(channelId, guildId), "log.jsonl");
		const line = JSON.stringify(message) + "\n";
		await appendFile(logPath, line, "utf-8");
		return true;
	}

	async logBotResponse(channelId: string, text: string, ts: string, guildId?: string): Promise<void> {
		await this.logMessage(
			channelId,
			{
				date: new Date().toISOString(),
				ts,
				user: "bot",
				text,
				attachments: [],
				isBot: true,
			},
			guildId,
		);
	}

	getLastTimestamp(channelId: string, guildId?: string): string | null {
		const logPath = join(this.getChannelDir(channelId, guildId), "log.jsonl");
		if (!existsSync(logPath)) return null;

		try {
			const content = readFileSync(logPath, "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0 || lines[0] === "") return null;
			const lastLine = lines[lines.length - 1];
			const message = JSON.parse(lastLine) as DiscordLoggedMessage;
			return message.ts;
		} catch {
			return null;
		}
	}

	private async processDownloadQueue(): Promise<void> {
		if (this.isDownloading || this.pendingDownloads.length === 0) return;

		this.isDownloading = true;

		while (this.pendingDownloads.length > 0) {
			const item = this.pendingDownloads.shift();
			if (!item) break;

			try {
				await this.downloadAttachment(item.localPath, item.url);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				log.logWarning("Failed to download Discord attachment", `${item.localPath}: ${errorMsg}`);
			}
		}

		this.isDownloading = false;
	}

	private async downloadAttachment(relativeLocalPath: string, url: string): Promise<void> {
		const filePath = join(this.workingDir, relativeLocalPath);
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Discord attachments are public CDN URLs.
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const buffer = await response.arrayBuffer();
		await writeFile(filePath, Buffer.from(buffer));
	}
}
