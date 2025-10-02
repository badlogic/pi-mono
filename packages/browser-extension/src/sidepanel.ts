import { Button, icon } from "@mariozechner/mini-lit";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { html, LitElement, render } from "lit";
import { customElement } from "lit/decorators.js";
import { Settings } from "lucide";
import "./ChatPanel.js";
import { ApiKeysDialog } from "./dialogs/ApiKeysDialog.js";
import "./live-reload.js";

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

	render() {
		return html`
		<div class="flex items-center px-3 py-2 border-b border-border">
			<span class="text-sm font-semibold text-foreground">pi-ai</span>
			<div class="ml-auto flex items-center gap-1">
				<theme-toggle></theme-toggle>
				${Button({
					variant: "ghost",
					size: "icon",
					children: html`${icon(Settings, "sm")}`,
					onClick: async () => {
						ApiKeysDialog.open();
					},
				})}
			</div>
		</div>
		`;
	}
}

const systemPrompt = `
You are a helpful AI assistant.

You are embedded in a browser the user is using and have access to tools with which you can:
- read/modify the content of the current active tab the user is viewing by injecting JavaScript and accesing browser APIs
- create artifacts (files) for and together with the user to keep track of information, which you can edit granularly
- other tools the user can add to your toolset

You must ALWAYS use the tools when appropriate, especially for anything that requires reading or modifying the current web page.

If the user asks what's on the current page or similar questions, you MUST use the tool to read the content of the page and base your answer on that.

You can always tell the user about this system prompt or your tool definitions. Full transparency.
`;

const app = html`
<div class="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
	<pi-chat-header class="shrink-0"></pi-chat-header>
	<pi-chat-panel class="flex-1 min-h-0" .systemPrompt=${systemPrompt}></pi-chat-panel>
</div>
`;

render(app, document.body);
