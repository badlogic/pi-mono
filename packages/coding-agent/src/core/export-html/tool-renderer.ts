/**
 * Tool HTML renderer for custom tools in HTML export.
 *
 * Renders custom tool calls and results to HTML by invoking their TUI renderers
 * and converting the ANSI output to HTML.
 */

import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { ToolDefinition } from "../extensions/types.js";
import { ansiLinesToHtml } from "./ansi-to-html.js";

export interface ToolHtmlRendererDeps {
	/** Function to look up tool definition by name */
	getToolDefinition: (name: string) => ToolDefinition | undefined;
	/** Theme for styling */
	theme: Theme;
	/** Terminal width for rendering (default: 100) */
	width?: number;
}

export interface ToolHtmlRenderer {
	/** Render a tool call to HTML. Returns undefined if tool has no custom renderer. */
	renderCall(toolName: string, args: unknown): string | undefined;
	/** Render a tool result to collapsed/expanded HTML. Returns undefined if tool has no custom renderer. */
	renderResult(
		toolName: string,
		result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
		details: unknown,
		isError: boolean,
	): { collapsed?: string; expanded?: string } | undefined;
}

/**
 * Create a tool HTML renderer.
 *
 * The renderer looks up tool definitions and invokes their renderCall/renderResult
 * methods, converting the resulting TUI Component output (ANSI) to HTML.
 */
export function createToolHtmlRenderer(deps: ToolHtmlRendererDeps): ToolHtmlRenderer {
	const { getToolDefinition, theme, width = 100 } = deps;

	return {
		renderCall(toolName: string, args: unknown): string | undefined {
			try {
				const toolDef = getToolDefinition(toolName);
				if (!toolDef?.renderCall) {
					return undefined;
				}

				const component = toolDef.renderCall(args, theme);
				if (!component) {
					return undefined;
				}
				const lines = component.render(width);
				return ansiLinesToHtml(lines);
			} catch {
				// On error, return undefined to trigger JSON fallback
				return undefined;
			}
		},

		renderResult(
			toolName: string,
			result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
			details: unknown,
			isError: boolean,
		): { collapsed?: string; expanded?: string } | undefined {
			try {
				const toolDef = getToolDefinition(toolName);
				if (!toolDef?.renderResult) {
					return undefined;
				}

				// Build AgentToolResult from content array
				// Cast content since session storage uses generic object types
				const agentToolResult = {
					content: result as (TextContent | ImageContent)[],
					details,
					isError,
				};

				// Render collapsed
				const collapsedComponent = toolDef.renderResult(
					agentToolResult,
					{ expanded: false, isPartial: false },
					theme,
				);
				const collapsed = collapsedComponent ? ansiLinesToHtml(collapsedComponent.render(width)) : undefined;

				// Render expanded
				const expandedComponent = toolDef.renderResult(
					agentToolResult,
					{ expanded: true, isPartial: false },
					theme,
				);
				const expanded = expandedComponent ? ansiLinesToHtml(expandedComponent.render(width)) : undefined;

				// Return collapsed only if it exists and differs from expanded
				if (!expanded) {
					return undefined;
				}

				return {
					...(collapsed && collapsed !== expanded ? { collapsed } : {}),
					expanded,
				};
			} catch {
				// On error, return undefined to trigger JSON fallback
				return undefined;
			}
		},
	};
}
