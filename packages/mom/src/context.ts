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
	private channelDir: string;
	private sessionInitialized: boolean = false;
	private inMemoryEntries: SessionEntry[] = [];
	private pendingEntries: SessionEntry[] = [];

	constructor(channelDir: string, initialModel?: { provider: string; id: string; thinkingLevel?: string }) {
		this.channelDir = channelDir;
		this.contextFile = join(channelDir, "context.jsonl");

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
			// New session - write header immediately
			this.sessionId = uuidv4();
			if (initialModel) {
				this.writeSessionHeader(initialModel);
			}
		}
	}

	/** Write session header to file (called on new session creation) */
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
 * @param options - Transport-specific exclusion rules
 * @returns Number of messages synced
 */
export type SyncLogToContextOptions =
	| { mode: "slack"; excludeAfterTs?: string }
	| { mode: "discord"; excludeTs?: string };

export function syncLogToContext(channelDir: string, options?: SyncLogToContextOptions): number {
	const logFile = join(channelDir, "log.jsonl");
	const contextFile = join(channelDir, "context.jsonl");

	if (!existsSync(logFile)) return 0;

	const timestampPrefixRegex = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\] /;

	const normalizeUserContentForDedup = (content: string): string => {
		let normalized = content.replace(timestampPrefixRegex, "");
		const attachmentsIdx =
			normalized.indexOf("\n\n<attachments>\n") !== -1
				? normalized.indexOf("\n\n<attachments>\n")
				: normalized.indexOf("\n\n<slack_attachments>\n");
		if (attachmentsIdx !== -1) {
			normalized = normalized.substring(0, attachmentsIdx);
		}
		return normalized;
	};

	// Track what is already in context:
	// - `existingLogDates`: ISO timestamps of messages that were synced from log.jsonl (NOT live prompts)
	// - `existingUserMessages`: normalized user message text (timestamp prefix stripped)
	const existingLogDates = new Set<string>();
	const existingUserMessages = new Set<string>();

	if (existsSync(contextFile)) {
		const contextContent = readFileSync(contextFile, "utf-8");
		const contextLines = contextContent.trim().split("\n").filter(Boolean);
		for (const line of contextLines) {
			try {
				const entry = JSON.parse(line) as {
					type?: string;
					timestamp?: string;
					message?: { role?: string; content?: unknown };
				};
				if (entry.type !== "message") continue;
				if (!entry.message || entry.message.role !== "user") continue;

				const rawContent =
					typeof entry.message.content === "string"
						? entry.message.content
						: Array.isArray(entry.message.content) && entry.message.content.length > 0
							? (entry.message.content[0] as { text?: string }).text
							: undefined;

				if (typeof rawContent !== "string") continue;

				const normalized = normalizeUserContentForDedup(rawContent);
				if (normalized) {
					existingUserMessages.add(normalized);
				}

				// Only treat the entry timestamp as a log-sync date if this message doesn't have the live prompt prefix.
				if (entry.timestamp && !timestampPrefixRegex.test(rawContent)) {
					existingLogDates.add(entry.timestamp);
				}
			} catch {
				// ignore malformed lines
			}
		}
	}

	const shouldExcludeByTs = (ts: string): boolean => {
		if (!options) return false;
		if (options.mode === "slack") {
			return Boolean(options.excludeAfterTs && ts >= options.excludeAfterTs);
		}
		return Boolean(options.excludeTs && ts === options.excludeTs);
	};

	// Read log.jsonl and append missing user messages to context.jsonl.
	const logContent = readFileSync(logFile, "utf-8");
	const logLines = logContent.trim().split("\n").filter(Boolean);

	interface LogEntry {
		date?: string;
		ts?: string;
		user?: string;
		userName?: string;
		text?: string;
		isBot?: boolean;
	}

	let syncedCount = 0;
	for (const line of logLines) {
		let entry: LogEntry;
		try {
			entry = JSON.parse(line) as LogEntry;
		} catch {
			continue;
		}

		if (entry.isBot) continue;
		if (!entry.ts || !entry.date) continue;
		if (shouldExcludeByTs(entry.ts)) continue;

		// Skip if this log entry was already synced by date.
		if (existingLogDates.has(entry.date)) continue;

		const userName = entry.userName || entry.user || "unknown";
		const text = entry.text || "";
		const content = `[${userName}]: ${text}`;

		// Skip if the same message already exists in context (e.g. was added via prompt()).
		if (existingUserMessages.has(content)) continue;

		const msgTime = new Date(entry.date).getTime();
		const timestampMs = Number.isFinite(msgTime) ? msgTime : Date.now();

		const newEntry: SessionMessageEntry = {
			type: "message",
			timestamp: entry.date,
			message: {
				role: "user",
				content,
				timestamp: timestampMs,
			},
		};

		if (!existsSync(channelDir)) {
			mkdirSync(channelDir, { recursive: true });
		}

		appendFileSync(contextFile, JSON.stringify(newEntry) + "\n");
		existingLogDates.add(entry.date);
		existingUserMessages.add(content);
		syncedCount++;
	}

	return syncedCount;
}
