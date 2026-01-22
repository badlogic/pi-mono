/**
 * Tool wrappers for extensions.
 */

import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { getShellConfig, getShellEnv } from "../../utils/shell.js";
import type { ExtensionRunner } from "./runner.js";
import type { BeforeBashExecEvent, RegisteredTool, ToolCallEventResult, ToolResultEventResult } from "./types.js";

/**
 * Wrap a RegisteredTool into an AgentTool.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool {
	const { definition } = registeredTool;
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		execute: (toolCallId, params, signal, onUpdate) =>
			definition.execute(toolCallId, params, onUpdate, runner.createContext(), signal),
	};
}

/**
 * Wrap all registered tools into AgentTools.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTools(registeredTools: RegisteredTool[], runner: ExtensionRunner): AgentTool[] {
	return registeredTools.map((rt) => wrapRegisteredTool(rt, runner));
}

/**
 * Wrap a tool with extension callbacks for interception.
 * - Emits tool_call event before execution (can block)
 * - Emits tool_result event after execution (can modify result)
 */
export function wrapToolWithExtensions<T>(tool: AgentTool<any, T>, runner: ExtensionRunner): AgentTool<any, T> {
	type BashToolParams = {
		command: string;
		timeout?: number;
	};
	type BashExecParams = BashToolParams & {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		shell?: string;
		args?: string[];
	};
	const applyBeforeBashExecOverrides = async (
		toolCallId: string,
		params: BashToolParams,
		runner: ExtensionRunner,
	): Promise<BashExecParams> => {
		const shellConfig = getShellConfig();
		const context = runner.createContext();
		const baseEvent: BeforeBashExecEvent = {
			type: "before_bash_exec",
			source: "tool",
			command: params.command,
			originalCommand: params.command,
			cwd: context.cwd,
			env: { ...getShellEnv() },
			shell: shellConfig.shell,
			args: [...shellConfig.args],
			toolCallId,
			timeout: params.timeout,
		};
		const execEvent = await runner.emitBeforeBashExec(baseEvent);
		return {
			...params,
			command: execEvent.command,
			cwd: execEvent.cwd,
			env: execEvent.env,
			shell: execEvent.shell,
			args: execEvent.args,
			timeout: execEvent.timeout,
		};
	};

	return {
		...tool,
		execute: async (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<T>,
		) => {
			let effectiveParams = params;

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

			if (tool.name === "bash" && runner.hasHandlers("before_bash_exec")) {
				effectiveParams = await applyBeforeBashExecOverrides(toolCallId, params as BashToolParams, runner);
			}

			// Execute the actual tool
			try {
				const result = await tool.execute(toolCallId, effectiveParams, signal, onUpdate);

				// Emit tool_result event - extensions can modify the result
				if (runner.hasHandlers("tool_result")) {
					const resultResult = (await runner.emit({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: effectiveParams,
						content: result.content,
						details: result.details,
						isError: false,
					})) as ToolResultEventResult | undefined;

					if (resultResult) {
						if (resultResult.errorMessage !== undefined) {
							throw new Error(resultResult.errorMessage);
						}

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
					const content = [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }];
					const resultResult = (await runner.emit({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: effectiveParams,
						content,
						details: undefined,
						isError: true,
					})) as ToolResultEventResult | undefined;

					if (resultResult?.errorMessage !== undefined) {
						throw new Error(resultResult.errorMessage);
					}
				}
				throw err;
			}
		},
	};
}

/**
 * Wrap all tools with extension callbacks.
 */
export function wrapToolsWithExtensions<T>(tools: AgentTool<any, T>[], runner: ExtensionRunner): AgentTool<any, T>[] {
	return tools.map((tool) => wrapToolWithExtensions(tool, runner));
}
