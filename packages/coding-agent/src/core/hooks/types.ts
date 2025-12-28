/**
 * Hook system types.
 *
 * Hooks are TypeScript modules that can subscribe to agent lifecycle events
 * and interact with the user via UI primitives.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, Message, Model, TextContent, ToolResultMessage } from "@mariozechner/pi-ai";
import type { Component } from "@mariozechner/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { CompactionPreparation, CompactionResult } from "../compaction.js";
import type { ExecOptions, ExecResult } from "../exec.js";
import type { HookMessage } from "../messages.js";
import type { ModelRegistry } from "../model-registry.js";
import type { CompactionEntry, SessionManager } from "../session-manager.js";
import type { EditToolDetails } from "../tools/edit.js";
import type {
	BashToolDetails,
	FindToolDetails,
	GrepToolDetails,
	LsToolDetails,
	ReadToolDetails,
} from "../tools/index.js";

// Re-export for backward compatibility
export type { ExecOptions, ExecResult } from "../exec.js";

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

	/**
	 * Show a custom component with keyboard focus.
	 * The component receives keyboard input via handleInput() if implemented.
	 *
	 * @param component - Component to display (implement handleInput for keyboard, dispose for cleanup)
	 * @returns Object with close() to restore normal UI and requestRender() to trigger redraw
	 */
	custom(component: Component & { dispose?(): void }): { close: () => void; requestRender: () => void };
}

/**
 * Context passed to hook event handlers.
 */
export interface HookEventContext {
	/** UI methods for user interaction */
	ui: HookUIContext;
	/** Whether UI is available (false in print mode) */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Session manager instance - use for entries, session file, etc. */
	sessionManager: SessionManager;
	/** Model registry - use for API key resolution and model retrieval */
	modelRegistry: ModelRegistry;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Base fields shared by all session events.
 */
interface SessionEventBase {
	type: "session";
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
			reason: "start" | "new" | "before_new" | "shutdown";
	  })
	| (SessionEventBase & {
			reason: "before_switch";
			/** Session file we're switching to */
			targetSessionFile: string;
	  })
	| (SessionEventBase & {
			reason: "switch";
			/** Session file we came from */
			previousSessionFile: string | null;
	  })
	| (SessionEventBase & {
			reason: "branch" | "before_branch";
			/** Index of the turn to branch from */
			targetTurnIndex: number;
	  })
	| (SessionEventBase & {
			reason: "before_compact";
			/** Compaction preparation with cut point, messages to summarize/keep, etc. */
			preparation: CompactionPreparation;
			/** Previous compaction entries, newest first. Use for iterative summarization. */
			previousCompactions: CompactionEntry[];
			/** Optional user-provided instructions for the summary */
			customInstructions?: string;
			/** Current model */
			model: Model<any>;
			/** Abort signal - hooks should pass this to LLM calls and check it periodically */
			signal: AbortSignal;
	  })
	| (SessionEventBase & {
			reason: "compact";
			compactionEntry: CompactionEntry;
			/** Whether the compaction entry was provided by a hook */
			fromHook: boolean;
	  });

/**
 * Event data for context event.
 * Fired before each LLM call, allowing hooks to modify context non-destructively.
 * Original session messages are NOT modified - only the messages sent to the LLM are affected.
 */
export interface ContextEvent {
	type: "context";
	/** Messages about to be sent to the LLM (deep copy, safe to modify) */
	messages: AgentMessage[];
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
	messages: AgentMessage[];
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
	message: AgentMessage;
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
	details: EditToolDetails | undefined;
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
	| ContextEvent
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
 * Return type for context event handlers.
 * Allows hooks to modify messages before they're sent to the LLM.
 */
export interface ContextEventResult {
	/** Modified messages to send instead of the original */
	messages?: Message[];
}

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

export interface HookMessageRenderOptions {
	/** Whether the view is expanded */
	expanded: boolean;
}

/**
 * Renderer for hook messages.
 * Hooks register these to provide custom TUI rendering for their message types.
 */
export type HookMessageRenderer<T = unknown> = (
	message: HookMessage<T>,
	options: HookMessageRenderOptions,
	theme: Theme,
) => Component | null;

/**
 * Context passed to hook command handlers.
 */
export interface HookCommandContext {
	/** Arguments after the command name */
	args: string;
	/** UI methods for user interaction */
	ui: HookUIContext;
	/** Whether UI is available (false in print mode) */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Session manager for reading/writing session entries */
	sessionManager: SessionManager;
	/** Model registry for API keys */
	modelRegistry: ModelRegistry;
}

/**
 * Command registration options.
 */
export interface RegisteredCommand {
	name: string;
	description?: string;
	/** If true, command runs immediately even during streaming (doesn't get queued) */
	immediate?: boolean;
	handler: (ctx: HookCommandContext) => Promise<void>;
}

/**
 * HookAPI passed to hook factory functions.
 * Hooks use pi.on() to subscribe to events and pi.sendMessage() to inject messages.
 */
export interface HookAPI {
	// biome-ignore lint/suspicious/noConfusingVoidType: void allows handlers to not return anything
	on(event: "session", handler: HookHandler<SessionEvent, SessionEventResult | void>): void;
	// biome-ignore lint/suspicious/noConfusingVoidType: void allows handlers to not return anything
	on(event: "context", handler: HookHandler<ContextEvent, ContextEventResult | void>): void;
	on(event: "agent_start", handler: HookHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: HookHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: HookHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: HookHandler<TurnEndEvent>): void;
	on(event: "tool_call", handler: HookHandler<ToolCallEvent, ToolCallEventResult | undefined>): void;
	on(event: "tool_result", handler: HookHandler<ToolResultEvent, ToolResultEventResult | undefined>): void;

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry that
	 * participates in LLM context and can be displayed in the TUI.
	 *
	 * Use this when you want the LLM to see the message content.
	 * For hook state that should NOT be sent to the LLM, use appendEntry() instead.
	 *
	 * @param message - The message to send
	 * @param message.customType - Identifier for your hook (used for filtering on reload)
	 * @param message.content - Message content (string or TextContent/ImageContent array)
	 * @param message.display - Whether to show in TUI (true = styled display, false = hidden)
	 * @param message.details - Optional hook-specific metadata (not sent to LLM)
	 * @param triggerTurn - If true and agent is idle, triggers a new LLM turn. Default: false.
	 *                      If agent is streaming, message is queued and triggerTurn is ignored.
	 */
	sendMessage<T = unknown>(
		message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
		triggerTurn?: boolean,
	): void;

	/**
	 * Append a custom entry to the session for hook state persistence.
	 * Creates a CustomEntry that does NOT participate in LLM context.
	 *
	 * Use this to store hook-specific data that should persist across session reloads
	 * but should NOT be sent to the LLM. On reload, scan session entries for your
	 * customType to reconstruct hook state.
	 *
	 * For messages that SHOULD be sent to the LLM, use sendMessage() instead.
	 *
	 * @param customType - Identifier for your hook (used for filtering on reload)
	 * @param data - Hook-specific data to persist (must be JSON-serializable)
	 *
	 * @example
	 * // Store permission state
	 * pi.appendEntry("permissions", { level: "full", grantedAt: Date.now() });
	 *
	 * // On reload, reconstruct state from entries
	 * pi.on("session", async (event, ctx) => {
	 *   if (event.reason === "start") {
	 *     const entries = event.sessionManager.getEntries();
	 *     const myEntries = entries.filter(e => e.type === "custom" && e.customType === "permissions");
	 *     // Reconstruct state from myEntries...
	 *   }
	 * });
	 */
	appendEntry<T = unknown>(customType: string, data?: T): void;

	/**
	 * Register a custom renderer for CustomMessageEntry with a specific customType.
	 * The renderer is called when rendering the entry in the TUI.
	 * Return null to use the default renderer.
	 */
	registerMessageRenderer<T = unknown>(customType: string, renderer: HookMessageRenderer<T>): void;

	/**
	 * Register a custom slash command.
	 * Handler receives HookCommandContext.
	 */
	registerCommand(
		name: string,
		options: { description?: string; immediate?: boolean; handler: RegisteredCommand["handler"] },
	): void;

	/**
	 * Execute a shell command and return stdout/stderr/code.
	 * Supports timeout and abort signal.
	 */
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
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
