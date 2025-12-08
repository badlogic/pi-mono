import type { AgentEvent, AppMessage } from "@mariozechner/pi-agent-core";
import type { SessionEntry, SessionMessageEntry } from "../session-manager.js";

/**
 * Hook events extend AgentEvent with harness-specific events.
 * These are events that originate from the TUI/harness, not the agent core.
 */
export type HookEvent =
	| AgentEvent
	// Harness events
	| {
			type: "branch";
			sessionId: string;
			/** The message entry the user selected */
			selectedEntry: SessionMessageEntry;
			/** Index of selected entry in the entries array */
			selectedIndex: number;
			/** Full session history including compacted messages */
			entries: SessionEntry[];
	  }
	| { type: "command"; name: string; args: string[] }
	| { type: "session_load"; sessionId: string }
	| { type: "session_save"; sessionId: string }
	// Hook system events
	| { type: "hook_error"; hookId: string; event: string; error: string };

/**
 * Selector item for UI selector requests.
 */
export interface SelectorItem<T extends string = string> {
	id: T;
	label: string;
	hint?: string;
}

/**
 * UI context for hooks to request interactive UI from the harness.
 */
export interface HookUIContext {
	/**
	 * Show a selector and return the user's choice.
	 * @returns Selected item id, or null if cancelled
	 */
	selector<T extends string>(options: { title: string; items: SelectorItem<T>[] }): Promise<T | null>;

	/**
	 * Show a confirmation dialog.
	 * @returns true if confirmed, false if cancelled
	 */
	confirm(options: { title: string; message: string }): Promise<boolean>;

	/**
	 * Show a text input dialog.
	 * @returns User input, or null if cancelled
	 */
	input(options: { title: string; placeholder?: string }): Promise<string | null>;

	/**
	 * Show a notification to the user.
	 */
	notify(options: { message: string; type: "info" | "warning" | "error" }): void;
}

/**
 * Storage context for hooks to persist data across sessions.
 */
export interface HookStorageContext {
	/**
	 * Get a value by key.
	 */
	get<T>(key: string): Promise<T | null>;

	/**
	 * Set a value by key.
	 */
	set<T>(key: string, value: T): Promise<void>;

	/**
	 * Delete a value by key.
	 */
	delete(key: string): Promise<void>;

	/**
	 * List all keys, optionally filtered by prefix.
	 */
	list(prefix?: string): Promise<string[]>;
}

/**
 * Actions context for hooks to perform agent/session actions.
 */
export interface HookActionsContext {
	/**
	 * Branch conversation from the selected entry index.
	 * This creates a new session with messages up to (but not including) the selected entry.
	 */
	branch(selectedIndex: number, entries: SessionEntry[]): Promise<void>;
}

/**
 * Git context for hooks that need git operations.
 * Only available when running in a git repository.
 */
export interface HookGitContext {
	isRepo: boolean;
	/**
	 * Get current HEAD commit hash.
	 */
	head(): Promise<string>;
	/**
	 * Check if there are uncommitted changes.
	 */
	isDirty(): Promise<boolean>;
}

/**
 * Context object passed to hook handlers.
 * Provides controlled access to pi internals.
 */
export interface HookContext {
	/** Abort signal - hooks should check this for cancellation */
	signal: AbortSignal;
	/** Read-only session state */
	session: {
		id: string;
		messages: AppMessage[];
		cwd: string;
		/** Load full session history including compacted messages */
		loadEntries(): SessionEntry[];
	};
	/** UI request methods */
	ui: HookUIContext;
	/** Persistent storage for hook data */
	storage: HookStorageContext;
	/** Actions hooks can perform */
	actions: HookActionsContext;
	/** Git utilities (undefined if not in a git repo) */
	git?: HookGitContext;
}

/**
 * Hook module interface.
 * Hooks export a default object implementing this interface.
 */
export interface HookModule {
	/** Unique identifier for the hook */
	id: string;
	/** Human-readable name */
	name?: string;
	/** Description of what the hook does */
	description?: string;

	// Agent lifecycle handlers
	onAgentStart?(event: Extract<AgentEvent, { type: "agent_start" }>, ctx: HookContext): Promise<void>;
	onAgentEnd?(event: Extract<AgentEvent, { type: "agent_end" }>, ctx: HookContext): Promise<void>;

	// Turn lifecycle handlers
	onTurnStart?(event: Extract<AgentEvent, { type: "turn_start" }>, ctx: HookContext): Promise<void>;
	onTurnEnd?(event: Extract<AgentEvent, { type: "turn_end" }>, ctx: HookContext): Promise<void>;

	// Message lifecycle handlers
	onMessageStart?(event: Extract<AgentEvent, { type: "message_start" }>, ctx: HookContext): Promise<void>;
	/**
	 * Called during streaming for each chunk of the assistant's message.
	 * Note: This fires frequently during streaming - keep handlers lightweight.
	 */
	onMessageUpdate?(event: Extract<AgentEvent, { type: "message_update" }>, ctx: HookContext): Promise<void>;
	onMessageEnd?(event: Extract<AgentEvent, { type: "message_end" }>, ctx: HookContext): Promise<void>;

	// Tool execution handlers
	onToolExecutionStart?(event: Extract<AgentEvent, { type: "tool_execution_start" }>, ctx: HookContext): Promise<void>;
	onToolExecutionEnd?(event: Extract<AgentEvent, { type: "tool_execution_end" }>, ctx: HookContext): Promise<void>;

	// Harness event handlers
	/** Called after user selects a message to branch from. Hook can show additional UI (e.g., restore options). */
	onBranch?(event: Extract<HookEvent, { type: "branch" }>, ctx: HookContext): Promise<void>;
	onCommand?(event: Extract<HookEvent, { type: "command" }>, ctx: HookContext): Promise<void>;
	onSessionLoad?(event: Extract<HookEvent, { type: "session_load" }>, ctx: HookContext): Promise<void>;
	onSessionSave?(event: Extract<HookEvent, { type: "session_save" }>, ctx: HookContext): Promise<void>;
}

/**
 * Hook configuration from settings.
 */
export interface HookConfig {
	/** Unique identifier */
	id: string;
	/** Path to the hook module (absolute or relative to ~/.pi/hooks/) */
	path: string;
	/** Events this hook subscribes to */
	events: string[];
	/** Whether the hook is enabled */
	enabled: boolean;
	/** Timeout in milliseconds (default: 30000) */
	timeout?: number;
}

/**
 * All known event types that hooks can subscribe to.
 */
export const KNOWN_HOOK_EVENTS = [
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_end",
	"branch",
	"command",
	"session_load",
	"session_save",
] as const;
