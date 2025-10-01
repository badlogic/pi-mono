import { CopyButton, DownloadButton, PreviewCodeToggle } from "@mariozechner/mini-lit";
import hljs from "highlight.js";
import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { Attachment } from "../../utils/attachment-utils.js";
import { i18n } from "../../utils/i18n.js";
import { ArtifactElement } from "./ArtifactElement.js";

@customElement("html-artifact")
export class HtmlArtifact extends ArtifactElement {
	@property() override filename = "";
	@property({ attribute: false }) override displayTitle = "";
	@property({ attribute: false }) attachments: Attachment[] = [];

	private _content = "";
	private iframe?: HTMLIFrameElement;
	private logs: Array<{ type: "log" | "error"; text: string }> = [];

	// Refs for DOM elements
	private iframeContainerRef: Ref<HTMLDivElement> = createRef();
	private consoleLogsRef: Ref<HTMLDivElement> = createRef();
	private consoleButtonRef: Ref<HTMLButtonElement> = createRef();

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
			// Delay to ensure component is rendered
			requestAnimationFrame(async () => {
				this.requestUpdate();
				await this.updateComplete;
				this.updateIframe();
				// Ensure iframe gets attached
				requestAnimationFrame(() => {
					this.attachIframeToContainer();
				});
			});
		}
	}

	override get content(): string {
		return this._content;
	}

	override connectedCallback() {
		super.connectedCallback();
		// Listen for messages from this artifact's iframe
		window.addEventListener("message", this.handleMessage);
	}

	protected override firstUpdated() {
		// Create iframe if we have content after first render
		if (this._content) {
			this.updateIframe();
			// Ensure iframe is attached after render completes
			requestAnimationFrame(() => {
				this.attachIframeToContainer();
			});
		}
	}

	protected override updated() {
		// Always try to attach iframe if it exists but isn't in DOM
		if (this.iframe && !this.iframe.parentElement) {
			this.attachIframeToContainer();
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener("message", this.handleMessage);
		this.iframe?.remove();
	}

	private handleMessage = (e: MessageEvent) => {
		// Only handle messages for this artifact
		if (e.data.artifactId !== this.filename) return;

		if (e.data.type === "console") {
			this.addLog({
				type: e.data.method === "error" ? "error" : "log",
				text: e.data.text,
			});
		} else if (e.data.type === "execution-complete") {
			// Store final logs
			this.logs = e.data.logs || [];
			this.updateConsoleButton();

			// Force reflow when iframe content is ready
			// This fixes the 0x0 size issue on initial load
			if (this.iframe) {
				this.iframe.style.display = "none";
				this.iframe.offsetHeight; // Force reflow
				this.iframe.style.display = "";
			}
		}
	};

	private addLog(log: { type: "log" | "error"; text: string }) {
		this.logs.push(log);

		// Update console button text
		this.updateConsoleButton();

		// If console is open, append to DOM directly
		if (this.consoleOpen && this.consoleLogsRef.value) {
			const logEl = document.createElement("div");
			logEl.className = `text-xs font-mono ${log.type === "error" ? "text-destructive" : "text-muted-foreground"}`;
			logEl.textContent = `[${log.type}] ${log.text}`;
			this.consoleLogsRef.value.appendChild(logEl);
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

	private updateIframe() {
		if (!this.iframe) {
			this.createIframe();
		}

		if (this.iframe) {
			// Clear logs for new content
			this.logs = [];
			if (this.consoleLogsRef.value) {
				this.consoleLogsRef.value.innerHTML = "";
			}
			this.updateConsoleButton();

			// Inject console capture script at the beginning
			const consoleSetupScript = `
				<script>
				(function() {
					window.__artifactLogs = [];
					const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };

					['log', 'error', 'warn', 'info'].forEach(method => {
						console[method] = function(...args) {
							const text = args.map(arg => {
								try { return typeof arg === 'object' ? JSON.stringify(arg) : String(arg); }
								catch { return String(arg); }
							}).join(' ');
							window.__artifactLogs.push({ type: method === 'error' ? 'error' : 'log', text });
							window.parent.postMessage({
								type: 'console',
								method,
								text,
								artifactId: '${this.filename}'
							}, '*');
							originalConsole[method].apply(console, args);
						};
					});

					window.addEventListener('error', (e) => {
						const text = e.message + ' at line ' + e.lineno + ':' + e.colno;
						window.__artifactLogs.push({ type: 'error', text });
						window.parent.postMessage({
							type: 'console',
							method: 'error',
							text,
							artifactId: '${this.filename}'
						}, '*');
					});

					// Capture unhandled promise rejections
					window.addEventListener('unhandledrejection', (e) => {
						const text = 'Unhandled promise rejection: ' + (e.reason?.message || e.reason || 'Unknown error');
						window.__artifactLogs.push({ type: 'error', text });
						window.parent.postMessage({
							type: 'console',
							method: 'error',
							text,
							artifactId: '${this.filename}'
						}, '*');
					});

					// Note: Network errors (404s) for ES module imports cannot be caught
					// due to browser security restrictions. These will only appear in the
					// parent window's console, not in the artifact's logs.

					// Attachment helpers
					window.attachments = ${JSON.stringify(this.attachments)};
					window.listFiles = function() {
						return (window.attachments || []).map(a => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, size: a.size }));
					};
					window.readTextFile = function(attachmentId) {
						const a = (window.attachments || []).find(x => x.id === attachmentId);
						if (!a) throw new Error('Attachment not found: ' + attachmentId);
						if (a.extractedText) return a.extractedText;
						try { return atob(a.content); } catch { throw new Error('Failed to decode text content for: ' + attachmentId); }
					};
					window.readBinaryFile = function(attachmentId) {
						const a = (window.attachments || []).find(x => x.id === attachmentId);
						if (!a) throw new Error('Attachment not found: ' + attachmentId);
						const bin = atob(a.content);
						const bytes = new Uint8Array(bin.length);
						for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
						return bytes;
					};
				})();
				</script>
			`;

			// Script to send completion message after page loads
			const completionScript = `
				<script>
				(function() {
					const sendCompletion = function() {
						window.parent.postMessage({
							type: 'execution-complete',
							logs: window.__artifactLogs || [],
							artifactId: '${this.filename}'
						}, '*');
					};

					// Send completion when DOM is ready and all scripts have executed
					if (document.readyState === 'complete' || document.readyState === 'interactive') {
						// DOM is already ready, wait for next tick to ensure all scripts have run
						setTimeout(sendCompletion, 0);
					} else {
						window.addEventListener('DOMContentLoaded', function() {
							// Wait for next tick after DOMContentLoaded to ensure user scripts have run
							setTimeout(sendCompletion, 0);
						});
					}
				})();
				</script>
			`;

			// Add console setup to head and completion script to end of body
			let enhancedContent = this._content;

			// Ensure iframe content has proper dimensions
			const dimensionFix = `
				<style>
				/* Ensure html and body fill the iframe */
				html { height: 100%; }
				body { min-height: 100%; margin: 0; }
				</style>
			`;

			// Add dimension fix and console setup to head (or beginning if no head)
			if (enhancedContent.match(/<head[^>]*>/i)) {
				enhancedContent = enhancedContent.replace(
					/<head[^>]*>/i,
					(m) => `${m}${dimensionFix}${consoleSetupScript}`,
				);
			} else {
				enhancedContent = dimensionFix + consoleSetupScript + enhancedContent;
			}

			// Add completion script before closing body (or at end if no body)
			if (enhancedContent.match(/<\/body>/i)) {
				enhancedContent = enhancedContent.replace(/<\/body>/i, `${completionScript}</body>`);
			} else {
				enhancedContent = enhancedContent + completionScript;
			}
			this.iframe.srcdoc = enhancedContent;
		}
	}

	private createIframe() {
		if (!this.iframe) {
			this.iframe = document.createElement("iframe");
			this.iframe.sandbox.add("allow-scripts");
			this.iframe.className = "w-full h-full border-0";
			this.iframe.title = this.displayTitle || this.filename;
		}

		this.attachIframeToContainer();
	}

	private attachIframeToContainer() {
		if (!this.iframe || !this.iframeContainerRef.value) return;

		// Only append if not already in the container
		if (this.iframe.parentElement !== this.iframeContainerRef.value) {
			this.iframeContainerRef.value.appendChild(this.iframe);
		}
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
						<div class="flex-1 relative" ${ref(this.iframeContainerRef)}></div>
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
