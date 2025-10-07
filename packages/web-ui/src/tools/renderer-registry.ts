import { html, icon, type TemplateResult } from "@mariozechner/mini-lit";
import { Loader } from "lucide";
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

/**
 * Helper to render a header for tool renderers
 * Shows icon on left when complete/error, spinner on right when in progress
 */
export function renderHeader(state: "inprogress" | "complete" | "error", toolIcon: any, text: string): TemplateResult {
	const statusIcon = (iconComponent: any, color: string) =>
		html`<span class="inline-block ${color}">${icon(iconComponent, "sm")}</span>`;

	switch (state) {
		case "inprogress":
			return html`
				<div class="flex items-center justify-between gap-2 text-sm text-muted-foreground">
					<div class="flex items-center gap-2">
						${statusIcon(toolIcon, "text-foreground")}
						<span>${text}</span>
					</div>
					${statusIcon(Loader, "text-foreground animate-spin")}
				</div>
			`;
		case "complete":
			return html`
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					${statusIcon(toolIcon, "text-green-600 dark:text-green-500")}
					<span>${text}</span>
				</div>
			`;
		case "error":
			return html`
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					${statusIcon(toolIcon, "text-destructive")}
					<span>${text}</span>
				</div>
			`;
	}
}
