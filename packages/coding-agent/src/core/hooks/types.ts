/**
 * Hook system types.
 *
 * Hooks are TypeScript modules that can subscribe to agent lifecycle events
 * and interact with the user via UI primitives.
 */

import type { AppMessage } from "@mariozechner/pi-agent-core";
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
	/** Current working directory */
	cwd: string;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Event data for agent_start event.
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
export type HookEvent = AgentStartEvent | AgentEndEvent | TurnStartEvent | TurnEndEvent | BranchEvent;

// ============================================================================
// Event Results
// ============================================================================

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
 * Hooks use pi.on() to subscribe to events.
 */
export interface HookAPI {
	on(event: "agent_start", handler: HookHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: HookHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: HookHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: HookHandler<TurnEndEvent>): void;
	on(event: "branch", handler: HookHandler<BranchEvent, BranchEventResult | undefined>): void;
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
