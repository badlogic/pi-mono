import { Button, icon } from "@mariozechner/mini-lit";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { html, LitElement, render } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RefreshCw, Settings } from "lucide";
import "./ChatPanel.js";
import { ApiKeysDialog } from "./dialogs/ApiKeysDialog.js";
import "./utils/live-reload.js";
import { SandboxIframe } from "./components/SandboxedIframe.js";
import "./components/SandboxedIframe.js";

async function getDom() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab || !tab.id) return;

	const results = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => document.body.innerText,
	});
}

@customElement("sandbox-test")
export class SandboxTest extends LitElement {
	@state() private result = "";
	@state() private testing = false;

	createRenderRoot() {
		return this;
	}

	private async testREPL() {
		this.testing = true;
		this.result = "Testing REPL...";

		const sandbox = new SandboxIframe();
		sandbox.style.display = "none";
		this.appendChild(sandbox);

		try {
			const result = await sandbox.execute(
				"test-repl",
				`
				console.log("Hello from REPL!");
				console.log("Testing math:", 2 + 2);
				await returnFile("test.txt", "Hello World", "text/plain");
			`,
				[],
			);

			this.result = `✓ REPL Test Success!\n\nConsole:\n${result.console.map((l: { type: string; text: string }) => `[${l.type}] ${l.text}`).join("\n")}\n\nFiles: ${result.files?.length || 0}`;
		} catch (error: any) {
			this.result = `✗ REPL Test Failed: ${error.message}`;
		} finally {
			sandbox.remove();
			this.testing = false;
		}
	}

	private async testHTML() {
		this.testing = true;
		this.result = "Testing HTML Artifact...";

		const sandbox = new SandboxIframe();
		sandbox.style.display = "none";
		this.appendChild(sandbox);

		try {
			const result = await sandbox.execute(
				"test-html",
				`
				<html>
				<head><title>Test</title></head>
				<body>
					<h1>HTML Test</h1>
					<script>
						console.log("Hello from HTML!");
						console.log("DOM ready:", !!document.body);
					</script>
				</body>
				</html>
			`,
				[],
			);

			this.result = `✓ HTML Test Success!\n\nConsole:\n${result.console.map((l: { type: string; text: string }) => `[${l.type}] ${l.text}`).join("\n")}`;
		} catch (error: any) {
			this.result = `✗ HTML Test Failed: ${error.message}`;
		} finally {
			sandbox.remove();
			this.testing = false;
		}
	}

	private async testREPLError() {
		this.testing = true;
		this.result = "Testing REPL Error...";

		const sandbox = new SandboxIframe();
		sandbox.style.display = "none";
		this.appendChild(sandbox);

		try {
			const result = await sandbox.execute(
				"test-repl-error",
				`
				console.log("About to throw error...");
				throw new Error("Test error!");
			`,
				[],
			);

			if (result.success) {
				this.result = `✗ Test Failed: Should have reported error`;
			} else {
				this.result = `✓ REPL Error Test Success!\n\nError: ${result.error?.message}\n\nStack:\n${result.error?.stack || "(no stack)"}\n\nConsole:\n${result.console.map((l: { type: string; text: string }) => `[${l.type}] ${l.text}`).join("\n")}`;
			}
		} catch (error: any) {
			this.result = `✗ Test execution failed: ${error.message}`;
		} finally {
			sandbox.remove();
			this.testing = false;
		}
	}

	private async testHTMLError() {
		this.testing = true;
		this.result = "Testing HTML Error...";

		const sandbox = new SandboxIframe();
		sandbox.style.display = "none";
		this.appendChild(sandbox);

		try {
			const result = await sandbox.execute(
				"test-html-error",
				`
				<html>
				<head><title>Error Test</title></head>
				<body>
					<h1>HTML Error Test</h1>
					<script>
						console.log("About to throw error in HTML...");
						throw new Error("HTML test error!");
					</script>
				</body>
				</html>
			`,
				[],
			);

			// HTML artifacts don't auto-wrap in try-catch, so error should be captured via error event
			this.result = `✓ HTML Error Test Complete!\n\nSuccess: ${result.success}\n\nConsole:\n${result.console.map((l: { type: string; text: string }) => `[${l.type}] ${l.text}`).join("\n")}`;
		} catch (error: any) {
			this.result = `✗ Test execution failed: ${error.message}`;
		} finally {
			sandbox.remove();
			this.testing = false;
		}
	}

	render() {
		return html`
			<div class="p-4 space-y-2">
				<h3 class="font-bold">Sandbox Test</h3>
				<div class="flex flex-wrap gap-2">
					${Button({
						variant: "outline",
						size: "sm",
						children: html`Test REPL`,
						disabled: this.testing,
						onClick: () => this.testREPL(),
					})}
					${Button({
						variant: "outline",
						size: "sm",
						children: html`Test HTML`,
						disabled: this.testing,
						onClick: () => this.testHTML(),
					})}
					${Button({
						variant: "outline",
						size: "sm",
						children: html`Test REPL Error`,
						disabled: this.testing,
						onClick: () => this.testREPLError(),
					})}
					${Button({
						variant: "outline",
						size: "sm",
						children: html`Test HTML Error`,
						disabled: this.testing,
						onClick: () => this.testHTMLError(),
					})}
				</div>
				${this.result ? html`<pre class="text-xs bg-muted p-2 rounded whitespace-pre-wrap">${this.result}</pre>` : ""}
			</div>
		`;
	}
}

@customElement("pi-chat-header")
export class Header extends LitElement {
	createRenderRoot() {
		return this;
	}

	render() {
		return html`
		<div class="flex items-center justify-between border-b border-border">
			<div class="px-3 py-2">
				<span class="text-sm font-semibold text-foreground">pi-ai</span>
			</div>
			<div class="flex items-center gap-1 px-2">
				${Button({
					variant: "ghost",
					size: "sm",
					children: html`${icon(RefreshCw, "sm")}`,
					onClick: () => {
						window.location.reload();
					},
					title: "Reload",
				})}
				<theme-toggle></theme-toggle>
				${Button({
					variant: "ghost",
					size: "sm",
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
	<!--<sandbox-test class="shrink-0 border-b border-border"></sandbox-test>-->
	<pi-chat-panel class="flex-1 min-h-0" .systemPrompt=${systemPrompt}></pi-chat-panel>
</div>
`;

render(app, document.body);
