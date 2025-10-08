import { html, icon, iconDOM, type TemplateResult } from "@mariozechner/mini-lit";
import type { Ref } from "lit/directives/ref.js";
import { ref } from "lit/directives/ref.js";
import { ChevronDown, ChevronRight, Loader } from "lucide";
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

/**
 * Helper to render a collapsible header for tool renderers
 * Same as renderHeader but with a chevron button that toggles visibility of content
 */
export function renderCollapsibleHeader(
	state: "inprogress" | "complete" | "error",
	toolIcon: any,
	text: string,
	contentRef: Ref<HTMLElement>,
	chevronRef: Ref<HTMLElement>,
	defaultExpanded = false,
): TemplateResult {
	const statusIcon = (iconComponent: any, color: string) =>
		html`<span class="inline-block ${color}">${icon(iconComponent, "sm")}</span>`;

	const toggleContent = (e: Event) => {
		e.preventDefault();
		const content = contentRef.value;
		const chevron = chevronRef.value;
		if (content && chevron) {
			const isCollapsed = content.classList.contains("max-h-0");
			if (isCollapsed) {
				content.classList.remove("max-h-0");
				content.classList.add("max-h-[2000px]", "mt-3");
				chevron.innerHTML = iconDOM(ChevronDown, "sm").outerHTML;
			} else {
				content.classList.remove("max-h-[2000px]", "mt-3");
				content.classList.add("max-h-0");
				chevron.innerHTML = iconDOM(ChevronRight, "sm").outerHTML;
			}
		}
	};

	const toolIconColor =
		state === "complete"
			? "text-green-600 dark:text-green-500"
			: state === "error"
				? "text-destructive"
				: "text-foreground";

	return html`
		<button @click=${toggleContent} class="flex items-center justify-between gap-2 text-sm text-muted-foreground w-full text-left hover:text-foreground transition-colors">
			<div class="flex items-center gap-2">
				${state === "inprogress" ? statusIcon(Loader, "text-foreground animate-spin") : ""}
				${statusIcon(toolIcon, toolIconColor)}
				<span>${text}</span>
			</div>
			<span class="inline-block text-muted-foreground" ${ref(chevronRef)}>
				${icon(defaultExpanded ? ChevronDown : ChevronRight, "sm")}
			</span>
		</button>
	`;
}
