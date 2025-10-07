import type { TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { getToolRenderer, registerToolRenderer } from "./renderer-registry.js";
import { BashRenderer } from "./renderers/BashRenderer.js";
import { DefaultRenderer } from "./renderers/DefaultRenderer.js";
import "./javascript-repl.js"; // Auto-registers the renderer

// Register all built-in tool renderers
registerToolRenderer("bash", new BashRenderer());

const defaultRenderer = new DefaultRenderer();

/**
 * Render tool - unified function that handles params, result, and streaming state
 */
export function renderTool(
	toolName: string,
	params: any | undefined,
	result: ToolResultMessage | undefined,
	isStreaming?: boolean,
): TemplateResult {
	const renderer = getToolRenderer(toolName);
	if (renderer) {
		return renderer.render(params, result, isStreaming);
	}
	return defaultRenderer.render(params, result, isStreaming);
}

export { registerToolRenderer, getToolRenderer };
