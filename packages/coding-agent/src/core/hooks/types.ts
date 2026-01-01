/**
 * Hook system types.
 *
 * Hooks are TypeScript modules that can subscribe to agent lifecycle events
 * and interact with the user via UI primitives.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, Message, Model, TextContent, ToolResultMessage } from "@mariozechner/pi-ai";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { CompactionPreparation, CompactionResult } from "../compaction/index.js";
import type { ExecOptions, ExecResult } from "../exec.js";
import type { HookMessage } from "../messages.js";
import type { ModelRegistry } from "../model-registry.js";
import type { BranchSummaryEntry, CompactionEntry, ReadonlySessionManager, SessionEntry } from "../session-manager.js";

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
	select(title: string, options: string[]): Promise<string | undefined>;

	/**
	 * Show a confirmation dialog.
	 * @returns true if confirmed, false if cancelled
	 */
	confirm(title: string, message: string): Promise<boolean>;

	/**
	 * Show a text input dialog.
	 * @returns User input, or undefined if cancelled
	 */
	input(title: string, placeholder?: string): Promise<string | undefined>;

	/**
	 * Show a notification to the user.
	 */
	notify(message: string, type?: "info" | "warning" | "error"): void;

	/**
	 * Set status text in the footer/status bar.
	 * Pass undefined as text to clear the status for this key.
	 * Text can include ANSI escape codes for styling.
	 * Note: Newlines, tabs, and carriage returns are replaced with spaces.
	 * The combined status line is truncated to terminal width.
	 * @param key - Unique key to identify this status (e.g., hook name)
	 * @param text - Status text to display, or undefined to clear
	 */
	setStatus(key: string, text: string | undefined): void;

	/**
	 * Show a custom component with keyboard focus.
	 * The factory receives TUI, theme, and a done() callback to close the component.
	 * Can be async for fire-and-forget work (don't await the work, just start it).
	 *
	 * @param factory - Function that creates the component. Call done() when finished.
	 * @returns Promise that resolves with the value passed to done()
	 *
	 * @example
	 * // Sync factory
	 * const result = await ctx.ui.custom((tui, theme, done) => {
	 *   const component = new MyComponent(tui, theme);
	 *   component.onFinish = (value) => done(value);
	 *   return component;
	 * });
	 *
	 * // Async factory with fire-and-forget work
	 * const result = await ctx.ui.custom(async (tui, theme, done) => {
	 *   const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
	 *   loader.onAbort = () => done(null);
	 *   doWork(loader.signal).then(done);  // Don't await - fire and forget
	 *   return loader;
	 * });
	 */
	custom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
	): Promise<T>;

	/**
	 * Set the text in the core input editor.
	 * Use this to pre-fill the input box with generated content (e.g., prompt templates, extracted questions).
	 * @param text - Text to set in the editor
	 */
	setEditorText(text: string): void;

	/**
	 * Get the current text from the core input editor.
	 * @returns Current editor text
	 */
	getEditorText(): string;

	/**
	 * Get the current theme for styling text with ANSI codes.
	 * Use theme.fg() and theme.bg() to style status text.
	 *
	 * @example
	 * const theme = ctx.ui.theme;
	 * ctx.ui.setStatus("my-hook", theme.fg("success", "✓") + " Ready");
	 */
	readonly theme: Theme;
}

/**
 * Context passed to hook event and command handlers.
 */
export interface HookContext {
	/** UI methods for user interaction */
	ui: HookUIContext;
	/** Whether UI is available (false in print mode) */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Session manager (read-only) - use pi.sendMessage()/pi.appendEntry() for writes */
	sessionManager: ReadonlySessionManager;
	/** Model registry - use for API key resolution and model retrieval */
	modelRegistry: ModelRegistry;
	/** Current model (may be undefined if no model is selected yet) */
	model: Model<any> | undefined;
}

// ============================================================================
// Session Events
// ============================================================================

/** Fired on initial session load */
export interface SessionStartEvent {
	type: "session_start";
}

/** Fired before switching to another session (can be cancelled) */
export interface SessionBeforeSwitchEvent {
	type: "session_before_switch";
	/** Session file we're switching to */
	targetSessionFile: string;
}

/** Fired after switching to another session */
export interface SessionSwitchEvent {
	type: "session_switch";
	/** Session file we came from */
	previousSessionFile: string | undefined;
}

/** Fired before creating a new session (can be cancelled) */
export interface SessionBeforeNewEvent {
	type: "session_before_new";
}

/** Fired after creating a new session */
export interface SessionNewEvent {
	type: "session_new";
}

/** Fired before branching a session (can be cancelled) */
export interface SessionBeforeBranchEvent {
	type: "session_before_branch";
	/** ID of the entry to branch from */
	entryId: string;
}

/** Fired after branching a session */
export interface SessionBranchEvent {
	type: "session_branch";
	previousSessionFile: string | undefined;
}

/** Fired before context compaction (can be cancelled or customized) */
export interface SessionBeforeCompactEvent {
	type: "session_before_compact";
	/** Compaction preparation with messages to summarize, file ops, previous summary, etc. */
	preparation: CompactionPreparation;
	/** Branch entries (root to current leaf). Use to inspect custom state or previous compactions. */
	branchEntries: SessionEntry[];
	/** Optional user-provided instructions for the summary */
	customInstructions?: string;
	/** Abort signal - hooks should pass this to LLM calls and check it periodically */
	signal: AbortSignal;
}

/** Fired after context compaction */
export interface SessionCompactEvent {
	type: "session_compact";
	compactionEntry: CompactionEntry;
	/** Whether the compaction entry was provided by a hook */
	fromHook: boolean;
}

/** Fired on process exit (SIGINT/SIGTERM) */
export interface SessionShutdownEvent {
	type: "session_shutdown";
}

/** Preparation data for tree navigation (used by session_before_tree event) */
export interface TreePreparation {
	/** Node being switched to */
	targetId: string;
	/** Current active leaf (being abandoned), null if no current position */
	oldLeafId: string | null;
	/** Common ancestor of target and old leaf, null if no common ancestor */
	commonAncestorId: string | null;
	/** Entries to summarize (old leaf back to common ancestor or compaction) */
	entriesToSummarize: SessionEntry[];
	/** Whether user chose to summarize */
	userWantsSummary: boolean;
}

/** Fired before navigating to a different node in the session tree (can be cancelled) */
export interface SessionBeforeTreeEvent {
	type: "session_before_tree";
	/** Preparation data for the navigation */
	preparation: TreePreparation;
	/** Abort signal - honors Escape during summarization (model available via ctx.model) */
	signal: AbortSignal;
}

/** Fired after navigating to a different node in the session tree */
export interface SessionTreeEvent {
	type: "session_tree";
	/** The new active leaf, null if navigated to before first entry */
	newLeafId: string | null;
	/** Previous active leaf, null if there was no position */
	oldLeafId: string | null;
	/** Branch summary entry if one was created */
	summaryEntry?: BranchSummaryEntry;
	/** Whether summary came from hook */
	fromHook?: boolean;
}

/** Union of all session event types */
export type SessionEvent =
	| SessionStartEvent
	| SessionBeforeSwitchEvent
	| SessionSwitchEvent
	| SessionBeforeNewEvent
	| SessionNewEvent
	| SessionBeforeBranchEvent
	| SessionBranchEvent
	| SessionBeforeCompactEvent
	| SessionCompactEvent
	| SessionShutdownEvent
	| SessionBeforeTreeEvent
	| SessionTreeEvent;

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
 * Event data for before_agent_start event.
 * Fired after user submits a prompt but before the agent loop starts.
 * Allows hooks to inject context that will be persisted and visible in TUI.
 */
export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	/** The user's prompt text */
	prompt: string;
	/** Any images attached to the prompt */
	images?: ImageContent[];
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
	| BeforeAgentStartEvent
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
 * Return type for before_agent_start event handlers.
 * Allows hooks to inject context before the agent runs.
 */
export interface BeforeAgentStartEventResult {
	/** Message to inject into context (persisted to session, visible in TUI) */
	message?: Pick<HookMessage, "customType" | "content" | "display" | "details">;
}

/** Return type for session_before_switch handlers */
export interface SessionBeforeSwitchResult {
	/** If true, cancel the switch */
	cancel?: boolean;
}

/** Return type for session_before_new handlers */
export interface SessionBeforeNewResult {
	/** If true, cancel the new session */
	cancel?: boolean;
}

/** Return type for session_before_branch handlers */
export interface SessionBeforeBranchResult {
	/**
	 * If true, abort the branch entirely. No new session file is created,
	 * conversation stays unchanged.
	 */
	cancel?: boolean;
	/**
	 * If true, the branch proceeds (new session file created, session state updated)
	 * but the in-memory conversation is NOT rewound to the branch point.
	 *
	 * Use case: git-checkpoint hook that restores code state separately.
	 * The hook handles state restoration itself, so it doesn't want the
	 * agent's conversation to be rewound (which would lose recent context).
	 *
	 * - `cancel: true` → nothing happens, user stays in current session
	 * - `skipConversationRestore: true` → branch happens, but messages stay as-is
	 * - neither → branch happens AND messages rewind to branch point (default)
	 */
	skipConversationRestore?: boolean;
}

/** Return type for session_before_compact handlers */
export interface SessionBeforeCompactResult {
	/** If true, cancel the compaction */
	cancel?: boolean;
	/** Custom compaction result - SessionManager adds id/parentId */
	compaction?: CompactionResult;
}

/** Return type for session_before_tree handlers */
export interface SessionBeforeTreeResult {
	/** If true, cancel the navigation entirely */
	cancel?: boolean;
	/**
	 * Custom summary (skips default summarizer).
	 * Only used if preparation.userWantsSummary is true.
	 */
	summary?: {
		summary: string;
		details?: unknown;
	};
}

// ============================================================================
// Hook API
// ============================================================================

/**
 * Handler function type for each event.
 * Handlers can return R, undefined, or void (bare return statements).
 */
// biome-ignore lint/suspicious/noConfusingVoidType: void allows bare return statements in handlers
export type HookHandler<E, R = undefined> = (event: E, ctx: HookContext) => Promise<R | void> | R | void;

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
) => Component | undefined;

/**
 * Command registration options.
 */
export interface RegisteredCommand {
	name: string;
	description?: string;

	handler: (args: string, ctx: HookContext) => Promise<void>;
}

/**
 * HookAPI passed to hook factory functions.
 * Hooks use pi.on() to subscribe to events and pi.sendMessage() to inject messages.
 */
export interface HookAPI {
	// Session events
	on(event: "session_start", handler: HookHandler<SessionStartEvent>): void;
	on(event: "session_before_switch", handler: HookHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>): void;
	on(event: "session_switch", handler: HookHandler<SessionSwitchEvent>): void;
	on(event: "session_before_new", handler: HookHandler<SessionBeforeNewEvent, SessionBeforeNewResult>): void;
	on(event: "session_new", handler: HookHandler<SessionNewEvent>): void;
	on(event: "session_before_branch", handler: HookHandler<SessionBeforeBranchEvent, SessionBeforeBranchResult>): void;
	on(event: "session_branch", handler: HookHandler<SessionBranchEvent>): void;
	on(
		event: "session_before_compact",
		handler: HookHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
	): void;
	on(event: "session_compact", handler: HookHandler<SessionCompactEvent>): void;
	on(event: "session_shutdown", handler: HookHandler<SessionShutdownEvent>): void;
	on(event: "session_before_tree", handler: HookHandler<SessionBeforeTreeEvent, SessionBeforeTreeResult>): void;
	on(event: "session_tree", handler: HookHandler<SessionTreeEvent>): void;

	// Context and agent events
	on(event: "context", handler: HookHandler<ContextEvent, ContextEventResult>): void;
	on(event: "before_agent_start", handler: HookHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
	on(event: "agent_start", handler: HookHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: HookHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: HookHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: HookHandler<TurnEndEvent>): void;
	on(event: "tool_call", handler: HookHandler<ToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_result", handler: HookHandler<ToolResultEvent, ToolResultEventResult>): void;

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
	 * Return nothing to use the default renderer.
	 */
	registerMessageRenderer<T = unknown>(customType: string, renderer: HookMessageRenderer<T>): void;

	/**
	 * Register a custom slash command.
	 * Handler receives HookCommandContext.
	 */
	registerCommand(name: string, options: { description?: string; handler: RegisteredCommand["handler"] }): void;

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
