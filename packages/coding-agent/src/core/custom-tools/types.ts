/**
 * Custom tool types.
 *
 * Custom tools are TypeScript modules that define additional tools for the agent.
 * They can provide custom rendering for tool calls and results in the TUI.
 */

import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type { Component } from "@mariozechner/pi-tui";
import type { Static, TSchema } from "@sinclair/typebox";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { ExecOptions, ExecResult } from "../exec.js";
import type { HookUIContext } from "../hooks/types.js";
import type { ModelRegistry } from "../model-registry.js";
import type { ReadonlySessionManager } from "../session-manager.js";

/** Alias for clarity */
export type CustomToolUIContext = HookUIContext;

/** Re-export for custom tools to use in execute signature */
export type { AgentToolResult, AgentToolUpdateCallback };

// Re-export for backward compatibility
export type { ExecOptions, ExecResult } from "../exec.js";

/** API passed to custom tool factory (stable across session changes) */
export interface CustomToolAPI {
	/** Current working directory */
	cwd: string;
	/** Execute a command */
	exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
	/** UI methods for user interaction (select, confirm, input, notify, custom) */
	ui: CustomToolUIContext;
	/** Whether UI is available (false in print/RPC mode) */
	hasUI: boolean;
}

/**
 * Context passed to tool execute and onSession callbacks.
 * Provides access to session state and model information.
 */
export interface CustomToolContext {
	/** Session manager (read-only) */
	sessionManager: ReadonlySessionManager;
	/** Model registry - use for API key resolution and model retrieval */
	modelRegistry: ModelRegistry;
	/** Current model (may be undefined if no model is selected yet) */
	model: Model<any> | undefined;
}

/** Session event passed to onSession callback */
export interface CustomToolSessionEvent {
	/** Reason for the session event */
	reason: "start" | "switch" | "branch" | "new" | "tree" | "shutdown";
	/** Previous session file path, or undefined for "start", "new", and "shutdown" */
	previousSessionFile: string | undefined;
}

/** Rendering options passed to renderResult */
export interface RenderResultOptions {
	/** Whether the result view is expanded */
	expanded: boolean;
	/** Whether this is a partial/streaming result */
	isPartial: boolean;
}

export type CustomToolResult<TDetails = any> = AgentToolResult<TDetails>;

/**
 * Custom tool definition.
 *
 * Custom tools are standalone - they don't extend AgentTool directly.
 * When loaded, they are wrapped in an AgentTool for the agent to use.
 *
 * The execute callback receives a ToolContext with access to session state,
 * model registry, and current model.
 *
 * @example
 * ```typescript
 * const factory: CustomToolFactory = (pi) => ({
 *   name: "my_tool",
 *   label: "My Tool",
 *   description: "Does something useful",
 *   parameters: Type.Object({ input: Type.String() }),
 *
 *   async execute(toolCallId, params, signal, onUpdate, ctx) {
 *     // Access session state via ctx.sessionManager
 *     // Access model registry via ctx.modelRegistry
 *     // Current model via ctx.model
 *     return { content: [{ type: "text", text: "Done" }] };
 *   },
 *
 *   onSession(event, ctx) {
 *     if (event.reason === "shutdown") {
 *       // Cleanup
 *     }
 *     // Reconstruct state from ctx.sessionManager.getEntries()
 *   }
 * });
 * ```
 */
export interface CustomTool<TParams extends TSchema = TSchema, TDetails = any> {
	/** Tool name (used in LLM tool calls) */
	name: string;
	/** Human-readable label for UI */
	label: string;
	/** Description for LLM */
	description: string;
	/** Parameter schema (TypeBox) */
	parameters: TParams;

	/**
	 * Execute the tool.
	 * @param toolCallId - Unique ID for this tool call
	 * @param params - Parsed parameters matching the schema
	 * @param signal - AbortSignal for cancellation
	 * @param onUpdate - Callback for streaming partial results (for UI, not LLM)
	 * @param ctx - Context with session manager, model registry, and current model
	 */
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: CustomToolContext,
	): Promise<AgentToolResult<TDetails>>;

	/** Called on session lifecycle events - use to reconstruct state or cleanup resources */
	onSession?: (event: CustomToolSessionEvent, ctx: CustomToolContext) => void | Promise<void>;
	/** Custom rendering for tool call display - return a Component */
	renderCall?: (args: Static<TParams>, theme: Theme) => Component;

	/** Custom rendering for tool result display - return a Component */
	renderResult?: (result: CustomToolResult<TDetails>, options: RenderResultOptions, theme: Theme) => Component;
}

/** Factory function that creates a custom tool or array of tools */
export type CustomToolFactory = (
	pi: CustomToolAPI,
) => CustomTool<any, any> | CustomTool<any, any>[] | Promise<CustomTool<any, any> | CustomTool<any, any>[]>;

/** Loaded custom tool with metadata and wrapped AgentTool */
export interface LoadedCustomTool {
	/** Original path (as specified) */
	path: string;
	/** Resolved absolute path */
	resolvedPath: string;
	/** The original custom tool instance */
	tool: CustomTool;
}

/** Result from loading custom tools */
export interface CustomToolsLoadResult {
	tools: LoadedCustomTool[];
	errors: Array<{ path: string; error: string }>;
	/** Update the UI context for all loaded tools. Call when mode initializes. */
	setUIContext(uiContext: CustomToolUIContext, hasUI: boolean): void;
}
