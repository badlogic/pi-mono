import type { AppMessage } from "@mariozechner/pi-agent-core";
import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir as getDefaultAgentDir } from "../config.js";

export const CURRENT_SESSION_VERSION = 2;

function uuidv4(): string {
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ============================================================================
// Session Header (metadata, not part of conversation tree)
// ============================================================================

export interface SessionHeader {
	type: "session";
	version?: number; // v1 sessions don't have this
	id: string;
	timestamp: string;
	cwd: string;
	branchedFrom?: string;
}

// ============================================================================
// Tree Node (added by SessionManager to all conversation entries)
// ============================================================================

export interface TreeNode {
	id: string;
	parentId: string | null;
	timestamp: string;
}

// ============================================================================
// Content Types (what distinguishes entries - used for input)
// ============================================================================

export interface MessageContent {
	type: "message";
	message: AppMessage;
}

export interface ThinkingLevelContent {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface ModelChangeContent {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface CompactionContent {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
}

export interface BranchSummaryContent {
	type: "branch_summary";
	summary: string;
}

/** Union of all content types (for input) */
export type ConversationContent =
	| MessageContent
	| ThinkingLevelContent
	| ModelChangeContent
	| CompactionContent
	| BranchSummaryContent;

// ============================================================================
// Full Entry Types (TreeNode + Content - returned from SessionManager)
// ============================================================================

export type SessionMessageEntry = TreeNode & MessageContent;
export type ThinkingLevelChangeEntry = TreeNode & ThinkingLevelContent;
export type ModelChangeEntry = TreeNode & ModelChangeContent;
export type CompactionEntry = TreeNode & CompactionContent;
export type BranchSummaryEntry = TreeNode & BranchSummaryContent;

/** Session entry - has id/parentId for tree structure */
export type SessionEntry =
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry;

/** @deprecated Use SessionEntry */
export type ConversationEntry = SessionEntry;

/** Raw file entry (includes header) */
export type FileEntry = SessionHeader | SessionEntry;

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

/**
 * Migrate v1 entries to v2 format by adding id/parentId fields.
 * Mutates entries in place. Safe to call on already-migrated entries.
 */
export function migrateSessionEntries(entries: FileEntry[]): void {
	// Check if already migrated
	const firstConv = entries.find((e) => e.type !== "session");
	if (firstConv && "id" in firstConv && firstConv.id) {
		return; // Already migrated
	}

	let prevId: string | null = null;
	for (const entry of entries) {
		if (entry.type === "session") {
			entry.version = CURRENT_SESSION_VERSION;
			continue;
		}

		// Add id/parentId to conversation entries
		const convEntry = entry as ConversationEntry;
		convEntry.id = uuidv4();
		convEntry.parentId = prevId;
		prevId = convEntry.id;

		// Convert firstKeptEntryIndex to firstKeptEntryId for compaction
		if (entry.type === "compaction") {
			const comp = entry as CompactionEntry & { firstKeptEntryIndex?: number };
			if (typeof comp.firstKeptEntryIndex === "number") {
				// Find the entry at that index and get its id
				const targetEntry = entries[comp.firstKeptEntryIndex];
				if (targetEntry && targetEntry.type !== "session") {
					comp.firstKeptEntryId = (targetEntry as ConversationEntry).id;
				}
				delete comp.firstKeptEntryIndex;
			}
		}
	}
}

/** Exported for compaction.test.ts */
export function parseSessionEntries(content: string): FileEntry[] {
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
 * Build the session context from entries using tree traversal.
 * If leafId is provided, walks from that entry to root.
 * Handles compaction and branch summaries along the path.
 */
export function buildSessionContext(entries: SessionEntry[], leafId?: string): SessionContext {
	// Build uuid index
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) {
		byId.set(entry.id, entry);
	}

	// Find leaf
	let leaf: SessionEntry | undefined;
	if (leafId) {
		leaf = byId.get(leafId);
	} else {
		leaf = entries[entries.length - 1];
	}

	if (!leaf) {
		return { messages: [], thinkingLevel: "off", model: null };
	}

	// Walk from leaf to root, collecting path
	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}

	// Extract settings and find compaction
	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;
	let compaction: CompactionEntry | null = null;

	for (const entry of path) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		} else if (entry.type === "compaction") {
			compaction = entry;
		}
	}

	// Build messages - handle compaction ordering correctly
	// When there's a compaction, we need to:
	// 1. Emit summary first
	// 2. Emit kept messages (from firstKeptEntryId up to compaction)
	// 3. Emit messages after compaction
	const messages: AppMessage[] = [];

	if (compaction) {
		// Emit summary first
		messages.push(createSummaryMessage(compaction.summary));

		// Find compaction index in path
		const compactionIdx = path.findIndex((e) => e.type === "compaction" && e.id === compaction.id);

		// Emit kept messages (before compaction, starting from firstKeptEntryId)
		let foundFirstKept = false;
		for (let i = 0; i < compactionIdx; i++) {
			const entry = path[i];
			if (entry.id === compaction.firstKeptEntryId) {
				foundFirstKept = true;
			}
			if (foundFirstKept && entry.type === "message") {
				messages.push(entry.message);
			}
		}

		// Emit messages after compaction
		for (let i = compactionIdx + 1; i < path.length; i++) {
			const entry = path[i];
			if (entry.type === "message") {
				messages.push(entry.message);
			} else if (entry.type === "branch_summary") {
				messages.push(createSummaryMessage(entry.summary));
			}
		}
	} else {
		// No compaction - emit all messages, handle branch summaries
		for (const entry of path) {
			if (entry.type === "message") {
				messages.push(entry.message);
			} else if (entry.type === "branch_summary") {
				messages.push(createSummaryMessage(entry.summary));
			}
		}
	}

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

function loadEntriesFromFile(filePath: string): FileEntry[] {
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
	private inMemoryEntries: FileEntry[] = [];

	// Tree structure (v2)
	private byId: Map<string, ConversationEntry> = new Map();
	private leafId: string = "";

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
			this._initNewSession();
		}
	}

	/** Switch to a different session file (used for resume and branching) */
	setSessionFile(sessionFile: string): void {
		this.sessionFile = resolve(sessionFile);
		if (existsSync(this.sessionFile)) {
			this.inMemoryEntries = loadEntriesFromFile(this.sessionFile);
			const header = this.inMemoryEntries.find((e) => e.type === "session") as SessionHeader | undefined;
			this.sessionId = header?.id ?? uuidv4();

			// Migrate v1 to v2 if needed
			const version = header?.version ?? 1;
			if (version < CURRENT_SESSION_VERSION) {
				this._migrateToV2();
				this._rewriteFile();
			}

			this._buildIndex();
			this.flushed = true;
		} else {
			this._initNewSession();
		}
	}

	private _initNewSession(): void {
		this.sessionId = uuidv4();
		const timestamp = new Date().toISOString();
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: this.sessionId,
			timestamp,
			cwd: this.cwd,
		};
		this.inMemoryEntries = [header];
		this.byId.clear();
		this.leafId = "";
		this.flushed = false;
		const fileTimestamp = timestamp.replace(/[:.]/g, "-");
		this.sessionFile = join(this.getSessionDir(), `${fileTimestamp}_${this.sessionId}.jsonl`);
	}

	private _migrateToV2(): void {
		migrateSessionEntries(this.inMemoryEntries);
	}

	private _buildIndex(): void {
		this.byId.clear();
		this.leafId = "";
		for (const entry of this.inMemoryEntries) {
			if (entry.type === "session") continue;
			this.byId.set(entry.id, entry);
			this.leafId = entry.id;
		}
	}

	private _rewriteFile(): void {
		if (!this.persist) return;
		const content = `${this.inMemoryEntries.map((e) => JSON.stringify(e)).join("\n")}\n`;
		writeFileSync(this.sessionFile, content);
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
		this._initNewSession();
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

	private _appendEntry(entry: ConversationEntry): void {
		this.inMemoryEntries.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
		this._persist(entry);
	}

	saveMessage(message: AppMessage): string {
		const entry: SessionMessageEntry = {
			type: "message",
			id: uuidv4(),
			parentId: this.leafId || null,
			timestamp: new Date().toISOString(),
			message,
		};
		this._appendEntry(entry);
		return entry.id;
	}

	saveThinkingLevelChange(thinkingLevel: string): string {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			id: uuidv4(),
			parentId: this.leafId || null,
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};
		this._appendEntry(entry);
		return entry.id;
	}

	saveModelChange(provider: string, modelId: string): string {
		const entry: ModelChangeEntry = {
			type: "model_change",
			id: uuidv4(),
			parentId: this.leafId || null,
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		};
		this._appendEntry(entry);
		return entry.id;
	}

	saveCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string {
		const entry: CompactionEntry = {
			type: "compaction",
			id: uuidv4(),
			parentId: this.leafId || null,
			timestamp: new Date().toISOString(),
			summary,
			firstKeptEntryId,
			tokensBefore,
		};
		this._appendEntry(entry);
		return entry.id;
	}

	// =========================================================================
	// Tree Traversal
	// =========================================================================

	getLeafUuid(): string {
		return this.leafId;
	}

	getEntry(id: string): ConversationEntry | undefined {
		return this.byId.get(id);
	}

	/** Walk from entry to root, returning path (conversation entries only) */
	getPath(fromId?: string): ConversationEntry[] {
		const path: ConversationEntry[] = [];
		let current = this.byId.get(fromId ?? this.leafId);
		while (current) {
			path.unshift(current);
			current = current.parentId ? this.byId.get(current.parentId) : undefined;
		}
		return path;
	}

	/**
	 * Build the session context (what gets sent to the LLM).
	 * Uses tree traversal from current leaf.
	 */
	buildSessionContext(): SessionContext {
		return buildSessionContext(this.getEntries(), this.leafId);
	}

	/**
	 * Get session header.
	 */
	getHeader(): SessionHeader | null {
		const h = this.inMemoryEntries.find((e) => e.type === "session");
		return h ? (h as SessionHeader) : null;
	}

	/**
	 * Get all session entries (excludes header). Returns a defensive copy.
	 * Use buildSessionContext() if you need the messages for the LLM.
	 */
	getEntries(): SessionEntry[] {
		return this.inMemoryEntries.filter((e): e is SessionEntry => e.type !== "session");
	}

	// =========================================================================
	// Branching
	// =========================================================================

	/** Branch in-place by changing the leaf pointer */
	branchInPlace(branchFromId: string): void {
		if (!this.byId.has(branchFromId)) {
			throw new Error(`Entry ${branchFromId} not found`);
		}
		this.leafId = branchFromId;
	}

	/** Branch with a summary of the abandoned path */
	branchWithSummary(branchFromId: string, summary: string): string {
		if (!this.byId.has(branchFromId)) {
			throw new Error(`Entry ${branchFromId} not found`);
		}
		this.leafId = branchFromId;
		const entry: BranchSummaryEntry = {
			type: "branch_summary",
			id: uuidv4(),
			parentId: branchFromId,
			timestamp: new Date().toISOString(),
			summary,
		};
		this._appendEntry(entry);
		return entry.id;
	}

	createBranchedSessionFromEntries(entries: FileEntry[], branchBeforeIndex: number): string | null {
		const newSessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newSessionFile = join(this.getSessionDir(), `${timestamp}_${newSessionId}.jsonl`);

		const newEntries: FileEntry[] = [];
		for (let i = 0; i < branchBeforeIndex; i++) {
			const entry = entries[i];

			if (entry.type === "session") {
				newEntries.push({
					...entry,
					version: CURRENT_SESSION_VERSION,
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
		this._buildIndex();
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
