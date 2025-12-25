/**
 * Context management for mom.
 *
 * Mom uses two files per channel:
 * - context.jsonl: Structured API messages for LLM context (same format as coding-agent sessions)
 * - log.jsonl: Human-readable channel history for grep (no tool results)
 *
 * This module provides:
 * - MomSessionManager: Adapts coding-agent's SessionManager for channel-based storage
 * - MomSettingsManager: Simple settings for mom (compaction, retry, model preferences)
 */

import type { AppMessage } from "@mariozechner/pi-agent-core";
import {
	buildSessionContext,
	type CompactionEntry,
	type FileEntry,
	type LoadedSession,
	type MessageContent,
	type ModelChangeContent,
	type ModelChangeEntry,
	type SessionEntry,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
	type ThinkingLevelContent,
	type TreeNode,
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
// MomSessionManager - Channel-based session management
// ============================================================================

/**
 * Session manager for mom, storing context per Slack channel.
 *
 * Unlike coding-agent which creates timestamped session files, mom uses
 * a single context.jsonl per channel that persists across all @mentions.
 */
export class MomSessionManager {
	private sessionId: string;
	private contextFile: string;
	private logFile: string;
	private channelDir: string;
	private flushed: boolean = false;
	private inMemoryEntries: FileEntry[] = [];
	private leafId: string | null = null;

	constructor(channelDir: string) {
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
			this._updateLeafId();
			this.flushed = true;
		} else {
			this.sessionId = uuidv4();
			this.inMemoryEntries = [
				{
					type: "session",
					version: 2,
					id: this.sessionId,
					timestamp: new Date().toISOString(),
					cwd: this.channelDir,
				},
			];
		}
		// Note: syncFromLog() is called explicitly from agent.ts with excludeTimestamp
	}

	private _updateLeafId(): void {
		for (let i = this.inMemoryEntries.length - 1; i >= 0; i--) {
			const entry = this.inMemoryEntries[i];
			if (entry.type !== "session") {
				this.leafId = entry.id;
				return;
			}
		}
		this.leafId = null;
	}

	private _createTreeNode(): TreeNode {
		const id = uuidv4();
		const node: TreeNode = {
			id,
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
		};
		this.leafId = id;
		return node;
	}

	private _persist(entry: SessionEntry): void {
		const hasAssistant = this.inMemoryEntries.some((e) => e.type === "message" && e.message.role === "assistant");
		if (!hasAssistant) return;

		if (!this.flushed) {
			for (const e of this.inMemoryEntries) {
				appendFileSync(this.contextFile, `${JSON.stringify(e)}\n`);
			}
			this.flushed = true;
		} else {
			appendFileSync(this.contextFile, `${JSON.stringify(entry)}\n`);
		}
	}

	/**
	 * Sync user messages from log.jsonl that aren't in context.jsonl.
	 *
	 * log.jsonl and context.jsonl must have the same user messages.
	 * This handles:
	 * - Backfilled messages (mom was offline)
	 * - Messages that arrived while mom was processing a previous turn
	 * - Channel chatter between @mentions
	 *
	 * Channel chatter is formatted as "[username]: message" to distinguish from direct @mentions.
	 *
	 * Called before each agent run.
	 *
	 * @param excludeSlackTs Slack timestamp of current message (will be added via prompt(), not sync)
	 */
	syncFromLog(excludeSlackTs?: string): void {
		if (!existsSync(this.logFile)) return;

		// Build set of Slack timestamps already in context
		// We store slackTs in the message content or can extract from formatted messages
		// For messages synced from log, we use the log's date as the entry timestamp
		// For messages added via prompt(), they have different timestamps
		// So we need to match by content OR by stored slackTs
		const contextSlackTimestamps = new Set<string>();
		const contextMessageTexts = new Set<string>();

		for (const entry of this.inMemoryEntries) {
			if (entry.type === "message") {
				const msgEntry = entry as SessionMessageEntry;
				// Store the entry timestamp (which is the log date for synced messages)
				contextSlackTimestamps.add(entry.timestamp);

				// Also store message text to catch duplicates added via prompt()
				// AppMessage has different shapes, check for content property
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

		// Read log.jsonl and find user messages not in context
		const logContent = readFileSync(this.logFile, "utf-8");
		const logLines = logContent.trim().split("\n").filter(Boolean);

		interface LogMessage {
			date?: string;
			ts?: string;
			user?: string;
			userName?: string;
			text?: string;
			isBot?: boolean;
		}

		const newMessages: Array<{ timestamp: string; slackTs: string; message: AppMessage }> = [];

		for (const line of logLines) {
			try {
				const logMsg: LogMessage = JSON.parse(line);

				const slackTs = logMsg.ts;
				const date = logMsg.date;
				if (!slackTs || !date) continue;

				// Skip the current message being processed (will be added via prompt())
				if (excludeSlackTs && slackTs === excludeSlackTs) continue;

				// Skip bot messages - added through agent flow
				if (logMsg.isBot) continue;

				// Skip if this date is already in context (was synced before)
				if (contextSlackTimestamps.has(date)) continue;

				// Build the message text as it would appear in context
				const messageText = `[${logMsg.userName || logMsg.user || "unknown"}]: ${logMsg.text || ""}`;

				// Skip if this exact message text is already in context (added via prompt())
				if (contextMessageTexts.has(messageText)) continue;

				const msgTime = new Date(date).getTime() || Date.now();
				const userMessage: AppMessage = {
					role: "user",
					content: messageText,
					timestamp: msgTime,
				};

				newMessages.push({ timestamp: date, slackTs, message: userMessage });
			} catch {
				// Skip malformed lines
			}
		}

		if (newMessages.length === 0) return;

		// Sort by timestamp and add to context
		newMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		for (const { timestamp, message } of newMessages) {
			const id = uuidv4();
			const entry: SessionMessageEntry = {
				type: "message",
				id,
				parentId: this.leafId,
				timestamp, // Use log date as entry timestamp for consistent deduplication
				message,
			};
			this.leafId = id;

			this.inMemoryEntries.push(entry);
			appendFileSync(this.contextFile, `${JSON.stringify(entry)}\n`);
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

	private loadEntriesFromFile(): FileEntry[] {
		if (!existsSync(this.contextFile)) return [];

		const content = readFileSync(this.contextFile, "utf8");
		const entries: FileEntry[] = [];
		const lines = content.trim().split("\n");

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as FileEntry;
				entries.push(entry);
			} catch {
				// Skip malformed lines
			}
		}

		return entries;
	}

	saveMessage(message: AppMessage): void {
		const content: MessageContent = { type: "message", message };
		const entry: SessionMessageEntry = { ...this._createTreeNode(), ...content };
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	saveThinkingLevelChange(thinkingLevel: string): void {
		const content: ThinkingLevelContent = { type: "thinking_level_change", thinkingLevel };
		const entry: ThinkingLevelChangeEntry = { ...this._createTreeNode(), ...content };
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	saveModelChange(provider: string, modelId: string): void {
		const content: ModelChangeContent = { type: "model_change", provider, modelId };
		const entry: ModelChangeEntry = { ...this._createTreeNode(), ...content };
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	saveCompaction(entry: CompactionEntry): void {
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	/** Load session with compaction support */
	loadSession(): LoadedSession {
		const entries = this.loadEntries();
		return buildSessionContext(entries);
	}

	loadEntries(): SessionEntry[] {
		// Re-read from file to get latest state
		const entries = existsSync(this.contextFile) ? this.loadEntriesFromFile() : this.inMemoryEntries;
		return entries.filter((e): e is SessionEntry => e.type !== "session");
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.contextFile;
	}

	/** Reset session (clears context.jsonl) */
	reset(): void {
		this.sessionId = uuidv4();
		this.flushed = false;
		this.inMemoryEntries = [
			{
				type: "session",
				id: this.sessionId,
				timestamp: new Date().toISOString(),
				cwd: this.channelDir,
			},
		];
		// Truncate the context file
		if (existsSync(this.contextFile)) {
			writeFileSync(this.contextFile, "");
		}
	}

	// Compatibility methods for AgentSession
	isPersisted(): boolean {
		return true;
	}

	setSessionFile(_path: string): void {
		// No-op for mom - we always use the channel's context.jsonl
	}

	loadModel(): { provider: string; modelId: string } | null {
		return this.loadSession().model;
	}

	loadThinkingLevel(): string {
		return this.loadSession().thinkingLevel;
	}

	/** Not used by mom but required by AgentSession interface */
	createBranchedSessionFromEntries(_entries: SessionEntry[], _branchBeforeIndex: number): string | null {
		return null; // Mom doesn't support branching
	}
}

// ============================================================================
// MomSettingsManager - Simple settings for mom
// ============================================================================

export interface MomCompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export interface MomRetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
}

export interface MomSettings {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
	compaction?: Partial<MomCompactionSettings>;
	retry?: Partial<MomRetrySettings>;
}

const DEFAULT_COMPACTION: MomCompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
};

const DEFAULT_RETRY: MomRetrySettings = {
	enabled: true,
	maxRetries: 3,
	baseDelayMs: 2000,
};

/**
 * Settings manager for mom.
 * Stores settings in the workspace root directory.
 */
export class MomSettingsManager {
	private settingsPath: string;
	private settings: MomSettings;

	constructor(workspaceDir: string) {
		this.settingsPath = join(workspaceDir, "settings.json");
		this.settings = this.load();
	}

	private load(): MomSettings {
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

	getCompactionSettings(): MomCompactionSettings {
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

	getRetrySettings(): MomRetrySettings {
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
		this.settings.defaultThinkingLevel = level as MomSettings["defaultThinkingLevel"];
		this.save();
	}

	// Compatibility methods for AgentSession
	getQueueMode(): "all" | "one-at-a-time" {
		return "one-at-a-time"; // Mom processes one message at a time
	}

	setQueueMode(_mode: "all" | "one-at-a-time"): void {
		// No-op for mom
	}

	getHookPaths(): string[] {
		return []; // Mom doesn't use hooks
	}

	getHookTimeout(): number {
		return 30000;
	}
}

// ============================================================================
// Sync log.jsonl to context.jsonl
// ============================================================================

/**
 * Sync user messages from log.jsonl to context.jsonl.
 *
 * This ensures that messages logged while mom wasn't running (channel chatter,
 * backfilled messages, messages while busy) are added to the LLM context.
 *
 * @param channelDir - Path to channel directory
 * @param excludeAfterTs - Don't sync messages with ts >= this value (they'll be handled by agent)
 * @returns Number of messages synced
 */
export function syncLogToContext(channelDir: string, excludeAfterTs?: string): number {
	const logFile = join(channelDir, "log.jsonl");
	const contextFile = join(channelDir, "context.jsonl");

	if (!existsSync(logFile)) return 0;

	// Read all user messages from log.jsonl
	const logContent = readFileSync(logFile, "utf-8");
	const logLines = logContent.trim().split("\n").filter(Boolean);

	interface LogEntry {
		ts: string;
		user: string;
		userName?: string;
		text: string;
		isBot: boolean;
	}

	const logMessages: LogEntry[] = [];
	for (const line of logLines) {
		try {
			const entry = JSON.parse(line) as LogEntry;
			// Only sync user messages (not bot responses)
			if (!entry.isBot && entry.ts && entry.text) {
				// Skip if >= excludeAfterTs
				if (excludeAfterTs && entry.ts >= excludeAfterTs) continue;
				logMessages.push(entry);
			}
		} catch {}
	}

	if (logMessages.length === 0) return 0;

	// Read existing timestamps from context.jsonl
	if (existsSync(contextFile)) {
		const contextContent = readFileSync(contextFile, "utf-8");
		const contextLines = contextContent.trim().split("\n").filter(Boolean);
		for (const line of contextLines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message" && entry.message?.role === "user" && entry.message?.timestamp) {
					// Extract ts from timestamp (ms -> slack ts format for comparison)
					// We store the original slack ts in a way we can recover
					// Actually, let's just check by content match since ts formats differ
				}
			} catch {}
		}
	}

	// For deduplication, we need to track what's already in context
	// Read context and extract user message content (strip attachments section for comparison)
	const existingMessages = new Set<string>();
	if (existsSync(contextFile)) {
		const contextContent = readFileSync(contextFile, "utf-8");
		const contextLines = contextContent.trim().split("\n").filter(Boolean);
		for (const line of contextLines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message" && entry.message?.role === "user") {
					let content =
						typeof entry.message.content === "string" ? entry.message.content : entry.message.content?.[0]?.text;
					if (content) {
						// Strip timestamp prefix for comparison (live messages have it, log messages don't)
						// Format: [YYYY-MM-DD HH:MM:SS+HH:MM] [username]: text
						content = content.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\] /, "");
						// Strip attachments section for comparison (live messages have it, log messages don't)
						const attachmentsIdx = content.indexOf("\n\n<slack_attachments>\n");
						if (attachmentsIdx !== -1) {
							content = content.substring(0, attachmentsIdx);
						}
						existingMessages.add(content);
					}
				}
			} catch {}
		}
	}

	// Add missing messages to context.jsonl
	let syncedCount = 0;
	for (const msg of logMessages) {
		const userName = msg.userName || msg.user;
		const content = `[${userName}]: ${msg.text}`;

		// Skip if already in context
		if (existingMessages.has(content)) continue;

		const timestamp = Math.floor(parseFloat(msg.ts) * 1000);
		const entry = {
			type: "message",
			timestamp: new Date(timestamp).toISOString(),
			message: {
				role: "user",
				content,
				timestamp,
			},
		};

		// Ensure directory exists
		if (!existsSync(channelDir)) {
			mkdirSync(channelDir, { recursive: true });
		}

		appendFileSync(contextFile, `${JSON.stringify(entry)}\n`);
		existingMessages.add(content); // Track to avoid duplicates within this sync
		syncedCount++;
	}

	return syncedCount;
}
