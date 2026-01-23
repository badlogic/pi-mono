/**
 * Tool wrappers for extensions.
 */

import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
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
	const toolResultContentToErrorMessage = (
		content: (TextContent | ImageContent)[] | undefined,
		fallback: string,
	): string => {
		if (!content || content.length === 0) return fallback;
		const text = content
			.filter((item): item is TextContent => item.type === "text" && !!item.text)
			.map((item) => item.text)
			.join("")
			.trim();
		if (text) return text;
		return `${fallback} [non-text content]`;
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
			let forcedError = false;

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
						const nextContent = resultResult.content ?? result.content;
						const nextDetails = (resultResult.details ?? result.details) as T;
						if (resultResult.isError) {
							forcedError = true;
							throw new Error(toolResultContentToErrorMessage(nextContent, "Tool execution failed."));
						}

						return {
							content: nextContent,
							details: nextDetails,
						};
					}
				}

				return result;
			} catch (err) {
				if (forcedError) {
					throw err;
				}
				// Emit tool_result event for errors
				if (runner.hasHandlers("tool_result")) {
					const fallbackMessage = err instanceof Error ? err.message : String(err);
					const content = [{ type: "text" as const, text: fallbackMessage }];
					const resultResult = (await runner.emit({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: effectiveParams,
						content,
						details: undefined,
						isError: true,
					})) as ToolResultEventResult | undefined;

					if (resultResult) {
						if (!resultResult.isError) {
							throw err;
						}
						const nextContent = resultResult.content ?? content;
						throw new Error(toolResultContentToErrorMessage(nextContent, fallbackMessage));
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
