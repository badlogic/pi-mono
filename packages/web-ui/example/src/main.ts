import { Button, icon } from "@mariozechner/mini-lit";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { ChatPanel, ApiKeysDialog } from "@mariozechner/pi-web-ui";
import { html, render } from "lit";
import { Settings } from "lucide";
import "./app.css";

const systemPrompt = `You are a helpful AI assistant with access to various tools.

Available tools:
- JavaScript REPL: Execute JavaScript code in a sandboxed browser environment (can do calculations, get time, process data, create visualizations, etc.)
- Artifacts: Create interactive HTML, SVG, Markdown, and text artifacts

Feel free to use these tools when needed to provide accurate and helpful responses.`;

// Create and configure the chat panel
const chatPanel = new ChatPanel();
chatPanel.systemPrompt = systemPrompt;
chatPanel.additionalTools = [];

// Render the app structure
const appHtml = html`
	<div class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-border shrink-0">
			<div class="px-4 py-3">
				<span class="text-base font-semibold text-foreground">Pi Web UI Example</span>
			</div>
			<div class="flex items-center gap-1 px-2">
				<theme-toggle></theme-toggle>
				${Button({
					variant: "ghost",
					size: "sm",
					children: icon(Settings, "sm"),
					onClick: () => ApiKeysDialog.open(),
					title: "API Keys Settings",
				})}
			</div>
		</div>

		<!-- Chat Panel -->
		${chatPanel}
	</div>
`;

const app = document.getElementById("app");
if (!app) {
	throw new Error("App container not found");
}

render(appHtml, app);