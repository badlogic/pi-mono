import type { AppMessage } from "@mariozechner/pi-agent-core";
import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir as getDefaultAgentDir } from "../config.js";

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

export interface SessionContext {
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

/** Exported for compaction.test.ts */
export function createSummaryMessage(summary: string): AppMessage {
	return {
		role: "user",
		content: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX,
		timestamp: Date.now(),
	};
}

/** Exported for compaction.test.ts */
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

/**
 * Build the session context from entries. This is what gets sent to the LLM.
 *
 * If there's a compaction entry, returns the summary message plus messages
 * from `firstKeptEntryIndex` onwards. Otherwise returns all messages.
 *
 * Also extracts the current thinking level and model from the entries.
 */
export function buildSessionContext(entries: SessionEntry[]): SessionContext {
	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;

	for (const entry of entries) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
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

/**
 * Compute the default session directory for a cwd.
 * Encodes cwd into a safe directory name under ~/.pi/agent/sessions/.
 */
function getDefaultSessionDir(cwd: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const sessionDir = join(getDefaultAgentDir(), "sessions", safePath);
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
	private sessionId: string = "";
	private sessionFile: string = "";
	private sessionDir: string;
	private cwd: string;
	private persist: boolean;
	private flushed: boolean = false;
	private inMemoryEntries: SessionEntry[] = [];

	private constructor(cwd: string, sessionDir: string, sessionFile: string | null, persist: boolean) {
		this.cwd = cwd;
		this.sessionDir = sessionDir;
		if (persist && sessionDir && !existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}
		this.persist = persist;

		if (sessionFile) {
			this.setSessionFile(sessionFile);
		} else {
			this.sessionId = uuidv4();
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const sessionFile = join(this.getSessionDir(), `${timestamp}_${this.sessionId}.jsonl`);
			this.setSessionFile(sessionFile);
		}
	}

	/** Switch to a different session file (used for resume and branching) */
	setSessionFile(sessionFile: string): void {
		this.sessionFile = resolve(sessionFile);
		if (existsSync(this.sessionFile)) {
			this.inMemoryEntries = loadEntriesFromFile(this.sessionFile);
			const header = this.inMemoryEntries.find((e) => e.type === "session");
			this.sessionId = header ? (header as SessionHeader).id : uuidv4();
			this.flushed = true;
		} else {
			this.sessionId = uuidv4();
			this.inMemoryEntries = [];
			this.flushed = false;
			const entry: SessionHeader = {
				type: "session",
				id: this.sessionId,
				timestamp: new Date().toISOString(),
				cwd: this.cwd,
			};
			this.inMemoryEntries.push(entry);
		}
	}

	isPersisted(): boolean {
		return this.persist;
	}

	getCwd(): string {
		return this.cwd;
	}

	getSessionDir(): string {
		return this.sessionDir;
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}

	reset(): void {
		this.sessionId = uuidv4();
		this.flushed = false;
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.sessionFile = join(this.getSessionDir(), `${timestamp}_${this.sessionId}.jsonl`);
		this.inMemoryEntries = [
			{
				type: "session",
				id: this.sessionId,
				timestamp: new Date().toISOString(),
				cwd: this.cwd,
			},
		];
	}

	_persist(entry: SessionEntry): void {
		if (!this.persist) return;

		const hasAssistant = this.inMemoryEntries.some((e) => e.type === "message" && e.message.role === "assistant");
		if (!hasAssistant) return;

		if (!this.flushed) {
			for (const e of this.inMemoryEntries) {
				appendFileSync(this.sessionFile, `${JSON.stringify(e)}\n`);
			}
			this.flushed = true;
		} else {
			appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
		}
	}

	saveMessage(message: AppMessage): void {
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	saveThinkingLevelChange(thinkingLevel: string): void {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	saveModelChange(provider: string, modelId: string): void {
		const entry: ModelChangeEntry = {
			type: "model_change",
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		};
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	saveCompaction(entry: CompactionEntry): void {
		this.inMemoryEntries.push(entry);
		this._persist(entry);
	}

	/**
	 * Build the session context (what gets sent to the LLM).
	 * If compacted, returns summary + kept messages. Otherwise all messages.
	 * Includes thinking level and model.
	 */
	buildSessionContext(): SessionContext {
		return buildSessionContext(this.getEntries());
	}

	/**
	 * Get all session entries. Returns a defensive copy.
	 * Use buildSessionContext() if you need the messages for the LLM.
	 */
	getEntries(): SessionEntry[] {
		return [...this.inMemoryEntries];
	}

	createBranchedSessionFromEntries(entries: SessionEntry[], branchBeforeIndex: number): string | null {
		const newSessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.getSessionDir(), `${timestamp}_${newSessionId}.jsonl`);

		const newEntries: SessionEntry[] = [];
		for (let i = 0; i < branchBeforeIndex; i++) {
			const entry = entries[i];

			if (entry.type === "session") {
				newEntries.push({
					...entry,
					id: newSessionId,
					timestamp: new Date().toISOString(),
					branchedFrom: this.persist ? this.sessionFile : undefined,
				});
			} else {
				newEntries.push(entry);
			}
		}

		if (this.persist) {
			for (const entry of newEntries) {
				appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
			}
			return newSessionFile;
		}
		this.inMemoryEntries = newEntries;
		this.sessionId = newSessionId;
		return null;
	}

	/**
	 * Create a new session.
	 * @param cwd Working directory (stored in session header)
	 * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
	 */
	static create(cwd: string, sessionDir?: string): SessionManager {
		const dir = sessionDir ?? getDefaultSessionDir(cwd);
		return new SessionManager(cwd, dir, null, true);
	}

	/**
	 * Open a specific session file.
	 * @param path Path to session file
	 * @param sessionDir Optional session directory for /new or /branch. If omitted, derives from file's parent.
	 */
	static open(path: string, sessionDir?: string): SessionManager {
		// Extract cwd from session header if possible, otherwise use process.cwd()
		const entries = loadEntriesFromFile(path);
		const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
		const cwd = header?.cwd ?? process.cwd();
		// If no sessionDir provided, derive from file's parent directory
		const dir = sessionDir ?? resolve(path, "..");
		return new SessionManager(cwd, dir, path, true);
	}

	/**
	 * Continue the most recent session, or create new if none.
	 * @param cwd Working directory
	 * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
	 */
	static continueRecent(cwd: string, sessionDir?: string): SessionManager {
		const dir = sessionDir ?? getDefaultSessionDir(cwd);
		const mostRecent = findMostRecentSession(dir);
		if (mostRecent) {
			return new SessionManager(cwd, dir, mostRecent, true);
		}
		return new SessionManager(cwd, dir, null, true);
	}

	/** Create an in-memory session (no file persistence) */
	static inMemory(cwd: string = process.cwd()): SessionManager {
		return new SessionManager(cwd, "", null, false);
	}

	/**
	 * List all sessions.
	 * @param cwd Working directory (used to compute default session directory)
	 * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
	 */
	static list(cwd: string, sessionDir?: string): SessionInfo[] {
		const dir = sessionDir ?? getDefaultSessionDir(cwd);
		const sessions: SessionInfo[] = [];

		try {
			const files = readdirSync(dir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => join(dir, f));

			for (const file of files) {
				try {
					const content = readFileSync(file, "utf8");
					const lines = content.trim().split("\n");
					if (lines.length === 0) continue;

					// Check first line for valid session header
					let header: { type: string; id: string; timestamp: string } | null = null;
					try {
						const first = JSON.parse(lines[0]);
						if (first.type === "session" && first.id) {
							header = first;
						}
					} catch {
						// Not valid JSON
					}
					if (!header) continue;

					const stats = statSync(file);
					let messageCount = 0;
					let firstMessage = "";
					const allMessages: string[] = [];

					for (let i = 1; i < lines.length; i++) {
						try {
							const entry = JSON.parse(lines[i]);

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
						id: header.id,
						created: new Date(header.timestamp),
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
}
