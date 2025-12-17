/**
 * Hook system types.
 *
 * Hooks are TypeScript modules that can subscribe to agent lifecycle events
 * and interact with the user via UI primitives.
 */

import type { AppMessage, Attachment } from "@mariozechner/pi-agent-core";
import type { SessionEntry } from "../session-manager.js";

// ============================================================================
// Execution Context
// ============================================================================

/**
 * Result of executing a command via ctx.exec()
 */
export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

/**
 * UI context for hooks to request interactive UI from the harness.
 * Each mode (interactive, RPC, print) provides its own implementation.
 */
export interface HookUIContext {
	/**
	 * Show a selector and return the user's choice.
	 * @param title - Title to display
	 * @param options - Array of string options
	 * @returns Selected option string, or null if cancelled
	 */
	select(title: string, options: string[]): Promise<string | null>;

	/**
	 * Show a confirmation dialog.
	 * @returns true if confirmed, false if cancelled
	 */
	confirm(title: string, message: string): Promise<boolean>;

	/**
	 * Show a text input dialog.
	 * @returns User input, or null if cancelled
	 */
	input(title: string, placeholder?: string): Promise<string | null>;

	/**
	 * Show a notification to the user.
	 */
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

/**
 * Context passed to hook event handlers.
 */
export interface HookEventContext {
	/** Execute a command and return stdout/stderr/code */
	exec(command: string, args: string[]): Promise<ExecResult>;
	/** UI methods for user interaction */
	ui: HookUIContext;
	/** Whether UI is available (false in print mode) */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Path to session file, or null if --no-session */
	sessionFile: string | null;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Event data for session event.
 * Fired on startup and when session changes (switch or clear).
 * Note: branch has its own event that fires BEFORE the branch happens.
 */
export interface SessionEvent {
	type: "session";
	/** All session entries (including pre-compaction history) */
	entries: SessionEntry[];
	/** Current session file path, or null in --no-session mode */
	sessionFile: string | null;
	/** Previous session file path, or null for "start" and "clear" */
	previousSessionFile: string | null;
	/** Reason for the session event */
	reason: "start" | "switch" | "clear";
}

/**
 * Event data for agent_start event.
 * Fired when an agent loop starts (once per user prompt).
 */
export interface AgentStartEvent {
	type: "agent_start";
}

/**
 * Event data for agent_end event.
 */
export interface AgentEndEvent {
	type: "agent_end";
	messages: AppMessage[];
}

/**
 * Event data for turn_start event.
 */
export interface TurnStartEvent {
	type: "turn_start";
	turnIndex: number;
	timestamp: number;
}

/**
 * Event data for turn_end event.
 */
export interface TurnEndEvent {
	type: "turn_end";
	turnIndex: number;
	message: AppMessage;
	toolResults: AppMessage[];
}

/**
 * Event data for tool_call event.
 * Fired before a tool is executed. Hooks can block execution.
 */
export interface ToolCallEvent {
	type: "tool_call";
	/** Tool name (e.g., "bash", "edit", "write") */
	toolName: string;
	/** Tool call ID */
	toolCallId: string;
	/** Tool input parameters */
	input: Record<string, unknown>;
}

/**
 * Event data for tool_result event.
 * Fired after a tool is executed. Hooks can modify the result.
 */
export interface ToolResultEvent {
	type: "tool_result";
	/** Tool name (e.g., "bash", "edit", "write") */
	toolName: string;
	/** Tool call ID */
	toolCallId: string;
	/** Tool input parameters */
	input: Record<string, unknown>;
	/** Tool result content (text) */
	result: string;
	/** Whether the tool execution was an error */
	isError: boolean;
}

/**
 * Event data for branch event.
 */
export interface BranchEvent {
	type: "branch";
	/** Index of the turn to branch from */
	targetTurnIndex: number;
	/** Full session history */
	entries: SessionEntry[];
}

/**
 * Union of all hook event types.
 */
export type HookEvent =
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

/**
 * Return type for tool_call event handlers.
 * Allows hooks to block tool execution.
 */
export interface ToolCallEventResult {
	/** If true, block the tool from executing */
	block?: boolean;
	/** Reason for blocking (returned to LLM as error) */
	reason?: string;
}

/**
 * Return type for tool_result event handlers.
 * Allows hooks to modify tool results.
 */
export interface ToolResultEventResult {
	/** Modified result text (if not set, original result is used) */
	result?: string;
	/** Override isError flag */
	isError?: boolean;
}

/**
 * Return type for branch event handlers.
 * Allows hooks to control branch behavior.
 */
export interface BranchEventResult {
	/** If true, skip restoring the conversation (only restore code) */
	skipConversationRestore?: boolean;
}

// ============================================================================
// Hook API
// ============================================================================

/**
 * Handler function type for each event.
 */
export type HookHandler<E, R = void> = (event: E, ctx: HookEventContext) => Promise<R>;

/**
 * HookAPI passed to hook factory functions.
 * Hooks use pi.on() to subscribe to events and pi.send() to inject messages.
 */
export interface HookAPI {
	on(event: "session", handler: HookHandler<SessionEvent>): void;
	on(event: "agent_start", handler: HookHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: HookHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: HookHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: HookHandler<TurnEndEvent>): void;
	on(event: "tool_call", handler: HookHandler<ToolCallEvent, ToolCallEventResult | undefined>): void;
	on(event: "tool_result", handler: HookHandler<ToolResultEvent, ToolResultEventResult | undefined>): void;
	on(event: "branch", handler: HookHandler<BranchEvent, BranchEventResult | undefined>): void;

	/**
	 * Send a message to the agent.
	 * If the agent is streaming, the message is queued.
	 * If the agent is idle, a new agent loop is started.
	 */
	send(text: string, attachments?: Attachment[]): void;
}

/**
 * Hook factory function type.
 * Hooks export a default function that receives the HookAPI.
 */
export type HookFactory = (pi: HookAPI) => void;

// ============================================================================
// Errors
// ============================================================================

/**
 * Error emitted when a hook fails.
 */
export interface HookError {
	hookPath: string;
	event: string;
	error: string;
}
