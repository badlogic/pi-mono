import type { AgentState, AppMessage } from "@mariozechner/pi-agent-core";
import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir } from "./config.js";

function uuidv4(): string {
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ============================================================================
// Session entry types
// ============================================================================

export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	provider: string;
	modelId: string;
	thinkingLevel: string;
	branchedFrom?: string;
}

export interface SessionMessageEntry {
	type: "message";
	timestamp: string;
	message: AppMessage;
}

export interface ThinkingLevelChangeEntry {
	type: "thinking_level_change";
	timestamp: string;
	thinkingLevel: string;
}

export interface ModelChangeEntry {
	type: "model_change";
	timestamp: string;
	provider: string;
	modelId: string;
}

export interface CompactionEntry {
	type: "compaction";
	timestamp: string;
	summary: string;
	firstKeptEntryIndex: number; // Index into session entries where we start keeping
	tokensBefore: number;
}

/** Union of all session entry types */
export type SessionEntry =
	| SessionHeader
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry;

// ============================================================================
// Session loading with compaction support
// ============================================================================

export interface LoadedSession {
	messages: AppMessage[];
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
}

export const SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const SUMMARY_SUFFIX = `
</summary>`;

/**
 * Create a user message containing the summary with the standard prefix.
 */
export function createSummaryMessage(summary: string): AppMessage {
	return {
		role: "user",
		content: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX,
		timestamp: Date.now(),
	};
}

/**
 * Parse session file content into entries.
 */
export function parseSessionEntries(content: string): SessionEntry[] {
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

/**
 * Load session from entries, handling compaction events.
 *
 * Algorithm:
 * 1. Find latest compaction event (if any)
 * 2. Keep all entries from firstKeptEntryIndex onwards (extracting messages)
 * 3. Prepend summary as user message
 */
/**
 * Get the latest compaction entry from session entries, if any.
 */
export function getLatestCompactionEntry(entries: SessionEntry[]): CompactionEntry | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") {
			return entries[i] as CompactionEntry;
		}
	}
	return null;
}

export function loadSessionFromEntries(entries: SessionEntry[]): LoadedSession {
	// Find model and thinking level (always scan all entries)
	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;

	for (const entry of entries) {
		if (entry.type === "session") {
			thinkingLevel = entry.thinkingLevel;
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		}
	}

	// Find latest compaction event
	let latestCompactionIndex = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") {
			latestCompactionIndex = i;
			break;
		}
	}

	// No compaction: return all messages
	if (latestCompactionIndex === -1) {
		const messages: AppMessage[] = [];
		for (const entry of entries) {
			if (entry.type === "message") {
				messages.push(entry.message);
			}
		}
		return { messages, thinkingLevel, model };
	}

	const compactionEvent = entries[latestCompactionIndex] as CompactionEntry;

	// Extract messages from firstKeptEntryIndex to end (skipping compaction entries)
	const keptMessages: AppMessage[] = [];
	for (let i = compactionEvent.firstKeptEntryIndex; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type === "message") {
			keptMessages.push(entry.message);
		}
	}

	// Build final messages: summary + kept messages
	const summaryMessage = createSummaryMessage(compactionEvent.summary);
	const messages = [summaryMessage, ...keptMessages];

	return { messages, thinkingLevel, model };
}

export class SessionManager {
	private sessionId!: string;
	private sessionFile!: string;
	private sessionDir: string;
	private enabled: boolean = true;
	private sessionInitialized: boolean = false;
	private pendingMessages: any[] = [];

	constructor(continueSession: boolean = false, customSessionPath?: string) {
		this.sessionDir = this.getSessionDirectory();

		if (customSessionPath) {
			// Use custom session file path
			this.sessionFile = resolve(customSessionPath);
			this.loadSessionId();
			// Mark as initialized since we're loading an existing session
			this.sessionInitialized = existsSync(this.sessionFile);
		} else if (continueSession) {
			const mostRecent = this.findMostRecentlyModifiedSession();
			if (mostRecent) {
				this.sessionFile = mostRecent;
				this.loadSessionId();
				// Mark as initialized since we're loading an existing session
				this.sessionInitialized = true;
			} else {
				this.initNewSession();
			}
		} else {
			this.initNewSession();
		}
	}

	/** Disable session saving (for --no-session mode) */
	disable() {
		this.enabled = false;
	}

	private getSessionDirectory(): string {
		const cwd = process.cwd();
		// Replace all path separators and colons (for Windows drive letters) with dashes
		const safePath = "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";

		const configDir = getAgentDir();
		const sessionDir = join(configDir, "sessions", safePath);
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}
		return sessionDir;
	}

	private initNewSession(): void {
		this.sessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
	}

	/** Reset to a fresh session. Clears pending messages and starts a new session file. */
	reset(): void {
		this.pendingMessages = [];
		this.sessionInitialized = false;
		this.initNewSession();
	}

	private findMostRecentlyModifiedSession(): string | null {
		try {
			const files = readdirSync(this.sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => ({
					name: f,
					path: join(this.sessionDir, f),
					mtime: statSync(join(this.sessionDir, f)).mtime,
				}))
				.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

			return files[0]?.path || null;
		} catch {
			return null;
		}
	}

	private loadSessionId(): void {
		if (!existsSync(this.sessionFile)) return;

		const lines = readFileSync(this.sessionFile, "utf8").trim().split("\n");
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session") {
					this.sessionId = entry.id;
					return;
				}
			} catch {
				// Skip malformed lines
			}
		}
		this.sessionId = uuidv4();
	}

	startSession(state: AgentState): void {
		if (!this.enabled || this.sessionInitialized) return;
		this.sessionInitialized = true;

		const entry: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: process.cwd(),
			provider: state.model.provider,
			modelId: state.model.id,
			thinkingLevel: state.thinkingLevel,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");

		// Write any queued messages
		for (const msg of this.pendingMessages) {
			appendFileSync(this.sessionFile, JSON.stringify(msg) + "\n");
		}
		this.pendingMessages = [];
	}

	saveMessage(message: any): void {
		if (!this.enabled) return;
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};

		if (!this.sessionInitialized) {
			this.pendingMessages.push(entry);
		} else {
			appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
		}
	}

	saveThinkingLevelChange(thinkingLevel: string): void {
		if (!this.enabled) return;
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};

		if (!this.sessionInitialized) {
			this.pendingMessages.push(entry);
		} else {
			appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
		}
	}

	saveModelChange(provider: string, modelId: string): void {
		if (!this.enabled) return;
		const entry: ModelChangeEntry = {
			type: "model_change",
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		};

		if (!this.sessionInitialized) {
			this.pendingMessages.push(entry);
		} else {
			appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
		}
	}

	saveCompaction(entry: CompactionEntry): void {
		if (!this.enabled) return;
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	/**
	 * Load session data (messages, model, thinking level) with compaction support.
	 */
	loadSession(): LoadedSession {
		const entries = this.loadEntries();
		return loadSessionFromEntries(entries);
	}

	/**
	 * @deprecated Use loadSession().messages instead
	 */
	loadMessages(): AppMessage[] {
		return this.loadSession().messages;
	}

	/**
	 * @deprecated Use loadSession().thinkingLevel instead
	 */
	loadThinkingLevel(): string {
		return this.loadSession().thinkingLevel;
	}

	/**
	 * @deprecated Use loadSession().model instead
	 */
	loadModel(): { provider: string; modelId: string } | null {
		return this.loadSession().model;
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}

	/**
	 * Load all entries from the session file.
	 */
	loadEntries(): SessionEntry[] {
		if (!existsSync(this.sessionFile)) return [];

		const content = readFileSync(this.sessionFile, "utf8");
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

	/**
	 * Load all sessions for the current directory with metadata
	 */
	loadAllSessions(): Array<{
		path: string;
		id: string;
		created: Date;
		modified: Date;
		messageCount: number;
		firstMessage: string;
		allMessagesText: string;
	}> {
		const sessions: Array<{
			path: string;
			id: string;
			created: Date;
			modified: Date;
			messageCount: number;
			firstMessage: string;
			allMessagesText: string;
		}> = [];

		try {
			const files = readdirSync(this.sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => join(this.sessionDir, f));

			for (const file of files) {
				try {
					const stats = statSync(file);
					const content = readFileSync(file, "utf8");
					const lines = content.trim().split("\n");

					let sessionId = "";
					let created = stats.birthtime;
					let messageCount = 0;
					let firstMessage = "";
					const allMessages: string[] = [];

					for (const line of lines) {
						try {
							const entry = JSON.parse(line);

							// Extract session ID from first session entry
							if (entry.type === "session" && !sessionId) {
								sessionId = entry.id;
								created = new Date(entry.timestamp);
							}

							// Count messages and collect all text
							if (entry.type === "message") {
								messageCount++;

								// Extract text from user and assistant messages
								if (entry.message.role === "user" || entry.message.role === "assistant") {
									const textContent = entry.message.content
										.filter((c: any) => c.type === "text")
										.map((c: any) => c.text)
										.join(" ");

									if (textContent) {
										allMessages.push(textContent);

										// Get first user message for display
										if (!firstMessage && entry.message.role === "user") {
											firstMessage = textContent;
										}
									}
								}
							}
						} catch {
							// Skip malformed lines
						}
					}

					sessions.push({
						path: file,
						id: sessionId || "unknown",
						created,
						modified: stats.mtime,
						messageCount,
						firstMessage: firstMessage || "(no messages)",
						allMessagesText: allMessages.join(" "),
					});
				} catch (error) {
					// Skip files that can't be read
					console.error(`Failed to read session file ${file}:`, error);
				}
			}

			// Sort by modified date (most recent first)
			sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
		} catch (error) {
			console.error("Failed to load sessions:", error);
		}

		return sessions;
	}

	/**
	 * Set the session file to an existing session
	 */
	setSessionFile(path: string): void {
		this.sessionFile = path;
		this.loadSessionId();
		// Mark as initialized since we're loading an existing session
		this.sessionInitialized = existsSync(path);
	}

	/**
	 * Check if we should initialize the session based on message history.
	 * Session is initialized when we have at least 1 user message and 1 assistant message.
	 */
	shouldInitializeSession(messages: any[]): boolean {
		if (this.sessionInitialized) return false;

		const userMessages = messages.filter((m) => m.role === "user");
		const assistantMessages = messages.filter((m) => m.role === "assistant");

		return userMessages.length >= 1 && assistantMessages.length >= 1;
	}

	/**
	 * Create a branched session from a specific message index.
	 * If branchFromIndex is -1, creates an empty session.
	 * Returns the new session file path.
	 */
	createBranchedSession(state: any, branchFromIndex: number): string {
		// Create a new session ID for the branch
		const newSessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		// Write session header
		const entry: SessionHeader = {
			type: "session",
			id: newSessionId,
			timestamp: new Date().toISOString(),
			cwd: process.cwd(),
			provider: state.model.provider,
			modelId: state.model.id,
			thinkingLevel: state.thinkingLevel,
			branchedFrom: this.sessionFile,
		};
		appendFileSync(newSessionFile, JSON.stringify(entry) + "\n");

		// Write messages up to and including the branch point (if >= 0)
		if (branchFromIndex >= 0) {
			const messagesToWrite = state.messages.slice(0, branchFromIndex + 1);
			for (const message of messagesToWrite) {
				const messageEntry: SessionMessageEntry = {
					type: "message",
					timestamp: new Date().toISOString(),
					message,
				};
				appendFileSync(newSessionFile, JSON.stringify(messageEntry) + "\n");
			}
		}

		return newSessionFile;
	}

	/**
	 * Create a branched session from session entries up to (but not including) a specific entry index.
	 * This preserves compaction events and all entry types.
	 * Returns the new session file path.
	 */
	createBranchedSessionFromEntries(entries: SessionEntry[], branchBeforeIndex: number): string {
		const newSessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		// Copy all entries up to (but not including) the branch point
		for (let i = 0; i < branchBeforeIndex; i++) {
			const entry = entries[i];

			if (entry.type === "session") {
				// Rewrite session header with new ID and branchedFrom
				const newHeader: SessionHeader = {
					...entry,
					id: newSessionId,
					timestamp: new Date().toISOString(),
					branchedFrom: this.sessionFile,
				};
				appendFileSync(newSessionFile, JSON.stringify(newHeader) + "\n");
			} else {
				// Copy other entries as-is
				appendFileSync(newSessionFile, JSON.stringify(entry) + "\n");
			}
		}

		return newSessionFile;
	}
}
