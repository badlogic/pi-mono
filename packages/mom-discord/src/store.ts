import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { join } from "path";
import * as log from "./log.js";

export interface Attachment {
	original: string; // original filename from uploader
	local: string; // path relative to working dir
}

export interface LoggedMessage {
	date: string; // ISO 8601 date
	ts: string; // Discord message ID or epoch ms
	user: string; // user ID (or "bot" for bot responses)
	userName?: string; // Discord username
	displayName?: string; // Discord display name
	text: string;
	attachments: Attachment[];
	isBot: boolean;
}

export interface ChannelStoreConfig {
	workingDir: string;
	botToken: string; // needed for authenticated file downloads
}

interface PendingDownload {
	channelId: string;
	guildId?: string;
	localPath: string;
	url: string;
}

export class ChannelStore {
	private workingDir: string;
	private botToken: string;
	private pendingDownloads: PendingDownload[] = [];
	private isDownloading = false;
	private recentlyLogged = new Map<string, number>();

	constructor(config: ChannelStoreConfig) {
		this.workingDir = config.workingDir;
		this.botToken = config.botToken;

		if (!existsSync(this.workingDir)) {
			mkdirSync(this.workingDir, { recursive: true });
		}
	}

	/**
	 * Get or create the directory for a channel
	 * For Discord, we use guildId/channelId structure for guild channels
	 * and just channelId for DMs
	 */
	getChannelDir(channelId: string, guildId?: string): string {
		const dir = guildId ? join(this.workingDir, guildId, channelId) : join(this.workingDir, channelId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	/**
	 * Generate a unique local filename for an attachment
	 */
	generateLocalFilename(originalName: string, timestamp: string): string {
		const ts = parseInt(timestamp, 10) || Date.now();
		const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
		return `${ts}_${sanitized}`;
	}

	/**
	 * Process attachments from a Discord message
	 */
	processAttachments(
		channelId: string,
		files: Array<{ name: string; url: string }>,
		timestamp: string,
		guildId?: string,
	): Attachment[] {
		const attachments: Attachment[] = [];

		for (const file of files) {
			if (!file.url || !file.name) continue;

			const filename = this.generateLocalFilename(file.name, timestamp);
			const basePath = guildId ? `${guildId}/${channelId}` : channelId;
			const localPath = `${basePath}/attachments/${filename}`;

			attachments.push({
				original: file.name,
				local: localPath,
			});

			this.pendingDownloads.push({ channelId, guildId, localPath, url: file.url });
		}

		this.processDownloadQueue();
		return attachments;
	}

	/**
	 * Log a message to the channel's log.jsonl
	 */
	async logMessage(channelId: string, message: LoggedMessage, guildId?: string): Promise<boolean> {
		const dedupeKey = `${guildId || "dm"}:${channelId}:${message.ts}`;
		if (this.recentlyLogged.has(dedupeKey)) {
			return false;
		}

		this.recentlyLogged.set(dedupeKey, Date.now());
		setTimeout(() => this.recentlyLogged.delete(dedupeKey), 60000);

		const logPath = join(this.getChannelDir(channelId, guildId), "log.jsonl");

		if (!message.date) {
			message.date = new Date().toISOString();
		}

		const line = JSON.stringify(message) + "\n";
		await appendFile(logPath, line, "utf-8");
		return true;
	}

	/**
	 * Log a bot response
	 */
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

	/**
	 * Get the timestamp of the last logged message for a channel
	 */
	getLastTimestamp(channelId: string, guildId?: string): string | null {
		const logPath = join(this.getChannelDir(channelId, guildId), "log.jsonl");
		if (!existsSync(logPath)) {
			return null;
		}

		try {
			const content = readFileSync(logPath, "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0 || lines[0] === "") {
				return null;
			}
			const lastLine = lines[lines.length - 1];
			const message = JSON.parse(lastLine) as LoggedMessage;
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
				log.logWarning(`Failed to download attachment`, `${item.localPath}: ${errorMsg}`);
			}
		}

		this.isDownloading = false;
	}

	private async downloadAttachment(localPath: string, url: string): Promise<void> {
		const filePath = join(this.workingDir, localPath);

		const dir = join(this.workingDir, localPath.substring(0, localPath.lastIndexOf("/")));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Discord attachments are public CDN URLs, no auth needed
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const buffer = await response.arrayBuffer();
		await writeFile(filePath, Buffer.from(buffer));
	}
}
