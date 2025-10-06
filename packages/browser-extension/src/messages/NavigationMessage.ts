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

function getFallbackFavicon(url: string): string {
	try {
		const urlObj = new URL(url);
		// Use Google's favicon service which works for most domains
		return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
	} catch {
		// If URL parsing fails, return a generic icon
		return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23999' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'/%3E%3C/svg%3E";
	}
}

const navigationRenderer: MessageRenderer<NavigationMessage> = {
	render: (nav) => {
		// Use favicon from tab, or fallback to Google's favicon service
		const faviconUrl = nav.favicon || getFallbackFavicon(nav.url);

		return html`
			<div class="mx-4 my-2">
				<button
					class="inline-flex items-center gap-2 px-3 py-2 text-sm text-foreground bg-accent/50 border-2 border-accent rounded-lg hover:bg-accent transition-colors max-w-full cursor-pointer shadow-sm"
					@click=${() => {
						chrome.tabs.create({ url: nav.url });
					}}
					title="Click to open: ${nav.url}"
				>
					<img
						src="${faviconUrl}"
						alt=""
						class="w-4 h-4 flex-shrink-0"
						@error=${(e: Event) => {
							// If favicon fails to load, hide the image
							const target = e.target as HTMLImageElement;
							target.style.display = "none";
						}}
					/>
					<span class="truncate font-medium">${nav.title}</span>
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
