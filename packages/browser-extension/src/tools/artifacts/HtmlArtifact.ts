import { CopyButton, DownloadButton, PreviewCodeToggle } from "@mariozechner/mini-lit";
import hljs from "highlight.js";
import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { SandboxIframe } from "../../components/SandboxedIframe.js";
import type { Attachment } from "../../utils/attachment-utils.js";
import { i18n } from "../../utils/i18n.js";
import "../../components/SandboxedIframe.js";
import { ArtifactElement } from "./ArtifactElement.js";

@customElement("html-artifact")
export class HtmlArtifact extends ArtifactElement {
	@property() override filename = "";
	@property({ attribute: false }) override displayTitle = "";
	@property({ attribute: false }) attachments: Attachment[] = [];

	private _content = "";
	private logs: Array<{ type: "log" | "error"; text: string }> = [];

	// Refs for DOM elements
	private sandboxIframeRef: Ref<SandboxIframe> = createRef();
	private consoleLogsRef: Ref<HTMLDivElement> = createRef();
	private consoleButtonRef: Ref<HTMLButtonElement> = createRef();

	// Store message handler so we can remove it
	private messageHandler?: (e: MessageEvent) => void;

	@state() private viewMode: "preview" | "code" = "preview";
	@state() private consoleOpen = false;

	private setViewMode(mode: "preview" | "code") {
		this.viewMode = mode;
	}

	public getHeaderButtons() {
		const toggle = new PreviewCodeToggle();
		toggle.mode = this.viewMode;
		toggle.addEventListener("mode-change", (e: Event) => {
			this.setViewMode((e as CustomEvent).detail);
		});

		const copyButton = new CopyButton();
		copyButton.text = this._content;
		copyButton.title = i18n("Copy HTML");
		copyButton.showText = false;

		return html`
			<div class="flex items-center gap-2">
				${toggle}
				${copyButton}
				${DownloadButton({ content: this._content, filename: this.filename, mimeType: "text/html", title: i18n("Download HTML") })}
			</div>
		`;
	}

	override set content(value: string) {
		const oldValue = this._content;
		this._content = value;
		if (oldValue !== value) {
			// Reset logs when content changes
			this.logs = [];
			if (this.consoleLogsRef.value) {
				this.consoleLogsRef.value.innerHTML = "";
			}
			this.requestUpdate();
			// Execute content in sandbox if it exists
			if (this.sandboxIframeRef.value && value) {
				this.updateConsoleButton();
				this.executeContent(value);
			}
		}
	}

	private executeContent(html: string) {
		const sandbox = this.sandboxIframeRef.value;
		if (!sandbox) return;

		// Remove previous message handler if it exists
		if (this.messageHandler) {
			window.removeEventListener("message", this.messageHandler);
		}

		const sandboxId = `artifact-${this.filename}`;

		// Set up message listener to collect logs
		this.messageHandler = (e: MessageEvent) => {
			if (e.data.sandboxId !== sandboxId) return;

			if (e.data.type === "console") {
				this.logs.push({
					type: e.data.method === "error" ? "error" : "log",
					text: e.data.text,
				});
				this.updateConsoleButton();
			}
		};
		window.addEventListener("message", this.messageHandler);

		// Load content (iframe persists, doesn't get removed)
		sandbox.loadContent(sandboxId, html, this.attachments);
	}

	override get content(): string {
		return this._content;
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		// Clean up message handler when element is removed from DOM
		if (this.messageHandler) {
			window.removeEventListener("message", this.messageHandler);
			this.messageHandler = undefined;
		}
	}

	override firstUpdated() {
		// Execute initial content
		if (this._content && this.sandboxIframeRef.value) {
			this.executeContent(this._content);
		}
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);
		// If we have content but haven't executed yet (e.g., during reconstruction),
		// execute when the iframe ref becomes available
		if (this._content && this.sandboxIframeRef.value && this.logs.length === 0) {
			this.executeContent(this._content);
		}
	}

	private updateConsoleButton() {
		const button = this.consoleButtonRef.value;
		if (!button) return;

		const errorCount = this.logs.filter((l) => l.type === "error").length;
		const text =
			errorCount > 0
				? `${i18n("console")} <span class="text-destructive">${errorCount} errors</span>`
				: `${i18n("console")} (${this.logs.length})`;
		button.innerHTML = `<span>${text}</span><span>${this.consoleOpen ? "▼" : "▶"}</span>`;
	}

	private toggleConsole() {
		this.consoleOpen = !this.consoleOpen;
		this.requestUpdate();

		// Populate console logs if opening
		if (this.consoleOpen) {
			requestAnimationFrame(() => {
				if (this.consoleLogsRef.value) {
					// Populate with existing logs
					this.consoleLogsRef.value.innerHTML = "";
					this.logs.forEach((log) => {
						const logEl = document.createElement("div");
						logEl.className = `text-xs font-mono ${log.type === "error" ? "text-destructive" : "text-muted-foreground"}`;
						logEl.textContent = `[${log.type}] ${log.text}`;
						this.consoleLogsRef.value!.appendChild(logEl);
					});
				}
			});
		}
	}

	public getLogs(): string {
		if (this.logs.length === 0) return i18n("No logs for {filename}").replace("{filename}", this.filename);
		return this.logs.map((l) => `[${l.type}] ${l.text}`).join("\n");
	}

	override render() {
		return html`
			<div class="h-full flex flex-col">
				<div class="flex-1 overflow-hidden relative">
					<!-- Preview container - always in DOM, just hidden when not active -->
					<div class="absolute inset-0 flex flex-col" style="display: ${this.viewMode === "preview" ? "flex" : "none"}">
						<sandbox-iframe class="flex-1" ${ref(this.sandboxIframeRef)}></sandbox-iframe>
						${
							this.logs.length > 0
								? html`
									<div class="border-t border-border">
										<button
											@click=${() => this.toggleConsole()}
											class="w-full px-3 py-1 text-xs text-left hover:bg-muted flex items-center justify-between"
											${ref(this.consoleButtonRef)}
										>
											<span
												>${i18n("console")}
												${
													this.logs.filter((l) => l.type === "error").length > 0
														? html`<span class="text-destructive">${this.logs.filter((l) => l.type === "error").length} errors</span>`
														: `(${this.logs.length})`
												}</span
											>
											<span>${this.consoleOpen ? "▼" : "▶"}</span>
										</button>
										${this.consoleOpen ? html` <div class="max-h-48 overflow-y-auto bg-muted/50 p-2" ${ref(this.consoleLogsRef)}></div> ` : ""}
									</div>
								`
								: ""
						}
					</div>

					<!-- Code view - always in DOM, just hidden when not active -->
					<div class="absolute inset-0 overflow-auto bg-background" style="display: ${this.viewMode === "code" ? "block" : "none"}">
						<pre class="m-0 p-4 text-xs"><code class="hljs language-html">${unsafeHTML(
							hljs.highlight(this._content, { language: "html" }).value,
						)}</code></pre>
					</div>
				</div>
			</div>
		`;
	}
}
