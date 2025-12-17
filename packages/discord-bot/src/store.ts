/**
 * Channel storage for Pi Discord Bot
 * Adapted from pi-mom's store.ts for Discord
 *
 * Handles per-channel message logging and attachment management.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { join } from "path";
import * as log from "./log.js";

export interface Attachment {
	original: string; // original filename
	local: string; // path relative to working dir
}

export interface LoggedMessage {
	date: string; // ISO 8601 date
	messageId: string; // Discord message ID
	user: string; // user ID (or "bot" for bot responses)
	userName?: string; // username
	displayName?: string; // display name
	text: string;
	attachments: Attachment[];
	isBot: boolean;
}

export interface ChannelStoreConfig {
	workingDir: string;
}

export class ChannelStore {
	private workingDir: string;
	// Track recently logged message IDs to prevent duplicates
	private recentlyLogged = new Map<string, number>();

	constructor(config: ChannelStoreConfig) {
		this.workingDir = config.workingDir;

		if (!existsSync(this.workingDir)) {
			mkdirSync(this.workingDir, { recursive: true });
		}
	}

	/**
	 * Get or create the directory for a channel
	 */
	getChannelDir(channelId: string): string {
		const dir = join(this.workingDir, channelId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	/**
	 * Generate a unique local filename for an attachment
	 */
	generateLocalFilename(originalName: string, messageId: string): string {
		const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
		return `${messageId}_${sanitized}`;
	}

	/**
	 * Process attachments from a Discord message
	 * Returns attachment metadata
	 */
	processAttachments(
		channelId: string,
		attachments: Array<{ name: string; url: string }>,
		messageId: string,
	): Attachment[] {
		const result: Attachment[] = [];

		for (const attachment of attachments) {
			if (!attachment.name) {
				log.logWarning("Attachment missing name, skipping", attachment.url);
				continue;
			}

			const filename = this.generateLocalFilename(attachment.name, messageId);
			const localPath = `${channelId}/attachments/${filename}`;

			result.push({
				original: attachment.name,
				local: localPath,
			});

			// Queue download in background
			this.downloadAttachment(localPath, attachment.url).catch((err) => {
				log.logWarning(`Failed to download attachment ${attachment.name}`, String(err));
			});
		}

		return result;
	}

	/**
	 * Log a message to the channel's log.jsonl
	 * Returns false if message was already logged (duplicate)
	 */
	async logMessage(channelId: string, message: LoggedMessage): Promise<boolean> {
		const dedupeKey = `${channelId}:${message.messageId}`;
		if (this.recentlyLogged.has(dedupeKey)) {
			return false;
		}

		this.recentlyLogged.set(dedupeKey, Date.now());
		setTimeout(() => this.recentlyLogged.delete(dedupeKey), 60000);

		const logPath = join(this.getChannelDir(channelId), "log.jsonl");

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
	async logBotResponse(channelId: string, text: string, messageId: string): Promise<void> {
		await this.logMessage(channelId, {
			date: new Date().toISOString(),
			messageId,
			user: "bot",
			text,
			attachments: [],
			isBot: true,
		});
	}

	/**
	 * Get the timestamp of the last logged message for a channel
	 */
	getLastMessageId(channelId: string): string | null {
		const logPath = join(this.workingDir, channelId, "log.jsonl");
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
			return message.messageId;
		} catch {
			return null;
		}
	}

	/**
	 * Download an attachment
	 */
	private async downloadAttachment(localPath: string, url: string): Promise<void> {
		const filePath = join(this.workingDir, localPath);

		const dir = join(this.workingDir, localPath.substring(0, localPath.lastIndexOf("/")));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const buffer = await response.arrayBuffer();
		await writeFile(filePath, Buffer.from(buffer));
	}

	/**
	 * Read memory file (MEMORY.md) for a channel or workspace
	 */
	getMemory(channelDir: string): string {
		const parts: string[] = [];

		// Read workspace-level memory
		const workspaceMemoryPath = join(channelDir, "..", "MEMORY.md");
		if (existsSync(workspaceMemoryPath)) {
			try {
				const content = readFileSync(workspaceMemoryPath, "utf-8").trim();
				if (content) {
					parts.push("### Global Workspace Memory\n" + content);
				}
			} catch (error) {
				log.logWarning("Failed to read workspace memory", `${workspaceMemoryPath}: ${error}`);
			}
		}

		// Read channel-specific memory
		const channelMemoryPath = join(channelDir, "MEMORY.md");
		if (existsSync(channelMemoryPath)) {
			try {
				const content = readFileSync(channelMemoryPath, "utf-8").trim();
				if (content) {
					parts.push("### Channel-Specific Memory\n" + content);
				}
			} catch (error) {
				log.logWarning("Failed to read channel memory", `${channelMemoryPath}: ${error}`);
			}
		}

		if (parts.length === 0) {
			return "(no working memory yet)";
		}

		return parts.join("\n\n");
	}
}
