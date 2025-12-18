/**
 * Session Storage Layer
 * Filesystem-based persistence for agent sessions
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type {
	AgentSession,
	CreateSessionOptions,
	SessionFilter,
	SessionStats,
	SessionSummary,
	UpdateSessionOptions,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default sessions directory
const SESSIONS_DIR = join(__dirname, "..", "sessions");

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 9);
	return `session_${timestamp}_${random}`;
}

/**
 * Get session directory path
 */
function getSessionDir(sessionId: string): string {
	return join(SESSIONS_DIR, sessionId);
}

/**
 * Get session file path
 */
function getSessionPath(sessionId: string): string {
	return join(getSessionDir(sessionId), "session.json");
}

/**
 * Ensure sessions directory exists
 */
function ensureSessionsDir(): void {
	if (!existsSync(SESSIONS_DIR)) {
		mkdirSync(SESSIONS_DIR, { recursive: true });
	}
}

/**
 * Create a new session
 */
export function createSession(options: CreateSessionOptions): AgentSession {
	ensureSessionsDir();

	const now = new Date().toISOString();
	const sessionId = generateSessionId();

	const session: AgentSession = {
		id: sessionId,
		userId: options.userId,
		channelId: options.channelId,
		mode: options.mode,
		task: options.task,
		workspace: options.workspace,
		status: "active",
		createdAt: now,
		updatedAt: now,
		iterations: 0,
		maxIterations: options.maxIterations || 100,
		context: options.context || {},
		history: [
			{
				timestamp: now,
				type: "start",
				data: {
					task: options.task,
					mode: options.mode,
					workspace: options.workspace,
				},
			},
		],
		metadata: options.metadata,
	};

	// Create session directory
	const sessionDir = getSessionDir(sessionId);
	mkdirSync(sessionDir, { recursive: true });

	// Write session file
	const sessionPath = getSessionPath(sessionId);
	writeFileSync(sessionPath, JSON.stringify(session, null, 2));

	return session;
}

/**
 * Get a session by ID
 */
export function getSession(sessionId: string): AgentSession | null {
	const sessionPath = getSessionPath(sessionId);

	if (!existsSync(sessionPath)) {
		return null;
	}

	try {
		const content = readFileSync(sessionPath, "utf-8");
		return JSON.parse(content) as AgentSession;
	} catch (error) {
		console.error(`Failed to load session ${sessionId}:`, error);
		return null;
	}
}

/**
 * Update an existing session
 */
export function updateSession(sessionId: string, updates: UpdateSessionOptions): AgentSession | null {
	const session = getSession(sessionId);
	if (!session) {
		return null;
	}

	const now = new Date().toISOString();

	// Apply updates
	if (updates.status !== undefined) {
		session.status = updates.status;
	}
	if (updates.iterations !== undefined) {
		session.iterations = updates.iterations;
	}
	if (updates.context !== undefined) {
		session.context = { ...session.context, ...updates.context };
	}
	if (updates.result !== undefined) {
		session.result = updates.result;
	}
	if (updates.error !== undefined) {
		session.error = updates.error;
	}
	if (updates.metadata !== undefined) {
		session.metadata = { ...session.metadata, ...updates.metadata };
	}

	session.updatedAt = now;

	// Save updated session
	const sessionPath = getSessionPath(sessionId);
	writeFileSync(sessionPath, JSON.stringify(session, null, 2));

	return session;
}

/**
 * Save a session (overwrites existing)
 */
export function saveSession(session: AgentSession): void {
	session.updatedAt = new Date().toISOString();
	const sessionPath = getSessionPath(session.id);
	writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

/**
 * List sessions with optional filtering
 */
export function listSessions(filter?: SessionFilter): SessionSummary[] {
	ensureSessionsDir();

	if (!existsSync(SESSIONS_DIR)) {
		return [];
	}

	const sessionDirs = readdirSync(SESSIONS_DIR, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name);

	const sessions: SessionSummary[] = [];

	for (const sessionId of sessionDirs) {
		const session = getSession(sessionId);
		if (!session) continue;

		// Apply filters
		if (filter?.userId && session.userId !== filter.userId) continue;
		if (filter?.channelId && session.channelId !== filter.channelId) continue;
		if (filter?.mode && session.mode !== filter.mode) continue;

		if (filter?.status) {
			const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
			if (!statuses.includes(session.status)) continue;
		}

		if (filter?.createdAfter && session.createdAt < filter.createdAfter) continue;
		if (filter?.createdBefore && session.createdAt > filter.createdBefore) continue;

		sessions.push({
			id: session.id,
			mode: session.mode,
			status: session.status,
			task: session.task,
			userId: session.userId,
			channelId: session.channelId,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			iterations: session.iterations,
			maxIterations: session.maxIterations,
		});
	}

	// Sort by creation time (newest first)
	sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

	// Apply pagination
	const offset = filter?.offset || 0;
	const limit = filter?.limit || sessions.length;

	return sessions.slice(offset, offset + limit);
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
	const sessionDir = getSessionDir(sessionId);

	if (!existsSync(sessionDir)) {
		return false;
	}

	try {
		rmSync(sessionDir, { recursive: true, force: true });
		return true;
	} catch (error) {
		console.error(`Failed to delete session ${sessionId}:`, error);
		return false;
	}
}

/**
 * Clean up old sessions
 */
export function cleanupOldSessions(maxAgeMs: number): number {
	ensureSessionsDir();

	const now = Date.now();
	const sessions = listSessions();
	let cleanedCount = 0;

	for (const summary of sessions) {
		const createdTime = new Date(summary.createdAt).getTime();
		const age = now - createdTime;

		// Skip active/paused sessions
		if (summary.status === "active" || summary.status === "paused") {
			continue;
		}

		// Delete if too old
		if (age > maxAgeMs) {
			if (deleteSession(summary.id)) {
				cleanedCount++;
			}
		}
	}

	return cleanedCount;
}

/**
 * Get session statistics
 */
export function getSessionStats(filter?: Omit<SessionFilter, "limit" | "offset">): SessionStats {
	const sessions = listSessions(filter);

	const stats: SessionStats = {
		total: sessions.length,
		byStatus: {
			active: 0,
			paused: 0,
			completed: 0,
			failed: 0,
			timeout: 0,
		},
		byMode: {},
		averageIterations: 0,
		successRate: 0,
	};

	if (sessions.length === 0) {
		return stats;
	}

	let totalIterations = 0;
	let successCount = 0;

	for (const session of sessions) {
		// Count by status
		stats.byStatus[session.status]++;

		// Count by mode
		stats.byMode[session.mode] = (stats.byMode[session.mode] || 0) + 1;

		// Sum iterations
		totalIterations += session.iterations;

		// Count successes
		if (session.status === "completed") {
			successCount++;
		}
	}

	stats.averageIterations = totalIterations / sessions.length;
	stats.successRate = (successCount / sessions.length) * 100;

	return stats;
}

/**
 * Export session to JSON
 */
export function exportSession(sessionId: string): string | null {
	const session = getSession(sessionId);
	if (!session) {
		return null;
	}
	return JSON.stringify(session, null, 2);
}

/**
 * Import session from JSON
 */
export function importSession(sessionJson: string): AgentSession | null {
	try {
		const session = JSON.parse(sessionJson) as AgentSession;

		// Create session directory
		const sessionDir = getSessionDir(session.id);
		mkdirSync(sessionDir, { recursive: true });

		// Write session file
		const sessionPath = getSessionPath(session.id);
		writeFileSync(sessionPath, JSON.stringify(session, null, 2));

		return session;
	} catch (error) {
		console.error("Failed to import session:", error);
		return null;
	}
}
