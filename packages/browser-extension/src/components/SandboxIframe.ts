import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

// @ts-ignore - browser global exists in Firefox
declare const browser: any;

@customElement("sandbox-iframe")
export class SandboxIframe extends LitElement {
	@property() content = "";
	private iframe?: HTMLIFrameElement;

	createRenderRoot() {
		return this;
	}

	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener("message", this.handleMessage);
		this.createIframe();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener("message", this.handleMessage);
		this.iframe?.remove();
	}

	private handleMessage = (e: MessageEvent) => {
		if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
			// Sandbox is ready, send content
			this.iframe?.contentWindow?.postMessage(
				{
					type: "loadContent",
					content: this.content,
					artifactId: "test",
					attachments: [],
				},
				"*",
			);
		}
	};

	private createIframe() {
		this.iframe = document.createElement("iframe");
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.sandbox.add("allow-modals");
		this.iframe.style.width = "100%";
		this.iframe.style.height = "100%";
		this.iframe.style.border = "none";

		const isFirefox = typeof browser !== "undefined" && browser.runtime !== undefined;
		if (isFirefox) {
			this.iframe.src = browser.runtime.getURL("sandbox.html");
		} else {
			this.iframe.src = chrome.runtime.getURL("sandbox.html");
		}

		this.appendChild(this.iframe);
	}

	public updateContent(newContent: string) {
		this.content = newContent;
		// Recreate iframe for clean state
		if (this.iframe) {
			this.iframe.remove();
			this.iframe = undefined;
		}
		this.createIframe();
	}
}
