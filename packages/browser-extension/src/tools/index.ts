import type { TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { getToolRenderer, registerToolRenderer } from "./renderer-registry.js";
import { BashRenderer } from "./renderers/BashRenderer.js";
import { CalculateRenderer } from "./renderers/CalculateRenderer.js";
import { DefaultRenderer } from "./renderers/DefaultRenderer.js";
import { GetCurrentTimeRenderer } from "./renderers/GetCurrentTimeRenderer.js";
import "./javascript-repl.js"; // Import for side effects (registers renderer)
import "./browser-javascript.js"; // Import for side effects (registers renderer)

// Register all built-in tool renderers
registerToolRenderer("calculate", new CalculateRenderer());
registerToolRenderer("get_current_time", new GetCurrentTimeRenderer());
registerToolRenderer("bash", new BashRenderer());

const defaultRenderer = new DefaultRenderer();

/**
 * Render tool call parameters
 */
export function renderToolParams(toolName: string, params: any, isStreaming?: boolean): TemplateResult {
	const renderer = getToolRenderer(toolName);
	if (renderer) {
		return renderer.renderParams(params, isStreaming);
	}
	return defaultRenderer.renderParams(params, isStreaming);
}

/**
 * Render tool result
 */
export function renderToolResult(toolName: string, params: any, result: ToolResultMessage): TemplateResult {
	const renderer = getToolRenderer(toolName);
	if (renderer) {
		return renderer.renderResult(params, result);
	}
	return defaultRenderer.renderResult(params, result);
}

export { registerToolRenderer, getToolRenderer };
export { browserJavaScriptTool } from "./browser-javascript.js";
export { createJavaScriptReplTool, javascriptReplTool } from "./javascript-repl.js";
