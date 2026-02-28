/**
 * Shared TypeScript types for D-Bus ↔ RPC translation.
 */

export interface DBusAgentState {
	isStreaming: boolean;
	currentModel: string;
	sessionName: string;
	sessionId: string;
	thinkingLevel: string;
	messageCount: number;
}

export interface BridgeOptions {
	cwd?: string;
	provider?: string;
	model?: string;
	cliPath?: string;
	sessionFile?: string;
}

// --- Phase 1: Session Persistence ---

export interface SessionPersistence {
	sessionFile: string;
	model: string;
	provider: string;
	timestamp: string;
}

// --- Phase 2: Request Queuing ---

export enum RequestPriority {
	ABORT = 0,
	STEER = 1,
	FOLLOWUP = 2,
	ASK = 3,
}

export interface QueuedRequest {
	id: string;
	priority: RequestPriority;
	type: "ask" | "askAsync" | "steer" | "followUp" | "abort" | "askWithHints" | "askAs";
	prompt?: string;
	hints?: RequestHints;
	persona?: string;
	resolve?: (value: string) => void;
	reject?: (reason: unknown) => void;
}

// --- Phase 3: Model Routing ---

export interface RequestHints {
	model?: string;
	provider?: string;
	thinking?: string;
}
