import type { MessageRenderer } from "@mariozechner/pi-web-ui";
import { registerMessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

// ============================================================================
// NAVIGATION MESSAGE TYPE
// ============================================================================

export interface NavigationMessage {
	role: "navigation";
	url: string;
	title: string;
	favicon?: string;
	tabIndex?: number;
}

// Extend CustomMessages interface via declaration merging
declare module "@mariozechner/pi-web-ui" {
	interface CustomMessages {
		navigation: NavigationMessage;
	}
}

// ============================================================================
// RENDERER
// ============================================================================

const navigationRenderer: MessageRenderer<NavigationMessage> = {
	render: (nav) => {
		return html`
			<div class="mx-4">
				<button
					class="inline-flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground bg-secondary border border-border rounded-lg hover:bg-secondary/80 transition-colors max-w-full cursor-pointer"
					@click=${() => {
						chrome.tabs.create({ url: nav.url });
					}}
					title="Click to open: ${nav.url}"
				>
					${
						nav.favicon
							? html`<img src="${nav.favicon}" alt="" class="w-4 h-4 flex-shrink-0" />`
							: html`<div class="w-4 h-4 flex-shrink-0 bg-muted rounded"></div>`
					}
					<span class="truncate">${nav.title}</span>
				</button>
			</div>
		`;
	},
};

// ============================================================================
// REGISTER
// ============================================================================

export function registerNavigationRenderer() {
	registerMessageRenderer("navigation", navigationRenderer);
}

// ============================================================================
// HELPER
// ============================================================================

export function createNavigationMessage(
	url: string,
	title: string,
	favicon?: string,
	tabIndex?: number,
): NavigationMessage {
	return {
		role: "navigation",
		url,
		title,
		favicon,
		tabIndex,
	};
}
