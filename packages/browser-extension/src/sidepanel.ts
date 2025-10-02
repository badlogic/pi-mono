import { Button, icon } from "@mariozechner/mini-lit";
import { html, LitElement, render } from "lit";
import { customElement, state } from "lit/decorators.js";
import { FileCode2, Settings } from "lucide";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import "./ChatPanel.js";
import "./live-reload.js";
import "./components/SandboxedIframe.js";
import type { ChatPanel } from "./ChatPanel.js";
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
	@state() private chatPanel: ChatPanel | null = null;
	@state() private hasArtifacts = false;
	@state() private artifactsPanelVisible = false;
	@state() private windowWidth = window.innerWidth;

	private resizeHandler = () => {
		this.windowWidth = window.innerWidth;
	};

	createRenderRoot() {
		return this;
	}

	connectedCallback() {
		super.connectedCallback();
		window.addEventListener("resize", this.resizeHandler);

		// Find chat panel and listen for updates
		requestAnimationFrame(() => {
			this.chatPanel = document.querySelector("pi-chat-panel");
			if (this.chatPanel) {
				// Poll for artifacts state (simple approach)
				setInterval(() => {
					if (this.chatPanel) {
						this.hasArtifacts = (this.chatPanel as any).hasArtifacts || false;
						this.artifactsPanelVisible = this.chatPanel.artifactsPanelVisible;
					}
				}, 500);
			}
		});
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener("resize", this.resizeHandler);
	}

	private toggleArtifacts() {
		if (this.chatPanel) {
			this.chatPanel.toggleArtifactsPanel();
		}
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

// Test HTML content to inject into sandbox
const testHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chart.js with Button</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            display: flex;
            flex-direction: column;
            align-items: center;
            font-family: Arial, sans-serif;
            padding: 20px;
        }
        #myChart {
            width: 400px;
            height: 300px;
            margin-bottom: 20px;
        }
        #alertButton {
            padding: 10px 20px;
            font-size: 16px;
        }
    </style>
</head>
<body>
    <canvas id="myChart"></canvas>
    <button id="alertButton">Click Me!</button>

    <script>
        // Create a chart
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
                datasets: [{
                    label: '# of Votes',
                    data: [12, 19, 3, 5, 2, 3],
                    backgroundColor: [
                        'rgba(255, 99, 132, 0.2)',
                        'rgba(54, 162, 235, 0.2)',
                        'rgba(255, 206, 86, 0.2)',
                        'rgba(75, 192, 192, 0.2)',
                        'rgba(153, 102, 255, 0.2)',
                        'rgba(255, 159, 64, 0.2)'
                    ],
                    borderColor: [
                        'rgba(255, 99, 132, 1)',
                        'rgba(54, 162, 235, 1)',
                        'rgba(255, 206, 86, 1)',
                        'rgba(75, 192, 192, 1)',
                        'rgba(153, 102, 255, 1)',
                        'rgba(255, 159, 64, 1)'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });

        // Add event listener to the button
        document.getElementById('alertButton').addEventListener('click', function() {
            alert('Button clicked! 🎉');
        });
    </script>
</body>
</html>`;

const app = html`
<div class="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
	<pi-chat-header class="shrink-0"></pi-chat-header>
	<pi-chat-panel class="flex-1 min-h-0" .systemPrompt=${systemPrompt}></pi-chat-panel>
	<sandbox-iframe
		.content=${testHtml}
		style="position: fixed; bottom: 0; right: 0; width: 400px; height: 400px; border: 2px solid red; z-index: 9999;">
	</sandbox-iframe>
</div>
`;

render(app, document.body);
