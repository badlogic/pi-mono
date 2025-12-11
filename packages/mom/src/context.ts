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
	private sessionInitialized: boolean = false;
	private inMemoryEntries: SessionEntry[] = [];
	private pendingEntries: SessionEntry[] = [];

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
			this.sessionInitialized = this.inMemoryEntries.length > 0;
		} else {
			this.sessionId = uuidv4();
		}
		// Note: syncFromLog() is called explicitly from agent.ts with excludeTimestamp
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
	 * Called automatically on construction and should be called before each agent run.
	 *
	 * @param excludeTimestamp Optional timestamp to exclude (for the current @mention being processed)
	 */
	syncFromLog(excludeTimestamp?: string): void {
		if (!existsSync(this.logFile)) return;

		// Get timestamps of messages already in context
		const contextTimestamps = new Set<string>();
		for (const entry of this.inMemoryEntries) {
			if (entry.type === "message") {
				contextTimestamps.add(entry.timestamp);
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

		const newMessages: Array<{ timestamp: string; message: AppMessage }> = [];

		for (const line of logLines) {
			try {
				const logMsg: LogMessage = JSON.parse(line);

				// Use date for context timestamp (consistent key)
				const ts = logMsg.date || logMsg.ts;
				if (!ts) continue;

				// Skip if already in context
				if (contextTimestamps.has(ts)) continue;

				// Skip the current message being processed (will be added via prompt())
				// Compare against Slack ts since that's what ctx.message.ts provides
				if (excludeTimestamp && logMsg.ts === excludeTimestamp) continue;

				// Skip bot messages - added through agent flow
				if (logMsg.isBot) continue;

				const msgTime = new Date(ts).getTime() || Date.now();
				const userMessage: AppMessage = {
					role: "user",
					content: `[${logMsg.userName || logMsg.user || "unknown"}]: ${logMsg.text || ""}`,
					timestamp: msgTime,
				};

				newMessages.push({ timestamp: ts, message: userMessage });
			} catch {
				// Skip malformed lines
			}
		}

		if (newMessages.length === 0) return;

		// Sort by timestamp and add to context
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

		// Sync complete - newMessages.length messages added
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

	/** Initialize session with header if not already done */
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

		// Write to file
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

	/** Load session with compaction support */
	loadSession(): LoadedSession {
		const entries = this.loadEntries();
		return loadSessionFromEntries(entries);
	}

	loadEntries(): SessionEntry[] {
		// Re-read from file to get latest state
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

	/** Check if session should be initialized */
	shouldInitializeSession(messages: AppMessage[]): boolean {
		if (this.sessionInitialized) return false;
		const userMessages = messages.filter((m) => m.role === "user");
		const assistantMessages = messages.filter((m) => m.role === "assistant");
		return userMessages.length >= 1 && assistantMessages.length >= 1;
	}

	/** Reset session (clears context.jsonl) */
	reset(): void {
		this.pendingEntries = [];
		this.inMemoryEntries = [];
		this.sessionInitialized = false;
		this.sessionId = uuidv4();
		// Truncate the context file
		if (existsSync(this.contextFile)) {
			writeFileSync(this.contextFile, "");
		}
	}

	// Compatibility methods for AgentSession
	isEnabled(): boolean {
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
