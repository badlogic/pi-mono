/**
 * Context management for Pi Discord Bot
 * Adapted from pi-mom's context.ts for Discord channels
 *
 * Uses two files per channel:
 * - context.jsonl: Structured API messages for LLM context
 * - log.jsonl: Human-readable channel history
 */

import type { AgentState, AppMessage } from "@mariozechner/pi-agent-core";
import {
	type CompactionEntry,
	type LoadedSession,
	loadSessionFromEntries,
	type ModelChangeEntry,
	type SessionEntry,
	type SessionHeader,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "@mariozechner/pi-coding-agent";
import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

function uuidv4(): string {
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ============================================================================
// DiscordSessionManager - Channel-based session management
// ============================================================================

/**
 * Session manager for Discord, storing context per channel.
 * Uses a single context.jsonl per channel that persists across messages.
 */
export class DiscordSessionManager {
	private sessionId: string;
	private contextFile: string;
	private logFile: string;
	private channelDir: string;
	private sessionInitialized: boolean = false;
	private inMemoryEntries: SessionEntry[] = [];
	private pendingEntries: SessionEntry[] = [];

	constructor(channelDir: string, initialModel?: { provider: string; id: string; thinkingLevel?: string }) {
		this.channelDir = channelDir;
		this.contextFile = join(channelDir, "context.jsonl");
		this.logFile = join(channelDir, "log.jsonl");

		// Ensure channel directory exists
		if (!existsSync(channelDir)) {
			mkdirSync(channelDir, { recursive: true });
		}

		// Load existing session or create new
		if (existsSync(this.contextFile)) {
			this.inMemoryEntries = this.loadEntriesFromFile();
			this.sessionId = this.extractSessionId() || uuidv4();
			this.sessionInitialized = this.inMemoryEntries.length > 0;
		} else {
			this.sessionId = uuidv4();
			if (initialModel) {
				this.writeSessionHeader(initialModel);
			}
		}
	}

	private writeSessionHeader(model: { provider: string; id: string; thinkingLevel?: string }): void {
		this.sessionInitialized = true;

		const entry: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: this.channelDir,
			provider: model.provider,
			modelId: model.id,
			thinkingLevel: model.thinkingLevel || "off",
		};

		this.inMemoryEntries.push(entry);
		appendFileSync(this.contextFile, JSON.stringify(entry) + "\n");
	}

	/**
	 * Sync user messages from log.jsonl that aren't in context.jsonl.
	 * Handles messages that arrived while bot was processing.
	 */
	syncFromLog(excludeMessageId?: string): void {
		if (!existsSync(this.logFile)) return;

		const contextTimestamps = new Set<string>();
		const contextMessageTexts = new Set<string>();

		for (const entry of this.inMemoryEntries) {
			if (entry.type === "message") {
				const msgEntry = entry as SessionMessageEntry;
				contextTimestamps.add(entry.timestamp);

				const msg = msgEntry.message as { role: string; content?: unknown };
				if (msg.role === "user" && msg.content !== undefined) {
					const content = msg.content;
					if (typeof content === "string") {
						contextMessageTexts.add(content);
					} else if (Array.isArray(content)) {
						for (const part of content) {
							if (
								typeof part === "object" &&
								part !== null &&
								"type" in part &&
								part.type === "text" &&
								"text" in part
							) {
								contextMessageTexts.add((part as { type: "text"; text: string }).text);
							}
						}
					}
				}
			}
		}

		const logContent = readFileSync(this.logFile, "utf-8");
		const logLines = logContent.trim().split("\n").filter(Boolean);

		interface LogMessage {
			date?: string;
			ts?: string;
			messageId?: string;
			user?: string;
			userName?: string;
			text?: string;
			isBot?: boolean;
		}

		const newMessages: Array<{ timestamp: string; message: AppMessage }> = [];

		for (const line of logLines) {
			try {
				const logMsg: LogMessage = JSON.parse(line);

				const date = logMsg.date;
				if (!date) continue;

				// Skip the current message being processed
				if (excludeMessageId && logMsg.messageId === excludeMessageId) continue;

				// Skip bot messages
				if (logMsg.isBot) continue;

				// Skip if already in context
				if (contextTimestamps.has(date)) continue;

				const messageText = `[${logMsg.userName || logMsg.user || "unknown"}]: ${logMsg.text || ""}`;

				if (contextMessageTexts.has(messageText)) continue;

				const msgTime = new Date(date).getTime() || Date.now();
				const userMessage: AppMessage = {
					role: "user",
					content: messageText,
					timestamp: msgTime,
				};

				newMessages.push({ timestamp: date, message: userMessage });
			} catch {
				// Skip malformed lines
			}
		}

		if (newMessages.length === 0) return;

		newMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		for (const { timestamp, message } of newMessages) {
			const entry: SessionMessageEntry = {
				type: "message",
				timestamp,
				message,
			};

			this.inMemoryEntries.push(entry);
			appendFileSync(this.contextFile, JSON.stringify(entry) + "\n");
		}
	}

	private extractSessionId(): string | null {
		for (const entry of this.inMemoryEntries) {
			if (entry.type === "session") {
				return entry.id;
			}
		}
		return null;
	}

	private loadEntriesFromFile(): SessionEntry[] {
		if (!existsSync(this.contextFile)) return [];

		const content = readFileSync(this.contextFile, "utf8");
		const entries: SessionEntry[] = [];
		const lines = content.trim().split("\n");

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as SessionEntry;
				entries.push(entry);
			} catch {
				// Skip malformed lines
			}
		}

		return entries;
	}

	startSession(state: AgentState): void {
		if (this.sessionInitialized) return;
		this.sessionInitialized = true;

		const entry: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: this.channelDir,
			provider: state.model?.provider || "unknown",
			modelId: state.model?.id || "unknown",
			thinkingLevel: state.thinkingLevel,
		};

		this.inMemoryEntries.push(entry);
		for (const pending of this.pendingEntries) {
			this.inMemoryEntries.push(pending);
		}
		this.pendingEntries = [];

		appendFileSync(this.contextFile, JSON.stringify(entry) + "\n");
		for (const memEntry of this.inMemoryEntries.slice(1)) {
			appendFileSync(this.contextFile, JSON.stringify(memEntry) + "\n");
		}
	}

	saveMessage(message: AppMessage): void {
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};

		if (!this.sessionInitialized) {
			this.pendingEntries.push(entry);
		} else {
			this.inMemoryEntries.push(entry);
			appendFileSync(this.contextFile, JSON.stringify(entry) + "\n");
		}
	}

	saveThinkingLevelChange(thinkingLevel: string): void {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};

		if (!this.sessionInitialized) {
			this.pendingEntries.push(entry);
		} else {
			this.inMemoryEntries.push(entry);
			appendFileSync(this.contextFile, JSON.stringify(entry) + "\n");
		}
	}

	saveModelChange(provider: string, modelId: string): void {
		const entry: ModelChangeEntry = {
			type: "model_change",
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		};

		if (!this.sessionInitialized) {
			this.pendingEntries.push(entry);
		} else {
			this.inMemoryEntries.push(entry);
			appendFileSync(this.contextFile, JSON.stringify(entry) + "\n");
		}
	}

	saveCompaction(entry: CompactionEntry): void {
		this.inMemoryEntries.push(entry);
		appendFileSync(this.contextFile, JSON.stringify(entry) + "\n");
	}

	loadSession(): LoadedSession {
		const entries = this.loadEntries();
		return loadSessionFromEntries(entries);
	}

	loadEntries(): SessionEntry[] {
		if (existsSync(this.contextFile)) {
			return this.loadEntriesFromFile();
		}
		return [...this.inMemoryEntries];
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.contextFile;
	}

	shouldInitializeSession(messages: AppMessage[]): boolean {
		if (this.sessionInitialized) return false;
		const userMessages = messages.filter((m) => m.role === "user");
		const assistantMessages = messages.filter((m) => m.role === "assistant");
		return userMessages.length >= 1 && assistantMessages.length >= 1;
	}

	reset(): void {
		this.pendingEntries = [];
		this.inMemoryEntries = [];
		this.sessionInitialized = false;
		this.sessionId = uuidv4();
		if (existsSync(this.contextFile)) {
			writeFileSync(this.contextFile, "");
		}
	}

	isEnabled(): boolean {
		return true;
	}

	setSessionFile(_path: string): void {
		// No-op - we always use the channel's context.jsonl
	}

	loadModel(): { provider: string; modelId: string } | null {
		return this.loadSession().model;
	}

	loadThinkingLevel(): string {
		return this.loadSession().thinkingLevel;
	}

	createBranchedSessionFromEntries(_entries: SessionEntry[], _branchBeforeIndex: number): string | null {
		return null; // Discord bot doesn't support branching
	}
}

// ============================================================================
// DiscordSettingsManager - Settings for Discord bot
// ============================================================================

export interface DiscordCompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export interface DiscordRetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
}

export interface DiscordSettings {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
	compaction?: Partial<DiscordCompactionSettings>;
	retry?: Partial<DiscordRetrySettings>;
}

const DEFAULT_COMPACTION: DiscordCompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
};

const DEFAULT_RETRY: DiscordRetrySettings = {
	enabled: true,
	maxRetries: 3,
	baseDelayMs: 2000,
};

/**
 * Settings manager for Discord bot.
 * Stores settings in the workspace root directory.
 */
export class DiscordSettingsManager {
	private settingsPath: string;
	private settings: DiscordSettings;

	constructor(workspaceDir: string) {
		this.settingsPath = join(workspaceDir, "settings.json");
		this.settings = this.load();
	}

	private load(): DiscordSettings {
		if (!existsSync(this.settingsPath)) {
			return {};
		}

		try {
			const content = readFileSync(this.settingsPath, "utf-8");
			return JSON.parse(content);
		} catch {
			return {};
		}
	}

	private save(): void {
		try {
			const dir = dirname(this.settingsPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf-8");
		} catch (error) {
			console.error(`Warning: Could not save settings file: ${error}`);
		}
	}

	getCompactionSettings(): DiscordCompactionSettings {
		return {
			...DEFAULT_COMPACTION,
			...this.settings.compaction,
		};
	}

	getCompactionEnabled(): boolean {
		return this.settings.compaction?.enabled ?? DEFAULT_COMPACTION.enabled;
	}

	setCompactionEnabled(enabled: boolean): void {
		this.settings.compaction = { ...this.settings.compaction, enabled };
		this.save();
	}

	getRetrySettings(): DiscordRetrySettings {
		return {
			...DEFAULT_RETRY,
			...this.settings.retry,
		};
	}

	getRetryEnabled(): boolean {
		return this.settings.retry?.enabled ?? DEFAULT_RETRY.enabled;
	}

	setRetryEnabled(enabled: boolean): void {
		this.settings.retry = { ...this.settings.retry, enabled };
		this.save();
	}

	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	getDefaultProvider(): string | undefined {
		return this.settings.defaultProvider;
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.settings.defaultProvider = provider;
		this.settings.defaultModel = modelId;
		this.save();
	}

	getDefaultThinkingLevel(): string {
		return this.settings.defaultThinkingLevel || "off";
	}

	setDefaultThinkingLevel(level: string): void {
		this.settings.defaultThinkingLevel = level as DiscordSettings["defaultThinkingLevel"];
		this.save();
	}

	getQueueMode(): "all" | "one-at-a-time" {
		return "one-at-a-time";
	}

	setQueueMode(_mode: "all" | "one-at-a-time"): void {
		// No-op
	}

	getHookPaths(): string[] {
		return [];
	}

	getHookTimeout(): number {
		return 30000;
	}
}
