/**
 * Tool wrapper - wraps tools with hook callbacks for interception.
 */

import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { HookRunner } from "./runner.js";
import type {
	ToolBeforeApplyEvent,
	ToolBeforeApplyEventResult,
	ToolCallEventResult,
	ToolResultEventResult,
} from "./types.js";

/**
 * Callback for tool_before_apply event.
 * Tools that support preview can call this before applying changes.
 */
export type BeforeApplyCallback = (event: ToolBeforeApplyEvent) => Promise<ToolBeforeApplyEventResult | undefined>;

/**
 * Wrap a tool with hook callbacks.
 * - Emits tool_call event before execution (can block)
 * - Emits tool_before_apply event for tools that support it (can block)
 * - Emits tool_result event after execution (can modify result)
 * - Forwards onUpdate callback to wrapped tool for progress streaming
 */
export function wrapToolWithHooks<T>(tool: AgentTool<any, T>, hookRunner: HookRunner): AgentTool<any, T> {
	return {
		...tool,
		execute: async (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<T>,
		) => {
			// Emit tool_call event - hooks can block execution
			// If hook errors/times out, block by default (fail-safe)
			if (hookRunner.hasHandlers("tool_call")) {
				try {
					const callResult = (await hookRunner.emitToolCall({
						type: "tool_call",
						toolName: tool.name,
						toolCallId,
						input: params,
					})) as ToolCallEventResult | undefined;

					if (callResult?.block) {
						const reason = callResult.reason || "Tool execution was blocked by a hook";
						throw new Error(reason);
					}
				} catch (err) {
					// Hook error or block - throw to mark as error
					if (err instanceof Error) {
						throw err;
					}
					throw new Error(`Hook failed, blocking execution: ${String(err)}`);
				}
			}

			// Create beforeApply callback for tools that support it
			let beforeApplyCallback: BeforeApplyCallback | undefined;
			if (hookRunner.hasHandlers("tool_before_apply")) {
				beforeApplyCallback = async (event: ToolBeforeApplyEvent) => {
					try {
						const result = await hookRunner.emitToolBeforeApply(event);
						if (result?.block) {
							throw new Error(result.reason || "Blocked by hook");
						}
						return result;
					} catch (err) {
						if (err instanceof Error) {
							throw err;
						}
						throw new Error(`Hook failed: ${String(err)}`);
					}
				};
			}

			// Execute the actual tool, forwarding onUpdate for progress streaming
			// Tools that support beforeApply will use the callback, others will ignore it
			try {
				const executeParams = beforeApplyCallback
					? { ...params, __beforeApplyCallback: beforeApplyCallback }
					: params;

				const result = await tool.execute(toolCallId, executeParams, signal, onUpdate);

				// Emit tool_result event - hooks can modify the result
				if (hookRunner.hasHandlers("tool_result")) {
					const resultResult = (await hookRunner.emit({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: params,
						content: result.content,
						details: result.details,
						isError: false,
					})) as ToolResultEventResult | undefined;

					// Apply modifications if any
					if (resultResult) {
						return {
							content: resultResult.content ?? result.content,
							details: (resultResult.details ?? result.details) as T,
						};
					}
				}

				return result;
			} catch (err) {
				// Emit tool_result event for errors so hooks can observe failures
				if (hookRunner.hasHandlers("tool_result")) {
					await hookRunner.emit({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: params,
						content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
						details: undefined,
						isError: true,
					});
				}
				throw err; // Re-throw original error for agent-loop
			}
		},
	};
}

/**
 * Wrap all tools with hook callbacks.
 */
export function wrapToolsWithHooks<T>(tools: AgentTool<any, T>[], hookRunner: HookRunner): AgentTool<any, T>[] {
	return tools.map((tool) => wrapToolWithHooks(tool, hookRunner));
}
