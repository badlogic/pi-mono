/**
 * Session Lifecycle Manager
 * High-level API for managing agent session lifecycles
 */

import {
	cleanupOldSessions as storeCleanup,
	createSession as storeCreate,
	deleteSession as storeDelete,
	getSession as storeGet,
	listSessions as storeList,
	saveSession as storeSave,
	getSessionStats as storeStats,
	updateSession as storeUpdate,
} from "./store.js";
import type {
	AgentSession,
	CreateSessionOptions,
	SessionEvent,
	SessionEventType,
	SessionFilter,
	SessionStats,
	SessionSummary,
	SessionWebhookPayload,
} from "./types.js";

/**
 * Webhook URL for session notifications (optional)
 */
let webhookUrl: string | null = null;

/**
 * Configure webhook for session notifications
 */
export function configureWebhook(url: string | null): void {
	webhookUrl = url;
}

/**
 * Send webhook notification
 */
async function sendWebhook(payload: SessionWebhookPayload): Promise<void> {
	if (!webhookUrl) return;

	try {
		await fetch(webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	} catch (error) {
		console.error("Failed to send webhook:", error);
	}
}

/**
 * Start a new session
 */
export async function startSession(
	task: string,
	mode: string,
	options: Omit<CreateSessionOptions, "task" | "mode"> = {},
): Promise<AgentSession> {
	const session = storeCreate({
		task,
		mode,
		...options,
	});

	// Send webhook notification
	await sendWebhook({
		event: "start",
		session: {
			id: session.id,
			mode: session.mode,
			status: session.status,
			task: session.task,
			userId: session.userId,
			channelId: session.channelId,
		},
		timestamp: new Date().toISOString(),
		data: {
			workspace: session.workspace,
			maxIterations: session.maxIterations,
		},
	});

	return session;
}

/**
 * Pause a session for later resumption
 */
export async function pauseSession(sessionId: string, reason?: string): Promise<AgentSession | null> {
	const session = storeGet(sessionId);
	if (!session) return null;

	if (session.status !== "active") {
		throw new Error(`Cannot pause session in status: ${session.status}`);
	}

	const event: SessionEvent = {
		timestamp: new Date().toISOString(),
		type: "pause",
		data: { reason: reason || "User requested pause" },
	};

	session.history.push(event);
	session.status = "paused";
	session.context = {
		...session.context,
		pausedAt: event.timestamp,
		pauseReason: reason,
	};

	// Save with history
	storeSave(session);
	const updated = session;

	if (updated) {
		await sendWebhook({
			event: "pause",
			session: {
				id: updated.id,
				mode: updated.mode,
				status: updated.status,
				task: updated.task,
				userId: updated.userId,
				channelId: updated.channelId,
			},
			timestamp: event.timestamp,
			data: event.data,
		});
	}

	return updated;
}

/**
 * Resume a paused session
 */
export async function resumeSession(sessionId: string): Promise<AgentSession | null> {
	const session = storeGet(sessionId);
	if (!session) return null;

	if (session.status !== "paused") {
		throw new Error(`Cannot resume session in status: ${session.status}`);
	}

	const event: SessionEvent = {
		timestamp: new Date().toISOString(),
		type: "resume",
		data: {
			pausedDuration: session.context.pausedAt
				? Date.now() - new Date(session.context.pausedAt as string).getTime()
				: 0,
		},
	};

	session.history.push(event);
	session.status = "active";

	// Remove pause context
	const { pausedAt, pauseReason, ...restContext } = session.context;
	session.context = restContext;

	// Save with history
	storeSave(session);
	const updated = session;

	if (updated) {
		await sendWebhook({
			event: "resume",
			session: {
				id: updated.id,
				mode: updated.mode,
				status: updated.status,
				task: updated.task,
				userId: updated.userId,
				channelId: updated.channelId,
			},
			timestamp: event.timestamp,
			data: event.data,
		});
	}

	return updated;
}

/**
 * Add an event to session history
 */
export async function addEvent(
	sessionId: string,
	eventType: SessionEventType,
	data: Record<string, unknown> = {},
): Promise<boolean> {
	const session = storeGet(sessionId);
	if (!session) return false;

	const event: SessionEvent = {
		timestamp: new Date().toISOString(),
		type: eventType,
		data,
	};

	session.history.push(event);

	// Update iterations for iteration events
	if (eventType === "iteration") {
		session.iterations++;

		// Check if max iterations reached
		if (session.iterations >= session.maxIterations) {
			session.status = "timeout";
			await sendWebhook({
				event: "timeout",
				session: {
					id: session.id,
					mode: session.mode,
					status: "timeout",
					task: session.task,
					userId: session.userId,
					channelId: session.channelId,
				},
				timestamp: event.timestamp,
				data: { iterations: session.iterations, maxIterations: session.maxIterations },
			});
		}
	}

	// Handle completion
	if (eventType === "complete" || eventType === "error") {
		session.status = eventType === "complete" ? "completed" : "failed";

		await sendWebhook({
			event: eventType,
			session: {
				id: session.id,
				mode: session.mode,
				status: session.status,
				task: session.task,
				userId: session.userId,
				channelId: session.channelId,
			},
			timestamp: event.timestamp,
			data,
		});
	}

	// Save updated session with history
	storeSave(session);

	return true;
}

/**
 * Get accumulated context for session continuation
 */
export function getSessionContext(sessionId: string): Record<string, unknown> | null {
	const session = storeGet(sessionId);
	if (!session) return null;

	return {
		sessionId: session.id,
		task: session.task,
		mode: session.mode,
		workspace: session.workspace,
		iterations: session.iterations,
		maxIterations: session.maxIterations,
		context: session.context,
		recentHistory: session.history.slice(-10), // Last 10 events
		status: session.status,
	};
}

/**
 * Complete a session successfully
 */
export async function completeSession(sessionId: string, result: string): Promise<AgentSession | null> {
	const session = storeGet(sessionId);
	if (!session) return null;

	await addEvent(sessionId, "complete", { result });

	return storeUpdate(sessionId, {
		status: "completed",
		result,
	});
}

/**
 * Fail a session with error
 */
export async function failSession(sessionId: string, error: string): Promise<AgentSession | null> {
	const session = storeGet(sessionId);
	if (!session) return null;

	await addEvent(sessionId, "error", { error });

	return storeUpdate(sessionId, {
		status: "failed",
		error,
	});
}

/**
 * Update session context
 */
export function updateContext(sessionId: string, contextUpdates: Record<string, unknown>): AgentSession | null {
	return storeUpdate(sessionId, { context: contextUpdates });
}

/**
 * Increment iteration count
 */
export async function incrementIteration(sessionId: string, data: Record<string, unknown> = {}): Promise<boolean> {
	return addEvent(sessionId, "iteration", data);
}

/**
 * Record tool call
 */
export async function recordToolCall(
	sessionId: string,
	tool: string,
	args: unknown,
	result: unknown,
): Promise<boolean> {
	return addEvent(sessionId, "tool_call", {
		tool,
		args,
		result,
	});
}

/**
 * Record learning event
 */
export async function recordLearning(sessionId: string, insight: string, expertiseFile: string): Promise<boolean> {
	return addEvent(sessionId, "learning", {
		insight,
		expertiseFile,
	});
}

/**
 * Get session by ID
 */
export function getSession(sessionId: string): AgentSession | null {
	return storeGet(sessionId);
}

/**
 * List sessions with filtering
 */
export function listSessions(filter?: SessionFilter): SessionSummary[] {
	return storeList(filter);
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
	return storeDelete(sessionId);
}

/**
 * Clean up old sessions (default: older than 30 days)
 */
export function cleanupOldSessions(maxAgeDays = 30): number {
	const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
	return storeCleanup(maxAgeMs);
}

/**
 * Get session statistics
 */
export function getSessionStats(filter?: Omit<SessionFilter, "limit" | "offset">): SessionStats {
	return storeStats(filter);
}

/**
 * Get active sessions
 */
export function getActiveSessions(filter?: Omit<SessionFilter, "status">): SessionSummary[] {
	return storeList({ ...filter, status: "active" });
}

/**
 * Get paused sessions
 */
export function getPausedSessions(filter?: Omit<SessionFilter, "status">): SessionSummary[] {
	return storeList({ ...filter, status: "paused" });
}

/**
 * Get completed sessions
 */
export function getCompletedSessions(filter?: Omit<SessionFilter, "status">): SessionSummary[] {
	return storeList({ ...filter, status: "completed" });
}

/**
 * Get failed sessions
 */
export function getFailedSessions(filter?: Omit<SessionFilter, "status">): SessionSummary[] {
	return storeList({ ...filter, status: "failed" });
}

/**
 * Check if session exists and is resumable
 */
export function isSessionResumable(sessionId: string): boolean {
	const session = storeGet(sessionId);
	if (!session) return false;
	return session.status === "paused" || session.status === "active";
}

/**
 * Get session duration in milliseconds
 */
export function getSessionDuration(sessionId: string): number | null {
	const session = storeGet(sessionId);
	if (!session) return null;

	const start = new Date(session.createdAt).getTime();
	const end = new Date(session.updatedAt).getTime();

	return end - start;
}

/**
 * Get session progress (iterations / maxIterations)
 */
export function getSessionProgress(sessionId: string): number | null {
	const session = storeGet(sessionId);
	if (!session) return null;

	return (session.iterations / session.maxIterations) * 100;
}
