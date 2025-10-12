import type { ToolResultMessage } from "@mariozechner/pi-ai";
import "./javascript-repl.js"; // Auto-registers the renderer
import "./extract-document.js"; // Auto-registers the renderer
import { getToolRenderer, registerToolRenderer } from "./renderer-registry.js";
import { BashRenderer } from "./renderers/BashRenderer.js";
import { DefaultRenderer } from "./renderers/DefaultRenderer.js";
import type { ToolRenderResult } from "./types.js";

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
): ToolRenderResult {
	const renderer = getToolRenderer(toolName);
	if (renderer) {
		return renderer.render(params, result, isStreaming);
	}
	return defaultRenderer.render(params, result, isStreaming);
}

export { getToolRenderer, registerToolRenderer };
