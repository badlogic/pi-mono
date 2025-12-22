import type { AgentState, AppMessage } from "@mariozechner/pi-agent-core";
import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir } from "../config.js";

function uuidv4(): string {
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

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
	firstKeptEntryIndex: number;
	tokensBefore: number;
}

export type SessionEntry =
	| SessionHeader
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry;

export interface LoadedSession {
	messages: AppMessage[];
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
}

export interface SessionInfo {
	path: string;
	id: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
}

export const SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const SUMMARY_SUFFIX = `
</summary>`;

export function createSummaryMessage(summary: string): AppMessage {
	return {
		role: "user",
		content: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX,
		timestamp: Date.now(),
	};
}

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

export function getLatestCompactionEntry(entries: SessionEntry[]): CompactionEntry | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") {
			return entries[i] as CompactionEntry;
		}
	}
	return null;
}

export function loadSessionFromEntries(entries: SessionEntry[]): LoadedSession {
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

	let latestCompactionIndex = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].type === "compaction") {
			latestCompactionIndex = i;
			break;
		}
	}

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

	const keptMessages: AppMessage[] = [];
	for (let i = compactionEvent.firstKeptEntryIndex; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type === "message") {
			keptMessages.push(entry.message);
		}
	}

	const messages: AppMessage[] = [];
	messages.push(createSummaryMessage(compactionEvent.summary));
	messages.push(...keptMessages);

	return { messages, thinkingLevel, model };
}

function getSessionDirectory(cwd: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const configDir = getAgentDir();
	const sessionDir = join(configDir, "sessions", safePath);
	if (!existsSync(sessionDir)) {
		mkdirSync(sessionDir, { recursive: true });
	}
	return sessionDir;
}

function loadEntriesFromFile(filePath: string): SessionEntry[] {
	if (!existsSync(filePath)) return [];

	const content = readFileSync(filePath, "utf8");
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

function extractSessionIdFromFile(filePath: string): string | null {
	if (!existsSync(filePath)) return null;

	const lines = readFileSync(filePath, "utf8").trim().split("\n");
	for (const line of lines) {
		try {
			const entry = JSON.parse(line);
			if (entry.type === "session") {
				return entry.id;
			}
		} catch {
			// Skip malformed lines
		}
	}
	return null;
}

function findMostRecentSession(sessionDir: string): string | null {
	try {
		const files = readdirSync(sessionDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => ({
				path: join(sessionDir, f),
				mtime: statSync(join(sessionDir, f)).mtime,
			}))
			.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

		return files[0]?.path || null;
	} catch {
		return null;
	}
}

export class SessionManager {
	private sessionId: string;
	private sessionFile: string;
	private sessionDir: string;
	private cwd: string;
	private enabled: boolean;
	private sessionInitialized: boolean;
	private pendingEntries: SessionEntry[] = [];
	private inMemoryEntries: SessionEntry[] = [];

	private constructor(cwd: string, sessionFile: string | null, enabled: boolean) {
		this.cwd = cwd;
		this.sessionDir = getSessionDirectory(cwd);
		this.enabled = enabled;

		if (sessionFile) {
			this.sessionFile = resolve(sessionFile);
			this.sessionId = extractSessionIdFromFile(this.sessionFile) ?? uuidv4();
			this.sessionInitialized = existsSync(this.sessionFile);
			if (this.sessionInitialized) {
				this.inMemoryEntries = loadEntriesFromFile(this.sessionFile);
			}
		} else {
			this.sessionId = uuidv4();
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			this.sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
			this.sessionInitialized = false;
		}
	}

	/** Create a new session for the given directory */
	static create(cwd: string): SessionManager {
		return new SessionManager(cwd, null, true);
	}

	/** Open a specific session file */
	static open(path: string): SessionManager {
		// Extract cwd from session header if possible, otherwise use process.cwd()
		const entries = loadEntriesFromFile(path);
		const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
		const cwd = header?.cwd ?? process.cwd();
		return new SessionManager(cwd, path, true);
	}

	/** Continue the most recent session for the given directory, or create new if none */
	static continueRecent(cwd: string): SessionManager {
		const sessionDir = getSessionDirectory(cwd);
		const mostRecent = findMostRecentSession(sessionDir);
		if (mostRecent) {
			return new SessionManager(cwd, mostRecent, true);
		}
		return new SessionManager(cwd, null, true);
	}

	/** Create an in-memory session (no file persistence) */
	static inMemory(): SessionManager {
		return new SessionManager(process.cwd(), null, false);
	}

	/** List all sessions for a directory */
	static list(cwd: string): SessionInfo[] {
		const sessionDir = getSessionDirectory(cwd);
		const sessions: SessionInfo[] = [];

		try {
			const files = readdirSync(sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => join(sessionDir, f));

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

							if (entry.type === "session" && !sessionId) {
								sessionId = entry.id;
								created = new Date(entry.timestamp);
							}

							if (entry.type === "message") {
								messageCount++;

								if (entry.message.role === "user" || entry.message.role === "assistant") {
									const textContent = entry.message.content
										.filter((c: any) => c.type === "text")
										.map((c: any) => c.text)
										.join(" ");

									if (textContent) {
										allMessages.push(textContent);

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
				} catch {
					// Skip files that can't be read
				}
			}

			sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
		} catch {
			// Return empty list on error
		}

		return sessions;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	getCwd(): string {
		return this.cwd;
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}

	/** Switch to a different session file (used for resume and branching) */
	setSessionFile(path: string): void {
		this.sessionFile = resolve(path);
		this.sessionId = extractSessionIdFromFile(this.sessionFile) ?? uuidv4();
		this.sessionInitialized = existsSync(this.sessionFile);
		if (this.sessionInitialized) {
			this.inMemoryEntries = loadEntriesFromFile(this.sessionFile);
		} else {
			this.inMemoryEntries = [];
		}
		this.pendingEntries = [];
	}

	reset(): void {
		this.pendingEntries = [];
		this.inMemoryEntries = [];
		this.sessionInitialized = false;
		this.sessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
	}

	startSession(state: AgentState): void {
		if (this.sessionInitialized) return;
		this.sessionInitialized = true;

		const entry: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: this.cwd,
			provider: state.model.provider,
			modelId: state.model.id,
			thinkingLevel: state.thinkingLevel,
		};

		this.inMemoryEntries.push(entry);
		for (const pending of this.pendingEntries) {
			this.inMemoryEntries.push(pending);
		}
		this.pendingEntries = [];

		if (this.enabled) {
			appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
			for (const memEntry of this.inMemoryEntries.slice(1)) {
				appendFileSync(this.sessionFile, `${JSON.stringify(memEntry)}\n`);
			}
		}
	}

	saveMessage(message: any): void {
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};

		if (!this.sessionInitialized) {
			this.pendingEntries.push(entry);
		} else {
			this.inMemoryEntries.push(entry);
			if (this.enabled) {
				appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
			}
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
			if (this.enabled) {
				appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
			}
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
			if (this.enabled) {
				appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
			}
		}
	}

	saveCompaction(entry: CompactionEntry): void {
		this.inMemoryEntries.push(entry);
		if (this.enabled) {
			appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
		}
	}

	loadSession(): LoadedSession {
		const entries = this.loadEntries();
		return loadSessionFromEntries(entries);
	}

	loadMessages(): AppMessage[] {
		return this.loadSession().messages;
	}

	loadThinkingLevel(): string {
		return this.loadSession().thinkingLevel;
	}

	loadModel(): { provider: string; modelId: string } | null {
		return this.loadSession().model;
	}

	loadEntries(): SessionEntry[] {
		if (this.enabled && existsSync(this.sessionFile)) {
			return loadEntriesFromFile(this.sessionFile);
		}
		return [...this.inMemoryEntries];
	}

	shouldInitializeSession(messages: any[]): boolean {
		if (this.sessionInitialized) return false;

		const userMessages = messages.filter((m) => m.role === "user");
		const assistantMessages = messages.filter((m) => m.role === "assistant");

		return userMessages.length >= 1 && assistantMessages.length >= 1;
	}

	createBranchedSession(state: any, branchFromIndex: number): string {
		const newSessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		const entry: SessionHeader = {
			type: "session",
			id: newSessionId,
			timestamp: new Date().toISOString(),
			cwd: this.cwd,
			provider: state.model.provider,
			modelId: state.model.id,
			thinkingLevel: state.thinkingLevel,
			branchedFrom: this.sessionFile,
		};
		appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);

		if (branchFromIndex >= 0) {
			const messagesToWrite = state.messages.slice(0, branchFromIndex + 1);
			for (const message of messagesToWrite) {
				const messageEntry: SessionMessageEntry = {
					type: "message",
					timestamp: new Date().toISOString(),
					message,
				};
				appendFileSync(newSessionFile, `${JSON.stringify(messageEntry)}\n`);
			}
		}

		return newSessionFile;
	}

	createBranchedSessionFromEntries(entries: SessionEntry[], branchBeforeIndex: number): string | null {
		const newSessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.sessionDir, `${timestamp}_${newSessionId}.jsonl`);

		const newEntries: SessionEntry[] = [];
		for (let i = 0; i < branchBeforeIndex; i++) {
			const entry = entries[i];

			if (entry.type === "session") {
				newEntries.push({
					...entry,
					id: newSessionId,
					timestamp: new Date().toISOString(),
					branchedFrom: this.enabled ? this.sessionFile : undefined,
				});
			} else {
				newEntries.push(entry);
			}
		}

		if (this.enabled) {
			for (const entry of newEntries) {
				appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
			}
			return newSessionFile;
		}
		this.inMemoryEntries = newEntries;
		this.sessionId = newSessionId;
		return null;
	}
}
