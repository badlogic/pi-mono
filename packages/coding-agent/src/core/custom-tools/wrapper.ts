/**
 * Wraps CustomTool instances into AgentTool for use with the agent.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { CustomTool, CustomToolContext, LoadedCustomTool } from "./types.js";

/**
 * Wrap a CustomTool into an AgentTool.
 * The wrapper injects the ToolContext into execute calls.
 */
export function wrapCustomTool(tool: CustomTool, getContext: () => CustomToolContext): AgentTool {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		execute: (toolCallId, params, signal, onUpdate) =>
			tool.execute(toolCallId, params, signal, onUpdate, getContext()),
	};
}

/**
 * Wrap all loaded custom tools into AgentTools.
 */
export function wrapCustomTools(loadedTools: LoadedCustomTool[], getContext: () => CustomToolContext): AgentTool[] {
	return loadedTools.map((lt) => wrapCustomTool(lt.tool, getContext));
}
