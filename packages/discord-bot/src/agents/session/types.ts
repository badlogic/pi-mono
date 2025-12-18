/**
 * Session Persistence Types
 * Type definitions for agent session management and resumable workflows
 */

/**
 * Session status states
 */
export type SessionStatus = "active" | "paused" | "completed" | "failed" | "timeout";

/**
 * Session event types for tracking lifecycle
 */
export type SessionEventType =
	| "start"
	| "iteration"
	| "tool_call"
	| "learning"
	| "pause"
	| "resume"
	| "complete"
	| "error"
	| "timeout";

/**
 * Event logged during session execution
 */
export interface SessionEvent {
	timestamp: string;
	type: SessionEventType;
	data: Record<string, unknown>;
}

/**
 * Complete agent session state
 */
export interface AgentSession {
	// Session identification
	id: string;
	userId?: string;
	channelId?: string;

	// Task information
	mode: string;
	task: string;
	workspace?: string;

	// Session state
	status: SessionStatus;
	createdAt: string;
	updatedAt: string;

	// Execution tracking
	iterations: number;
	maxIterations: number;

	// Context and state
	context: Record<string, unknown>;
	history: SessionEvent[];

	// Results
	result?: string;
	error?: string;

	// Metadata
	metadata?: {
		model?: string;
		timeout?: number;
		enableLearning?: boolean;
		delegated?: boolean;
		blockedActions?: Array<{ action: string; reason: string }>;
		toolsUsed?: string[];
		cost?: number;
		tokens?: { prompt: number; completion: number; total: number };
	};
}

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
	task: string;
	mode: string;
	userId?: string;
	channelId?: string;
	workspace?: string;
	maxIterations?: number;
	context?: Record<string, unknown>;
	metadata?: AgentSession["metadata"];
}

/**
 * Options for updating an existing session
 */
export interface UpdateSessionOptions {
	status?: SessionStatus;
	iterations?: number;
	context?: Record<string, unknown>;
	result?: string;
	error?: string;
	metadata?: Partial<AgentSession["metadata"]>;
}

/**
 * Filter for listing sessions
 */
export interface SessionFilter {
	userId?: string;
	channelId?: string;
	mode?: string;
	status?: SessionStatus | SessionStatus[];
	createdAfter?: string;
	createdBefore?: string;
	limit?: number;
	offset?: number;
}

/**
 * Session summary for listing
 */
export interface SessionSummary {
	id: string;
	mode: string;
	status: SessionStatus;
	task: string;
	userId?: string;
	channelId?: string;
	createdAt: string;
	updatedAt: string;
	iterations: number;
	maxIterations: number;
}

/**
 * Session statistics
 */
export interface SessionStats {
	total: number;
	byStatus: Record<SessionStatus, number>;
	byMode: Record<string, number>;
	averageIterations: number;
	successRate: number;
}

/**
 * Webhook notification payload
 */
export interface SessionWebhookPayload {
	event: SessionEventType;
	session: {
		id: string;
		mode: string;
		status: SessionStatus;
		task: string;
		userId?: string;
		channelId?: string;
	};
	timestamp: string;
	data?: Record<string, unknown>;
}
