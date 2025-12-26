/**
 * Hook system types.
 *
 * Hooks are TypeScript modules that can subscribe to agent lifecycle events
 * and interact with the user via UI primitives.
 */

import type { AppMessage, Attachment } from "@mariozechner/pi-agent-core";
import type { ImageContent, Model, TextContent, ToolResultMessage } from "@mariozechner/pi-ai";
import type { CompactionResult, CutPointResult } from "../compaction.js";
import type { CompactionEntry, SessionEntry } from "../session-manager.js";
import type {
	BashToolDetails,
	FindToolDetails,
	GrepToolDetails,
	LsToolDetails,
	ReadToolDetails,
} from "../tools/index.js";

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
	/** True if the process was killed due to signal or timeout */
	killed?: boolean;
}

export interface ExecOptions {
	/** AbortSignal to cancel the process */
	signal?: AbortSignal;
	/** Timeout in milliseconds */
	timeout?: number;
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
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
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
 * Base fields shared by all session events.
 */
interface SessionEventBase {
	type: "session";
	/** All session entries (including pre-compaction history) */
	entries: SessionEntry[];
	/** Current session file path, or null in --no-session mode */
	sessionFile: string | null;
	/** Previous session file path, or null for "start" and "new" */
	previousSessionFile: string | null;
}

/**
 * Event data for session events.
 * Discriminated union based on reason.
 *
 * Lifecycle:
 * - start: Initial session load
 * - before_switch / switch: Session switch (e.g., /resume command)
 * - before_new / new: New session (e.g., /new command)
 * - before_branch / branch: Session branch (e.g., /branch command)
 * - before_compact / compact: Before/after context compaction
 * - shutdown: Process exit (SIGINT/SIGTERM)
 *
 * "before_*" events fire before the action and can be cancelled via SessionEventResult.
 * Other events fire after the action completes.
 */
export type SessionEvent =
	| (SessionEventBase & {
			reason: "start" | "switch" | "new" | "before_switch" | "before_new" | "shutdown";
	  })
	| (SessionEventBase & {
			reason: "branch" | "before_branch";
			/** Index of the turn to branch from */
			targetTurnIndex: number;
	  })
	| (SessionEventBase & {
			reason: "before_compact";
			cutPoint: CutPointResult;
			/** ID of first entry to keep (for hooks that return CompactionEntry) */
			firstKeptEntryId: string;
			/** Summary from previous compaction, if any. Include this in your summary to preserve context. */
			previousSummary?: string;
			/** Messages that will be summarized and discarded */
			messagesToSummarize: AppMessage[];
			/** Messages that will be kept after the summary (recent turns) */
			messagesToKeep: AppMessage[];
			tokensBefore: number;
			customInstructions?: string;
			model: Model<any>;
			/** Resolve API key for any model (checks settings, OAuth, env vars) */
			resolveApiKey: (model: Model<any>) => Promise<string | undefined>;
			/** Abort signal - hooks should pass this to LLM calls and check it periodically */
			signal: AbortSignal;
	  })
	| (SessionEventBase & {
			reason: "compact";
			compactionEntry: CompactionEntry;
			tokensBefore: number;
			/** Whether the compaction entry was provided by a hook */
			fromHook: boolean;
	  });

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
	toolResults: ToolResultMessage[];
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
 * Base interface for tool_result events.
 */
interface ToolResultEventBase {
	type: "tool_result";
	/** Tool call ID */
	toolCallId: string;
	/** Tool input parameters */
	input: Record<string, unknown>;
	/** Full content array (text and images) */
	content: (TextContent | ImageContent)[];
	/** Whether the tool execution was an error */
	isError: boolean;
}

/** Tool result event for bash tool */
export interface BashToolResultEvent extends ToolResultEventBase {
	toolName: "bash";
	details: BashToolDetails | undefined;
}

/** Tool result event for read tool */
export interface ReadToolResultEvent extends ToolResultEventBase {
	toolName: "read";
	details: ReadToolDetails | undefined;
}

/** Tool result event for edit tool */
export interface EditToolResultEvent extends ToolResultEventBase {
	toolName: "edit";
	details: undefined;
}

/** Tool result event for write tool */
export interface WriteToolResultEvent extends ToolResultEventBase {
	toolName: "write";
	details: undefined;
}

/** Tool result event for grep tool */
export interface GrepToolResultEvent extends ToolResultEventBase {
	toolName: "grep";
	details: GrepToolDetails | undefined;
}

/** Tool result event for find tool */
export interface FindToolResultEvent extends ToolResultEventBase {
	toolName: "find";
	details: FindToolDetails | undefined;
}

/** Tool result event for ls tool */
export interface LsToolResultEvent extends ToolResultEventBase {
	toolName: "ls";
	details: LsToolDetails | undefined;
}

/** Tool result event for custom/unknown tools */
export interface CustomToolResultEvent extends ToolResultEventBase {
	toolName: string;
	details: unknown;
}

/**
 * Event data for tool_result event.
 * Fired after a tool is executed. Hooks can modify the result.
 * Use toolName to discriminate and get typed details.
 */
export type ToolResultEvent =
	| BashToolResultEvent
	| ReadToolResultEvent
	| EditToolResultEvent
	| WriteToolResultEvent
	| GrepToolResultEvent
	| FindToolResultEvent
	| LsToolResultEvent
	| CustomToolResultEvent;

// Type guards for narrowing ToolResultEvent to specific tool types
export function isBashToolResult(e: ToolResultEvent): e is BashToolResultEvent {
	return e.toolName === "bash";
}
export function isReadToolResult(e: ToolResultEvent): e is ReadToolResultEvent {
	return e.toolName === "read";
}
export function isEditToolResult(e: ToolResultEvent): e is EditToolResultEvent {
	return e.toolName === "edit";
}
export function isWriteToolResult(e: ToolResultEvent): e is WriteToolResultEvent {
	return e.toolName === "write";
}
export function isGrepToolResult(e: ToolResultEvent): e is GrepToolResultEvent {
	return e.toolName === "grep";
}
export function isFindToolResult(e: ToolResultEvent): e is FindToolResultEvent {
	return e.toolName === "find";
}
export function isLsToolResult(e: ToolResultEvent): e is LsToolResultEvent {
	return e.toolName === "ls";
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
	| ToolResultEvent;

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
	/** Replacement content array (text and images) */
	content?: (TextContent | ImageContent)[];
	/** Replacement details */
	details?: unknown;
	/** Override isError flag */
	isError?: boolean;
}

/**
 * Return type for session event handlers.
 * Allows hooks to cancel "before_*" actions.
 */
export interface SessionEventResult {
	/** If true, cancel the pending action (switch, clear, or branch) */
	cancel?: boolean;
	/** If true (for before_branch only), skip restoring conversation to branch point while still creating the branched session file */
	skipConversationRestore?: boolean;
	/** Custom compaction result (for before_compact event) - SessionManager adds id/parentId */
	compaction?: CompactionResult;
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
	// biome-ignore lint/suspicious/noConfusingVoidType: void allows handlers to not return anything
	on(event: "session", handler: HookHandler<SessionEvent, SessionEventResult | void>): void;
	on(event: "agent_start", handler: HookHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: HookHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: HookHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: HookHandler<TurnEndEvent>): void;
	on(event: "tool_call", handler: HookHandler<ToolCallEvent, ToolCallEventResult | undefined>): void;
	on(event: "tool_result", handler: HookHandler<ToolResultEvent, ToolResultEventResult | undefined>): void;

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
