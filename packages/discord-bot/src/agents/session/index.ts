/**
 * Session Persistence Module
 * Complete session management system for resumable agent workflows
 *
 * Features:
 * - Filesystem-based persistence
 * - Iteration tracking with bounded execution
 * - Session pause/resume capabilities
 * - Event logging for full lifecycle tracking
 * - Context accumulation for continuation
 * - Optional webhook notifications
 * - Session statistics and cleanup
 *
 * @example
 * ```typescript
 * // Start a new session
 * const session = await startSession("Implement feature X", "developer", {
 *   userId: "123",
 *   channelId: "456",
 *   maxIterations: 50,
 * });
 *
 * // Track progress
 * await incrementIteration(session.id, { step: "Analysis" });
 * await recordToolCall(session.id, "bash", { command: "npm test" }, { exitCode: 0 });
 *
 * // Pause for later
 * await pauseSession(session.id, "User requested pause");
 *
 * // Resume and continue
 * await resumeSession(session.id);
 * const context = getSessionContext(session.id);
 *
 * // Complete
 * await completeSession(session.id, "Feature implemented successfully");
 *
 * // List all sessions
 * const active = getActiveSessions({ userId: "123" });
 * const stats = getSessionStats();
 * ```
 */

// Manager exports
export {
	addEvent,
	cleanupOldSessions as cleanupSessions,
	completeSession,
	configureWebhook,
	deleteSession as removeSession,
	failSession,
	getActiveSessions,
	getCompletedSessions,
	getFailedSessions,
	getPausedSessions,
	getSession as loadSession,
	getSessionContext,
	getSessionDuration,
	getSessionProgress,
	getSessionStats as getStats,
	incrementIteration,
	isSessionResumable,
	listSessions as findSessions,
	pauseSession,
	recordLearning,
	recordToolCall,
	resumeSession,
	startSession,
	updateContext,
} from "./manager.js";

// Store exports
export {
	cleanupOldSessions,
	createSession,
	deleteSession,
	exportSession,
	getSession,
	getSessionStats,
	importSession,
	listSessions,
	saveSession,
	updateSession,
} from "./store.js";
// Type exports
export type {
	AgentSession,
	CreateSessionOptions,
	SessionEvent,
	SessionEventType,
	SessionFilter,
	SessionStats,
	SessionStatus,
	SessionSummary,
	SessionWebhookPayload,
	UpdateSessionOptions,
} from "./types.js";
