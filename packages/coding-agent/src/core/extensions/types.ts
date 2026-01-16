/**
 * Extension system types.
 *
 * Extensions are TypeScript modules that can:
 * - Subscribe to agent lifecycle events
 * - Register LLM-callable tools
 * - Register commands, keyboard shortcuts, and CLI flags
 * - Interact with the user via UI primitives
 */

import type {
	AgentMessage,
	AgentToolResult,
	AgentToolUpdateCallback,
	ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { ImageContent, Model, TextContent, ToolResultMessage } from "@mariozechner/pi-ai";
import type {
	AutocompleteItem,
	Component,
	EditorComponent,
	EditorTheme,
	KeyId,
	OverlayHandle,
	OverlayOptions,
	TUI,
} from "@mariozechner/pi-tui";
import type { Static, TSchema } from "@sinclair/typebox";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { BashResult } from "../bash-executor.js";
import type { CompactionPreparation, CompactionResult } from "../compaction/index.js";
import type { EventBus } from "../event-bus.js";
import type { ExecOptions, ExecResult } from "../exec.js";
import type { ReadonlyFooterDataProvider } from "../footer-data-provider.js";
import type { KeybindingsManager } from "../keybindings.js";
import type { CustomMessage } from "../messages.js";
import type { ModelRegistry } from "../model-registry.js";
import type {
	BranchSummaryEntry,
	CompactionEntry,
	ReadonlySessionManager,
	SessionEntry,
	SessionManager,
} from "../session-manager.js";
import type { BashOperations } from "../tools/bash.js";
import type { EditToolDetails } from "../tools/edit.js";
import type {
	BashToolDetails,
	FindToolDetails,
	GrepToolDetails,
	LsToolDetails,
	ReadToolDetails,
} from "../tools/index.js";

export type { ExecOptions, ExecResult } from "../exec.js";
export type { AgentToolResult, AgentToolUpdateCallback };
export type { AppAction, KeybindingsManager } from "../keybindings.js";

// ============================================================================
// UI Context
// ============================================================================

/** Options for extension UI dialogs. */
export interface ExtensionUIDialogOptions {
	/** AbortSignal to programmatically dismiss the dialog. */
	signal?: AbortSignal;
	/** Timeout in milliseconds. Dialog auto-dismisses with live countdown display. */
	timeout?: number;
}

/**
 * UI context for extensions to request interactive UI.
 * Each mode (interactive, RPC, print) provides its own implementation.
 */
export interface ExtensionUIContext {
	/** Show a selector and return the user's choice. */
	select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;

	/** Show a confirmation dialog. */
	confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;

	/** Show a text input dialog. */
	input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;

	/** Show a notification to the user. */
	notify(message: string, type?: "info" | "warning" | "error"): void;

	/** Set status text in the footer/status bar. Pass undefined to clear. */
	setStatus(key: string, text: string | undefined): void;

	/** Set the working/loading message shown during streaming. Call with no argument to restore default. */
	setWorkingMessage(message?: string): void;

	/** Set a widget to display above the editor. Accepts string array or component factory. */
	setWidget(key: string, content: string[] | undefined): void;
	setWidget(key: string, content: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined): void;

	/** Set a custom footer component, or undefined to restore the built-in footer.
	 *
	 * The factory receives a FooterDataProvider for data not otherwise accessible:
	 * git branch and extension statuses from setStatus(). Token stats, model info,
	 * etc. are available via ctx.sessionManager and ctx.model.
	 */
	setFooter(
		factory:
			| ((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
			| undefined,
	): void;

	/** Set a custom header component (shown at startup, above chat), or undefined to restore the built-in header. */
	setHeader(factory: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined): void;

	/** Set the terminal window/tab title. */
	setTitle(title: string): void;

	/** Show a custom component with keyboard focus. */
	custom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: {
			overlay?: boolean;
			/** Overlay positioning/sizing options. Can be static or a function for dynamic updates. */
			overlayOptions?: OverlayOptions | (() => OverlayOptions);
			/** Called with the overlay handle after the overlay is shown. Use to control visibility. */
			onHandle?: (handle: OverlayHandle) => void;
		},
	): Promise<T>;

	/** Set the text in the core input editor. */
	setEditorText(text: string): void;

	/** Get the current text from the core input editor. */
	getEditorText(): string;

	/** Show a multi-line editor for text editing. */
	editor(title: string, prefill?: string): Promise<string | undefined>;

	/**
	 * Set a custom editor component via factory function.
	 * Pass undefined to restore the default editor.
	 *
	 * The factory receives:
	 * - `theme`: EditorTheme for styling borders and autocomplete
	 * - `keybindings`: KeybindingsManager for app-level keybindings
	 *
	 * For full app keybinding support (escape, ctrl+d, model switching, etc.),
	 * extend `CustomEditor` from `@mariozechner/pi-coding-agent` and call
	 * `super.handleInput(data)` for keys you don't handle.
	 *
	 * @example
	 * ```ts
	 * import { CustomEditor } from "@mariozechner/pi-coding-agent";
	 *
	 * class VimEditor extends CustomEditor {
	 *   private mode: "normal" | "insert" = "insert";
	 *
	 *   handleInput(data: string): void {
	 *     if (this.mode === "normal") {
	 *       // Handle vim normal mode keys...
	 *       if (data === "i") { this.mode = "insert"; return; }
	 *     }
	 *     super.handleInput(data);  // App keybindings + text editing
	 *   }
	 * }
	 *
	 * ctx.ui.setEditorComponent((tui, theme, keybindings) =>
	 *   new VimEditor(tui, theme, keybindings)
	 * );
	 * ```
	 */
	setEditorComponent(
		factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
	): void;

	/** Get the current theme for styling. */
	readonly theme: Theme;

	/** Get all available themes with their names and file paths. */
	getAllThemes(): { name: string; path: string | undefined }[];

	/** Load a theme by name without switching to it. Returns undefined if not found. */
	getTheme(name: string): Theme | undefined;

	/** Set the current theme by name or Theme object. */
	setTheme(theme: string | Theme): { success: boolean; error?: string };
}

// ============================================================================
// Extension Context
// ============================================================================

/**
 * Context passed to extension event handlers.
 */
export interface ExtensionContext {
	/** UI methods for user interaction */
	ui: ExtensionUIContext;
	/** Whether UI is available (false in print/RPC mode) */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Session manager (read-only) */
	sessionManager: ReadonlySessionManager;
	/** Model registry for API key resolution */
	modelRegistry: ModelRegistry;
	/** Current model (may be undefined) */
	model: Model<any> | undefined;
	/** Whether the agent is idle (not streaming) */
	isIdle(): boolean;
	/** Abort the current agent operation */
	abort(): void;
	/** Whether there are queued messages waiting */
	hasPendingMessages(): boolean;
	/** Gracefully shutdown pi and exit. Available in all contexts. */
	shutdown(): void;
}

/**
 * Extended context for command handlers.
 * Includes session control methods only safe in user-initiated commands.
 */
export interface ExtensionCommandContext extends ExtensionContext {
	/** Wait for the agent to finish streaming */
	waitForIdle(): Promise<void>;

	/** Start a new session, optionally with initialization. */
	newSession(options?: {
		parentSession?: string;
		setup?: (sessionManager: SessionManager) => Promise<void>;
	}): Promise<{ cancelled: boolean }>;

	/** Fork from a specific entry, creating a new session file. */
	fork(entryId: string): Promise<{ cancelled: boolean }>;

	/** Navigate to a different point in the session tree. */
	navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<{ cancelled: boolean }>;
}

// ============================================================================
// Tool Types
// ============================================================================

/** Rendering options for tool results */
export interface ToolRenderResultOptions {
	/** Whether the result view is expanded */
	expanded: boolean;
	/** Whether this is a partial/streaming result */
	isPartial: boolean;
}

/**
 * Tool definition for registerTool().
 */
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
	/** Tool name (used in LLM tool calls) */
	name: string;
	/** Human-readable label for UI */
	label: string;
	/** Description for LLM */
	description: string;
	/** Parameter schema (TypeBox) */
	parameters: TParams;

	/** Execute the tool. */
	execute(
		toolCallId: string,
		params: Static<TParams>,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<AgentToolResult<TDetails>>;

	/** Custom rendering for tool call display */
	renderCall?: (args: Static<TParams>, theme: Theme) => Component;

	/** Custom rendering for tool result display */
	renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme) => Component;
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
	reason: "new" | "resume";
	targetSessionFile?: string;
}

/** Fired after switching to another session */
export interface SessionSwitchEvent {
	type: "session_switch";
	reason: "new" | "resume";
	previousSessionFile: string | undefined;
}

/** Fired before forking a session (can be cancelled) */
export interface SessionBeforeForkEvent {
	type: "session_before_fork";
	entryId: string;
}

/** Fired after forking a session */
export interface SessionForkEvent {
	type: "session_fork";
	previousSessionFile: string | undefined;
}

/** Fired before context compaction (can be cancelled or customized) */
export interface SessionBeforeCompactEvent {
	type: "session_before_compact";
	preparation: CompactionPreparation;
	branchEntries: SessionEntry[];
	customInstructions?: string;
	signal: AbortSignal;
}

/** Fired after context compaction */
export interface SessionCompactEvent {
	type: "session_compact";
	compactionEntry: CompactionEntry;
	fromExtension: boolean;
}

/** Fired on process exit */
export interface SessionShutdownEvent {
	type: "session_shutdown";
}

/** Preparation data for tree navigation */
export interface TreePreparation {
	targetId: string;
	oldLeafId: string | null;
	commonAncestorId: string | null;
	entriesToSummarize: SessionEntry[];
	userWantsSummary: boolean;
}

/** Fired before navigating in the session tree (can be cancelled) */
export interface SessionBeforeTreeEvent {
	type: "session_before_tree";
	preparation: TreePreparation;
	signal: AbortSignal;
}

/** Fired after navigating in the session tree */
export interface SessionTreeEvent {
	type: "session_tree";
	newLeafId: string | null;
	oldLeafId: string | null;
	summaryEntry?: BranchSummaryEntry;
	fromExtension?: boolean;
}

export type SessionEvent =
	| SessionStartEvent
	| SessionBeforeSwitchEvent
	| SessionSwitchEvent
	| SessionBeforeForkEvent
	| SessionForkEvent
	| SessionBeforeCompactEvent
	| SessionCompactEvent
	| SessionShutdownEvent
	| SessionBeforeTreeEvent
	| SessionTreeEvent;

// ============================================================================
// Agent Events
// ============================================================================

/** Fired before each LLM call. Can modify messages. */
export interface ContextEvent {
	type: "context";
	messages: AgentMessage[];
}

/** Fired after user submits prompt but before agent loop. */
export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	prompt: string;
	images?: ImageContent[];
	systemPrompt: string;
}

/** Fired when an agent loop starts */
export interface AgentStartEvent {
	type: "agent_start";
}

/** Fired when an agent loop ends */
export interface AgentEndEvent {
	type: "agent_end";
	messages: AgentMessage[];
}

/** Fired at the start of each turn */
export interface TurnStartEvent {
	type: "turn_start";
	turnIndex: number;
	timestamp: number;
}

/** Fired at the end of each turn */
export interface TurnEndEvent {
	type: "turn_end";
	turnIndex: number;
	message: AgentMessage;
	toolResults: ToolResultMessage[];
}

// ============================================================================
// Model Events
// ============================================================================

export type ModelSelectSource = "set" | "cycle" | "restore";

/** Fired when a new model is selected */
export interface ModelSelectEvent {
	type: "model_select";
	model: Model<any>;
	previousModel: Model<any> | undefined;
	source: ModelSelectSource;
}

// ============================================================================
// User Bash Events
// ============================================================================

/** Fired when user executes a bash command via ! or !! prefix */
export interface UserBashEvent {
	type: "user_bash";
	/** The command to execute */
	command: string;
	/** True if !! prefix was used (excluded from LLM context) */
	excludeFromContext: boolean;
	/** Current working directory */
	cwd: string;
}

// ============================================================================
// Input Events
// ============================================================================

/** Source of user input */
export type InputSource = "interactive" | "rpc" | "extension";

/** Fired when user input is received, before agent processing */
export interface InputEvent {
	type: "input";
	/** The input text */
	text: string;
	/** Attached images, if any */
	images?: ImageContent[];
	/** Where the input came from */
	source: InputSource;
}

/** Result from input event handler */
export type InputEventResult =
	| { action: "continue" }
	| { action: "transform"; text: string; images?: ImageContent[] }
	| { action: "handled" };

// ============================================================================
// Tool Events
// ============================================================================

/** Fired before a tool executes. Can block. */
export interface ToolCallEvent {
	type: "tool_call";
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}

interface ToolResultEventBase {
	type: "tool_result";
	toolCallId: string;
	input: Record<string, unknown>;
	content: (TextContent | ImageContent)[];
	isError: boolean;
}

export interface BashToolResultEvent extends ToolResultEventBase {
	toolName: "bash";
	details: BashToolDetails | undefined;
}

export interface ReadToolResultEvent extends ToolResultEventBase {
	toolName: "read";
	details: ReadToolDetails | undefined;
}

export interface EditToolResultEvent extends ToolResultEventBase {
	toolName: "edit";
	details: EditToolDetails | undefined;
}

export interface WriteToolResultEvent extends ToolResultEventBase {
	toolName: "write";
	details: undefined;
}

export interface GrepToolResultEvent extends ToolResultEventBase {
	toolName: "grep";
	details: GrepToolDetails | undefined;
}

export interface FindToolResultEvent extends ToolResultEventBase {
	toolName: "find";
	details: FindToolDetails | undefined;
}

export interface LsToolResultEvent extends ToolResultEventBase {
	toolName: "ls";
	details: LsToolDetails | undefined;
}

export interface CustomToolResultEvent extends ToolResultEventBase {
	toolName: string;
	details: unknown;
}

/** Fired after a tool executes. Can modify result. */
export type ToolResultEvent =
	| BashToolResultEvent
	| ReadToolResultEvent
	| EditToolResultEvent
	| WriteToolResultEvent
	| GrepToolResultEvent
	| FindToolResultEvent
	| LsToolResultEvent
	| CustomToolResultEvent;

// Type guards
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

/** Union of all event types */
export type ExtensionEvent =
	| SessionEvent
	| ContextEvent
	| BeforeAgentStartEvent
	| AgentStartEvent
	| AgentEndEvent
	| TurnStartEvent
	| TurnEndEvent
	| ModelSelectEvent
	| UserBashEvent
	| InputEvent
	| ToolCallEvent
	| ToolResultEvent;

// ============================================================================
// Event Results
// ============================================================================

export interface ContextEventResult {
	messages?: AgentMessage[];
}

export interface ToolCallEventResult {
	block?: boolean;
	reason?: string;
}

/** Result from user_bash event handler */
export interface UserBashEventResult {
	/** Custom operations to use for execution */
	operations?: BashOperations;
	/** Full replacement: extension handled execution, use this result */
	result?: BashResult;
}

export interface ToolResultEventResult {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
	isError?: boolean;
}

export interface BeforeAgentStartEventResult {
	message?: Pick<CustomMessage, "customType" | "content" | "display" | "details">;
	/** Replace the system prompt for this turn. If multiple extensions return this, they are chained. */
	systemPrompt?: string;
}

export interface SessionBeforeSwitchResult {
	cancel?: boolean;
}

export interface SessionBeforeForkResult {
	cancel?: boolean;
	skipConversationRestore?: boolean;
}

export interface SessionBeforeCompactResult {
	cancel?: boolean;
	compaction?: CompactionResult;
}

export interface SessionBeforeTreeResult {
	cancel?: boolean;
	summary?: {
		summary: string;
		details?: unknown;
	};
}

// ============================================================================
// Message Rendering
// ============================================================================

export interface MessageRenderOptions {
	expanded: boolean;
}

export type MessageRenderer<T = unknown> = (
	message: CustomMessage<T>,
	options: MessageRenderOptions,
	theme: Theme,
) => Component | undefined;

// ============================================================================
// Command Registration
// ============================================================================

export interface RegisteredCommand {
	name: string;
	description?: string;
	getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

// ============================================================================
// Extension API
// ============================================================================

/** Handler function type for events */
// biome-ignore lint/suspicious/noConfusingVoidType: void allows bare return statements
export type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;

/**
 * ExtensionAPI passed to extension factory functions.
 */
export interface ExtensionAPI {
	// =========================================================================
	// Event Subscription
	// =========================================================================

	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(
		event: "session_before_switch",
		handler: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>,
	): void;
	on(event: "session_switch", handler: ExtensionHandler<SessionSwitchEvent>): void;
	on(event: "session_before_fork", handler: ExtensionHandler<SessionBeforeForkEvent, SessionBeforeForkResult>): void;
	on(event: "session_fork", handler: ExtensionHandler<SessionForkEvent>): void;
	on(
		event: "session_before_compact",
		handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
	): void;
	on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
	on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent, SessionBeforeTreeResult>): void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
	on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
	on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
	on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
	on(event: "model_select", handler: ExtensionHandler<ModelSelectEvent>): void;
	on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;
	on(event: "user_bash", handler: ExtensionHandler<UserBashEvent, UserBashEventResult>): void;
	on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): void;

	// =========================================================================
	// Tool Registration
	// =========================================================================

	/** Register a tool that the LLM can call. */
	registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(tool: ToolDefinition<TParams, TDetails>): void;

	// =========================================================================
	// Command, Shortcut, Flag Registration
	// =========================================================================

	/** Register a custom command. */
	registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void;

	/** Register a keyboard shortcut. */
	registerShortcut(
		shortcut: KeyId,
		options: {
			description?: string;
			handler: (ctx: ExtensionContext) => Promise<void> | void;
		},
	): void;

	/** Register a CLI flag. */
	registerFlag(
		name: string,
		options: {
			description?: string;
			type: "boolean" | "string";
			default?: boolean | string;
		},
	): void;

	/** Get the value of a registered CLI flag. */
	getFlag(name: string): boolean | string | undefined;

	// =========================================================================
	// Message Rendering
	// =========================================================================

	/** Register a custom renderer for CustomMessageEntry. */
	registerMessageRenderer<T = unknown>(customType: string, renderer: MessageRenderer<T>): void;

	// =========================================================================
	// Actions
	// =========================================================================

	/** Send a custom message to the session. */
	sendMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): void;

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 */
	sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): void;

	/** Append a custom entry to the session for state persistence (not sent to LLM). */
	appendEntry<T = unknown>(customType: string, data?: T): void;

	// =========================================================================
	// Session Metadata
	// =========================================================================

	/** Set the session display name (shown in session selector). */
	setSessionName(name: string): void;

	/** Get the current session name, if set. */
	getSessionName(): string | undefined;

	/** Execute a shell command. */
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;

	/** Get the list of currently active tool names. */
	getActiveTools(): string[];

	/** Get all configured tools with name and description. */
	getAllTools(): ToolInfo[];

	/** Set the active tools by name. */
	setActiveTools(toolNames: string[]): void;

	// =========================================================================
	// Model and Thinking Level
	// =========================================================================

	/** Set the current model. Returns false if no API key available. */
	setModel(model: Model<any>): Promise<boolean>;

	/** Get current thinking level. */
	getThinkingLevel(): ThinkingLevel;

	/** Set thinking level (clamped to model capabilities). */
	setThinkingLevel(level: ThinkingLevel): void;

	/** Shared event bus for extension communication. */
	events: EventBus;
}

/** Extension factory function type. Supports both sync and async initialization. */
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

// ============================================================================
// Loaded Extension Types
// ============================================================================

export interface RegisteredTool {
	definition: ToolDefinition;
	extensionPath: string;
}

export interface ExtensionFlag {
	name: string;
	description?: string;
	type: "boolean" | "string";
	default?: boolean | string;
	extensionPath: string;
}

export interface ExtensionShortcut {
	shortcut: KeyId;
	description?: string;
	handler: (ctx: ExtensionContext) => Promise<void> | void;
	extensionPath: string;
}

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

export type SendMessageHandler = <T = unknown>(
	message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
) => void;

export type SendUserMessageHandler = (
	content: string | (TextContent | ImageContent)[],
	options?: { deliverAs?: "steer" | "followUp" },
) => void;

export type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void;

export type SetSessionNameHandler = (name: string) => void;

export type GetSessionNameHandler = () => string | undefined;

export type GetActiveToolsHandler = () => string[];

/** Tool info with name and description */
export type ToolInfo = Pick<ToolDefinition, "name" | "description">;

export type GetAllToolsHandler = () => ToolInfo[];

export type SetActiveToolsHandler = (toolNames: string[]) => void;

export type SetModelHandler = (model: Model<any>) => Promise<boolean>;

export type GetThinkingLevelHandler = () => ThinkingLevel;

export type SetThinkingLevelHandler = (level: ThinkingLevel) => void;

/**
 * Shared state created by loader, used during registration and runtime.
 * Contains flag values (defaults set during registration, CLI values set after).
 */
export interface ExtensionRuntimeState {
	flagValues: Map<string, boolean | string>;
}

/**
 * Action implementations for pi.* API methods.
 * Provided to runner.initialize(), copied into the shared runtime.
 */
export interface ExtensionActions {
	sendMessage: SendMessageHandler;
	sendUserMessage: SendUserMessageHandler;
	appendEntry: AppendEntryHandler;
	setSessionName: SetSessionNameHandler;
	getSessionName: GetSessionNameHandler;
	getActiveTools: GetActiveToolsHandler;
	getAllTools: GetAllToolsHandler;
	setActiveTools: SetActiveToolsHandler;
	setModel: SetModelHandler;
	getThinkingLevel: GetThinkingLevelHandler;
	setThinkingLevel: SetThinkingLevelHandler;
}

/**
 * Actions for ExtensionContext (ctx.* in event handlers).
 * Required by all modes.
 */
export interface ExtensionContextActions {
	getModel: () => Model<any> | undefined;
	isIdle: () => boolean;
	abort: () => void;
	hasPendingMessages: () => boolean;
	shutdown: () => void;
}

/**
 * Actions for ExtensionCommandContext (ctx.* in command handlers).
 * Only needed for interactive mode where extension commands are invokable.
 */
export interface ExtensionCommandContextActions {
	waitForIdle: () => Promise<void>;
	newSession: (options?: {
		parentSession?: string;
		setup?: (sessionManager: SessionManager) => Promise<void>;
	}) => Promise<{ cancelled: boolean }>;
	fork: (entryId: string) => Promise<{ cancelled: boolean }>;
	navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
}

/**
 * Full runtime = state + actions.
 * Created by loader with throwing action stubs, completed by runner.initialize().
 */
export interface ExtensionRuntime extends ExtensionRuntimeState, ExtensionActions {}

/** Loaded extension with all registered items. */
export interface Extension {
	path: string;
	resolvedPath: string;
	handlers: Map<string, HandlerFn[]>;
	tools: Map<string, RegisteredTool>;
	messageRenderers: Map<string, MessageRenderer>;
	commands: Map<string, RegisteredCommand>;
	flags: Map<string, ExtensionFlag>;
	shortcuts: Map<KeyId, ExtensionShortcut>;
}

/** Result of loading extensions. */
export interface LoadExtensionsResult {
	extensions: Extension[];
	errors: Array<{ path: string; error: string }>;
	/** Shared runtime - actions are throwing stubs until runner.initialize() */
	runtime: ExtensionRuntime;
}

// ============================================================================
// Extension Error
// ============================================================================

export interface ExtensionError {
	extensionPath: string;
	event: string;
	error: string;
	stack?: string;
}
