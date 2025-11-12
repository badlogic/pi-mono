import hljs from "highlight.js";
import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { RefreshCw } from "lucide";
import type { SandboxIframe } from "../../components/SandboxedIframe.js";
import { type MessageConsumer, RUNTIME_MESSAGE_ROUTER } from "../../components/sandbox/RuntimeMessageRouter.js";
import type { SandboxRuntimeProvider } from "../../components/sandbox/SandboxRuntimeProvider.js";
import { i18n } from "../../utils/i18n.js";
import "../../components/SandboxedIframe.js";
import { ArtifactElement } from "./ArtifactElement.js";
import type { Console } from "./Console.js";
import "./Console.js";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { CopyButton } from "@mariozechner/mini-lit/dist/CopyButton.js";
import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import { PreviewCodeToggle } from "@mariozechner/mini-lit/dist/PreviewCodeToggle.js";

@customElement("html-artifact")
export class HtmlArtifact extends ArtifactElement {
	@property() override filename = "";
	@property({ attribute: false }) runtimeProviders: SandboxRuntimeProvider[] = [];
	@property({ attribute: false }) sandboxUrlProvider?: () => string;

	private _content = "";
	private logs: Array<{ type: "log" | "error"; text: string }> = [];

	// Refs for DOM elements
	public sandboxIframeRef: Ref<SandboxIframe> = createRef();
	private consoleRef: Ref<Console> = createRef();

	@state() private viewMode: "preview" | "code" = "preview";

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

		// Generate standalone HTML with all runtime code injected for download
		const sandbox = this.sandboxIframeRef.value;
		const sandboxId = `artifact-${this.filename}`;
		const downloadContent =
			sandbox?.prepareHtmlDocument(sandboxId, this._content, this.runtimeProviders || [], {
				isHtmlArtifact: true,
				isStandalone: true, // Skip runtime bridge and navigation interceptor for standalone downloads
			}) || this._content;

		return html`
			<div class="flex items-center gap-2">
				${toggle}
				${Button({
					variant: "ghost",
					size: "sm",
					onClick: () => {
						this.logs = [];
						this.executeContent(this._content);
					},
					title: i18n("Reload HTML"),
					children: icon(RefreshCw, "sm"),
				})}
				${copyButton}
				${DownloadButton({ content: downloadContent, filename: this.filename, mimeType: "text/html", title: i18n("Download HTML") })}
			</div>
		`;
	}

	override set content(value: string) {
		const oldValue = this._content;
		this._content = value;
		if (oldValue !== value) {
			// Reset logs when content changes
			this.logs = [];
			this.requestUpdate();
			// Execute content in sandbox if it exists
			if (this.sandboxIframeRef.value && value) {
				this.executeContent(value);
			}
		}
	}

	public executeContent(html: string) {
		const sandbox = this.sandboxIframeRef.value;
		if (!sandbox) return;

		// Configure sandbox URL provider if provided (for browser extensions)
		if (this.sandboxUrlProvider) {
			sandbox.sandboxUrlProvider = this.sandboxUrlProvider;
		}

		const sandboxId = `artifact-${this.filename}`;

		// Create consumer for console messages
		const consumer: MessageConsumer = {
			handleMessage: async (message: any): Promise<void> => {
				if (message.type === "console") {
					// Create new array reference for Lit reactivity
					this.logs = [
						...this.logs,
						{
							type: message.method === "error" ? "error" : "log",
							text: message.text,
						},
					];
					this.requestUpdate(); // Re-render to show console
				}
			},
		};

		// Inject window.complete() call at the end of the HTML to signal when page is loaded
		// HTML artifacts don't time out - they call complete() when ready
		let modifiedHtml = html;
		if (modifiedHtml.includes("</html>")) {
			modifiedHtml = modifiedHtml.replace(
				"</html>",
				"<script>if (window.complete) window.complete();</script></html>",
			);
		} else {
			// If no closing </html> tag, append the script
			modifiedHtml += "<script>if (window.complete) window.complete();</script>";
		}

		// Load content - this handles sandbox registration, consumer registration, and iframe creation
		sandbox.loadContent(sandboxId, modifiedHtml, this.runtimeProviders, [consumer]);
	}

	override get content(): string {
		return this._content;
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		// Unregister sandbox when element is removed from DOM
		const sandboxId = `artifact-${this.filename}`;
		RUNTIME_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
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
								? html`<artifact-console .logs=${this.logs} ${ref(this.consoleRef)}></artifact-console>`
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
