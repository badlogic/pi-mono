import { html, LitElement, render } from "lit";
import "./ChatPanel.js";
import "./live-reload.js";
import { customElement } from "lit/decorators.js";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { Button, icon } from "@mariozechner/mini-lit";
import { Settings } from "lucide";
import { ApiKeysDialog } from "./dialogs/ApiKeysDialog.js";

async function getDom() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab || !tab.id) return;

	const results = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => document.body.innerText,
	});
}

@customElement("pi-chat-header")
export class Header extends LitElement {
	createRenderRoot() {
		return this;
	}

	async connectedCallback() {
		super.connectedCallback();
		const resp = await fetch("https://genai.mariozechner.at/api/health");
		console.log(await resp.json());
	}

	render() {
		return html`
		<div class="flex items-center px-4 py-2 border-b border-border mb-4">
			<span class="text-muted-foreground">pi-ai</span>
			<theme-toggle class="ml-auto"></theme-toggle>
			${Button({
				variant: "ghost",
				size: "icon",
				children: html`${icon(Settings, "sm")}`,
				onClick: async () => {
					ApiKeysDialog.open();
				},
			})}
		</div>
		`;
	}
}

const app = html`
<div class="w-full h-full flex flex-col bg-background text-foreground">
	<pi-chat-header></pi-chat-header>
	<pi-chat-panel></pi-chat-panel>
</div>
`;

render(app, document.body);
