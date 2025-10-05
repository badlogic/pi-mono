import type { ToolRenderer } from "./types.js";

// Registry of tool renderers
export const toolRenderers = new Map<string, ToolRenderer>();

/**
 * Register a custom tool renderer
 */
export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
	toolRenderers.set(toolName, renderer);
}

/**
 * Get a tool renderer by name
 */
export function getToolRenderer(toolName: string): ToolRenderer | undefined {
	return toolRenderers.get(toolName);
}
