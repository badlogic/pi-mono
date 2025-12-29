/**
 * Custom tool types.
 *
 * Custom tools are TypeScript modules that define additional tools for the agent.
 * They can provide custom rendering for tool calls and results in the TUI.
 */

import type { AgentTool, AgentToolResult, AgentToolUpdateCallback, AssistantMessage } from "@mariozechner/pi-ai";
import type { Component } from "@mariozechner/pi-tui";
import type { Static, TSchema } from "@sinclair/typebox";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { HookUIContext } from "../hooks/types.js";
import type { SessionEntry } from "../session-manager.js";

/** Alias for clarity */
export type ToolUIContext = HookUIContext;

/** Re-export for custom tools to use in execute signature */
export type { AgentToolUpdateCallback };

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

/** Options for complete() API call */
export interface CompleteOptions {
	/** Model ID to use (e.g., "claude-haiku-4-5", "gpt-4o-mini"). Defaults to current session model. */
	model?: string;
	/** System prompt for the completion */
	systemPrompt?: string;
	/** Maximum tokens in response */
	maxTokens?: number;
	/** AbortSignal to cancel the request */
	signal?: AbortSignal;
}

/** API passed to custom tool factory (stable across session changes) */
export interface ToolAPI {
	/** Current working directory */
	cwd: string;
	/** Execute a command */
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
	/** UI methods for user interaction (select, confirm, input, notify) */
	ui: ToolUIContext;
	/** Whether UI is available (false in print/RPC mode) */
	hasUI: boolean;
	/** Get text content of the last assistant message, or null if none */
	getLastAssistantText(): string | null;
	/** Set the editor text content */
	setEditorText(text: string): void;
	/** Get current editor text content */
	getEditorText(): string;
	/**
	 * Make an LLM completion call.
	 * Uses the session's model registry to resolve API keys.
	 * @param prompt The user prompt to send
	 * @param options Optional model, system prompt, max tokens
	 * @returns The assistant message response
	 */
	complete(prompt: string, options?: CompleteOptions): Promise<AssistantMessage>;
	/** Show a status message */
	showStatus(message: string): void;
	/** Show an error message */
	showError(message: string): void;
	/** Copy text to clipboard */
	copyToClipboard(text: string): void;
}

/** Session event passed to onSession callback */
export interface SessionEvent {
	/** All session entries (including pre-compaction history) */
	entries: SessionEntry[];
	/** Current session file path, or null in --no-session mode */
	sessionFile: string | null;
	/** Previous session file path, or null for "start" and "new" */
	previousSessionFile: string | null;
	/** Reason for the session event */
	reason: "start" | "switch" | "branch" | "new";
}

/** Rendering options passed to renderResult */
export interface RenderResultOptions {
	/** Whether the result view is expanded */
	expanded: boolean;
	/** Whether this is a partial/streaming result */
	isPartial: boolean;
}

/**
 * Custom tool with optional lifecycle and rendering methods.
 *
 * The execute signature inherited from AgentTool includes an optional onUpdate callback
 * for streaming progress updates during long-running operations:
 * - The callback emits partial results to subscribers (e.g. TUI/RPC), not to the LLM.
 * - Partial updates should use the same TDetails type as the final result (use a union if needed).
 *
 * @example
 * ```typescript
 * type Details =
 *   | { status: "running"; step: number; total: number }
 *   | { status: "done"; count: number };
 *
 * async execute(toolCallId, params, signal, onUpdate) {
 *   const items = params.items || [];
 *   for (let i = 0; i < items.length; i++) {
 *     onUpdate?.({
 *       content: [{ type: "text", text: `Step ${i + 1}/${items.length}...` }],
 *       details: { status: "running", step: i + 1, total: items.length },
 *     });
 *     await processItem(items[i], signal);
 *   }
 *   return { content: [{ type: "text", text: "Done" }], details: { status: "done", count: items.length } };
 * }
 * ```
 *
 * Progress updates are rendered via renderResult with isPartial: true.
 */
export interface CustomAgentTool<TParams extends TSchema = TSchema, TDetails = any>
	extends AgentTool<TParams, TDetails> {
	/** Called on session start/switch/branch/clear - use to reconstruct state from entries */
	onSession?: (event: SessionEvent) => void | Promise<void>;
	/** Custom rendering for tool call display - return a Component */
	renderCall?: (args: Static<TParams>, theme: Theme) => Component;
	/** Custom rendering for tool result display - return a Component */
	renderResult?: (result: AgentToolResult<TDetails>, options: RenderResultOptions, theme: Theme) => Component;
	/** Called when session ends - cleanup resources */
	dispose?: () => Promise<void> | void;
}

/** Factory function that creates a custom tool or array of tools */
export type CustomToolFactory = (
	pi: ToolAPI,
) => CustomAgentTool<any> | CustomAgentTool[] | Promise<CustomAgentTool | CustomAgentTool[]>;

/** Loaded custom tool with metadata */
export interface LoadedCustomTool {
	/** Original path (as specified) */
	path: string;
	/** Resolved absolute path */
	resolvedPath: string;
	/** The tool instance */
	tool: CustomAgentTool;
}

/** Result from loading custom tools */
export interface CustomToolsLoadResult {
	tools: LoadedCustomTool[];
	errors: Array<{ path: string; error: string }>;
	/** Update the UI context for all loaded tools. Call when mode initializes. */
	setUIContext(uiContext: ToolUIContext, hasUI: boolean): void;
}
