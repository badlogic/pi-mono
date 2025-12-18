/**
 * Hook Types for Discord Bot Agent System
 *
 * Bridges the pi-coding-agent hook system with discord-bot's HookRegistry.
 * Enables checkpoint, LSP, and expert hooks to work with both systems.
 *
 * Based on @mariozechner/pi-coding-agent/hooks types and pi-hooks patterns.
 */

/**
 * Result of executing a command
 */
export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

// ============================================================================
// pi-coding-agent Compatible Events
// ============================================================================

/**
 * Session lifecycle event
 */
export interface SessionEvent {
	type: "session";
	reason: "start" | "switch" | "clear" | "branch";
	sessionId: string;
	previousSessionId?: string;
	entries?: unknown[];
}

/**
 * Agent loop events
 */
export interface AgentStartEvent {
	type: "agent_start";
	turnIndex: number;
	timestamp: number;
}

export interface AgentEndEvent {
	type: "agent_end";
	turnIndex: number;
	success: boolean;
	output?: string;
}

/**
 * Turn events (within agent loop)
 */
export interface TurnStartEvent {
	type: "turn_start";
	turnIndex: number;
	timestamp: number;
}

export interface TurnEndEvent {
	type: "turn_end";
	turnIndex: number;
	message?: unknown;
	toolResults?: unknown[];
}

/**
 * Tool execution events
 */
export interface ToolCallEvent {
	type: "tool_call";
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}

export interface ToolResultEvent {
	type: "tool_result";
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
	result: string;
	isError: boolean;
}

/**
 * Branch event (conversation branching)
 */
export interface BranchEvent {
	type: "branch";
	targetTurnIndex: number;
	entries: unknown[];
	sessionId: string;
}

/**
 * Union of all hook events
 */
export type AgentHookEvent =
	| SessionEvent
	| AgentStartEvent
	| AgentEndEvent
	| TurnStartEvent
	| TurnEndEvent
	| ToolCallEvent
	| ToolResultEvent
	| BranchEvent;

// ============================================================================
// Event Results
// ============================================================================

export interface ToolCallEventResult {
	block?: boolean;
	reason?: string;
}

export interface ToolResultEventResult {
	result?: string;
	isError?: boolean;
}

export interface BranchEventResult {
	skipConversationRestore?: boolean;
}

// ============================================================================
// Hook Context (Extended)
// ============================================================================

/**
 * Extended context for agent hooks
 * Compatible with pi-coding-agent HookEventContext
 */
export interface AgentHookContext {
	/** Execute a shell command */
	exec(command: string, args: string[]): Promise<ExecResult>;
	/** UI methods for user interaction */
	ui: {
		select(title: string, options: string[]): Promise<string | null>;
		confirm(title: string, message: string): Promise<boolean>;
		input(title: string, placeholder?: string): Promise<string | null>;
		notify(message: string, type?: "info" | "warning" | "error"): void;
	};
	/** Whether UI is available */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Session file path (optional) */
	sessionFile?: string | null;
	/** Discord channel ID (for discord-bot context) */
	channelId?: string;
	/** Discord user ID (for discord-bot context) */
	userId?: string;
}

// ============================================================================
// Hook API (pi-coding-agent compatible)
// ============================================================================

export type AgentHookHandler<E, R = void> = (event: E, ctx: AgentHookContext) => Promise<R>;

/**
 * Hook API compatible with pi-coding-agent
 */
export interface AgentHookAPI {
	on(event: "session", handler: AgentHookHandler<SessionEvent>): void;
	on(event: "agent_start", handler: AgentHookHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: AgentHookHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: AgentHookHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: AgentHookHandler<TurnEndEvent>): void;
	on(event: "tool_call", handler: AgentHookHandler<ToolCallEvent, ToolCallEventResult | undefined>): void;
	on(event: "tool_result", handler: AgentHookHandler<ToolResultEvent, ToolResultEventResult | undefined>): void;
	on(event: "branch", handler: AgentHookHandler<BranchEvent, BranchEventResult | undefined>): void;

	/** Send a message to the agent (queue if streaming) */
	send?(text: string, attachments?: unknown[]): void;
}

export type AgentHookFactory = (api: AgentHookAPI) => void;

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface CheckpointData {
	id: string;
	turnIndex: number;
	sessionId: string;
	headSha: string;
	indexTreeSha: string;
	worktreeTreeSha: string;
	timestamp: number;
}

export interface CheckpointConfig {
	enabled: boolean;
	autoCreate: boolean;
	maxCheckpoints: number;
	refBase: string;
}

// ============================================================================
// LSP Types
// ============================================================================

export interface LSPDiagnostic {
	severity: 1 | 2 | 3 | 4; // Error, Warning, Info, Hint
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	message: string;
	source?: string;
	code?: string | number;
}

export interface LSPServerConfig {
	id: string;
	extensions: string[];
	findRoot: (file: string, cwd: string) => string | undefined;
	spawn: (root: string) => Promise<LSPHandle | undefined>;
}

export interface LSPHandle {
	process: unknown; // ChildProcessWithoutNullStreams
	initializationOptions?: Record<string, unknown>;
}

export interface LSPConfig {
	enabled: boolean;
	waitMs: number;
	initTimeoutMs: number;
	servers: string[]; // Which servers to enable
}

// ============================================================================
// Expert Hook Types
// ============================================================================

export interface ExpertHookConfig {
	enabled: boolean;
	autoDetect: boolean;
	domains: string[];
	learningEnabled: boolean;
	maxSessionInsights: number;
}

export interface ExpertContext {
	domain: string;
	expertise: string;
	riskLevel: "low" | "medium" | "high" | "critical";
}

// ============================================================================
// Hook Registration
// ============================================================================

export interface HookRegistration {
	id: string;
	name: string;
	description?: string;
	factory: AgentHookFactory;
	enabled: boolean;
}

export interface HookManager {
	register(hook: HookRegistration): void;
	unregister(id: string): boolean;
	emit<E extends AgentHookEvent>(event: E, ctx: AgentHookContext): Promise<unknown>;
	list(): HookRegistration[];
	setEnabled(id: string, enabled: boolean): boolean;
}
