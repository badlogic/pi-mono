/**
 * Tool wrappers for extensions.
 */

import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import { getLspDiagnosticsForToolResult } from "../lsp/hook.js";
import type { LspManager } from "../lsp/manager.js";
import { resolveToCwd } from "../tools/path-utils.js";
import type { ExtensionRunner } from "./runner.js";
import type { RegisteredTool, ToolCallEventResult } from "./types.js";

// ============================================================================
// Built-in path extractors
// ============================================================================

/**
 * Built-in tools that modify files and their path extraction logic.
 */
const BUILTIN_PATH_EXTRACTORS: Record<string, (params: Record<string, unknown>) => string | undefined> = {
	edit: (params) => (typeof params.path === "string" ? params.path : undefined),
	write: (params) => (typeof params.path === "string" ? params.path : undefined),
};

// ============================================================================
// Types
// ============================================================================

/** Options for wrapping tools */
export interface WrapToolOptions {
	lspManager?: LspManager;
	cwd?: string;
}

/**
 * Extended AgentTool that carries optional LSP metadata.
 */
interface AgentToolWithLsp<T = unknown> extends AgentTool<any, T> {
	getModifiedFilePath?: (params: Record<string, unknown>) => string | undefined;
}

// ============================================================================
// Wrapping Functions
// ============================================================================

/**
 * Wrap a RegisteredTool into an AgentTool.
 * Preserves getModifiedFilePath from the ToolDefinition for LSP integration.
 */
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool {
	const { definition } = registeredTool;
	const tool: AgentToolWithLsp = {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		execute: (toolCallId, params, signal, onUpdate) =>
			definition.execute(toolCallId, params, signal, onUpdate, runner.createContext()),
	};

	// Carry forward LSP metadata
	if (definition.getModifiedFilePath) {
		tool.getModifiedFilePath = definition.getModifiedFilePath as (
			params: Record<string, unknown>,
		) => string | undefined;
	}

	return tool;
}

/**
 * Wrap all registered tools into AgentTools.
 */
export function wrapRegisteredTools(registeredTools: RegisteredTool[], runner: ExtensionRunner): AgentTool[] {
	return registeredTools.map((rt) => wrapRegisteredTool(rt, runner));
}

/**
 * Resolve the file path that a tool modified, if any.
 *
 * Checks in order:
 * 1. Extension-defined getModifiedFilePath on the tool
 * 2. Built-in path extractors for known tools (edit, write)
 *
 * Returns the resolved absolute path, or undefined if the tool is not file-modifying.
 */
function resolveModifiedFilePath(
	tool: AgentToolWithLsp,
	params: Record<string, unknown>,
	cwd: string,
): string | undefined {
	// 1. Extension-defined extractor (highest priority)
	if (tool.getModifiedFilePath) {
		const filePath = tool.getModifiedFilePath(params);
		if (filePath) return resolveToCwd(filePath, cwd);
	}

	// 2. Built-in extractors
	const builtinExtractor = BUILTIN_PATH_EXTRACTORS[tool.name];
	if (builtinExtractor) {
		const filePath = builtinExtractor(params);
		if (filePath) return resolveToCwd(filePath, cwd);
	}

	return undefined;
}

/**
 * Wrap a tool with extension callbacks for interception.
 * - Emits tool_call event before execution (can block)
 * - Emits tool_result event after execution (can modify result)
 * - Runs LSP diagnostics after file-modifying tools
 */
export function wrapToolWithExtensions<T>(
	tool: AgentTool<any, T>,
	runner: ExtensionRunner,
	options?: WrapToolOptions,
): AgentTool<any, T> {
	const wrapped: AgentToolWithLsp<T> = {
		...tool,
		execute: async (toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<T>) => {
			// Emit tool_call event - extensions can block execution
			if (runner.hasHandlers("tool_call")) {
				try {
					const callResult = (await runner.emitToolCall({
						type: "tool_call",
						toolName: tool.name,
						toolCallId,
						input: params,
					})) as ToolCallEventResult | undefined;

					if (callResult?.block) {
						const reason = callResult.reason || "Tool execution was blocked by an extension";
						throw new Error(reason);
					}
				} catch (err) {
					if (err instanceof Error) {
						throw err;
					}
					throw new Error(`Extension failed, blocking execution: ${String(err)}`);
				}
			}

			// Execute the actual tool
			try {
				let result = await tool.execute(toolCallId, params, signal, onUpdate);

				// Run LSP diagnostics after file-modifying tools
				if (options?.lspManager && options.cwd) {
					const absolutePath = resolveModifiedFilePath(tool as AgentToolWithLsp, params, options.cwd);
					if (absolutePath) {
						const lspContent = await getLspDiagnosticsForToolResult(options.lspManager, absolutePath);
						if (lspContent) {
							result = {
								...result,
								content: [...result.content, lspContent as TextContent],
							};
						}
					}
				}

				// Emit tool_result event - extensions can modify the result
				if (runner.hasHandlers("tool_result")) {
					const resultResult = await runner.emitToolResult({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: params,
						content: result.content,
						details: result.details,
						isError: false,
					});

					if (resultResult) {
						return {
							content: resultResult.content ?? result.content,
							details: (resultResult.details ?? result.details) as T,
						};
					}
				}

				return result;
			} catch (err) {
				// Emit tool_result event for errors
				if (runner.hasHandlers("tool_result")) {
					await runner.emitToolResult({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: params,
						content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
						details: undefined,
						isError: true,
					});
				}
				throw err;
			}
		},
	};

	// Preserve getModifiedFilePath through wrapping chain
	const sourceTool = tool as AgentToolWithLsp;
	if (sourceTool.getModifiedFilePath) {
		wrapped.getModifiedFilePath = sourceTool.getModifiedFilePath;
	}

	return wrapped;
}

/**
 * Wrap all tools with extension callbacks.
 */
export function wrapToolsWithExtensions<T>(
	tools: AgentTool<any, T>[],
	runner: ExtensionRunner,
	options?: WrapToolOptions,
): AgentTool<any, T>[] {
	return tools.map((tool) => wrapToolWithExtensions(tool, runner, options));
}
