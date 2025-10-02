import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Attachment } from "../utils/attachment-utils.js";

// @ts-ignore - browser global exists in Firefox
declare const browser: any;

@customElement("sandbox-iframe")
export class SandboxIframe extends LitElement {
	@property() content = "";
	@property() artifactId = "";
	@property({ attribute: false }) attachments: Attachment[] = [];

	private iframe?: HTMLIFrameElement;
	private logs: Array<{ type: "log" | "error"; text: string }> = [];

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
		// Handle sandbox-ready message
		if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
			// Sandbox is ready, inject our runtime and send content
			const enhancedContent = this.injectRuntimeScripts(this.content);
			this.iframe?.contentWindow?.postMessage(
				{
					type: "loadContent",
					content: enhancedContent,
					artifactId: this.artifactId,
					attachments: this.attachments,
				},
				"*",
			);
			return;
		}

		// Only handle messages for this artifact
		if (e.data.artifactId !== this.artifactId) return;

		// Handle console messages
		if (e.data.type === "console") {
			const log = {
				type: e.data.method === "error" ? ("error" as const) : ("log" as const),
				text: e.data.text,
			};
			this.logs.push(log);
			this.dispatchEvent(
				new CustomEvent("console", {
					detail: log,
					bubbles: true,
					composed: true,
				}),
			);
		} else if (e.data.type === "execution-complete") {
			// Store final logs
			this.logs = e.data.logs || [];
			this.dispatchEvent(
				new CustomEvent("execution-complete", {
					detail: { logs: this.logs },
					bubbles: true,
					composed: true,
				}),
			);

			// Force reflow when iframe content is ready
			if (this.iframe) {
				this.iframe.style.display = "none";
				this.iframe.offsetHeight; // Force reflow
				this.iframe.style.display = "";
			}
		}
	};

	private injectRuntimeScripts(htmlContent: string): string {
		// Define the runtime function that will be injected
		const runtimeFunction = (artifactId: string, attachments: any[]) => {
			// @ts-ignore - window extensions
			window.__artifactLogs = [];
			const originalConsole = {
				log: console.log,
				error: console.error,
				warn: console.warn,
				info: console.info,
			};

			["log", "error", "warn", "info"].forEach((method) => {
				// @ts-ignore
				console[method] = (...args: any[]) => {
					const text = args
						.map((arg: any) => {
							try {
								return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
							} catch {
								return String(arg);
							}
						})
						.join(" ");
					// @ts-ignore
					window.__artifactLogs.push({ type: method === "error" ? "error" : "log", text });
					window.parent.postMessage(
						{
							type: "console",
							method,
							text,
							artifactId,
						},
						"*",
					);
					// @ts-ignore
					originalConsole[method].apply(console, args);
				};
			});

			window.addEventListener("error", (e: ErrorEvent) => {
				const text = e.message + " at line " + e.lineno + ":" + e.colno;
				// @ts-ignore
				window.__artifactLogs.push({ type: "error", text });
				window.parent.postMessage(
					{
						type: "console",
						method: "error",
						text,
						artifactId,
					},
					"*",
				);
			});

			window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
				const text = "Unhandled promise rejection: " + (e.reason?.message || e.reason || "Unknown error");
				// @ts-ignore
				window.__artifactLogs.push({ type: "error", text });
				window.parent.postMessage(
					{
						type: "console",
						method: "error",
						text,
						artifactId,
					},
					"*",
				);
			});

			// Attachment helpers
			// @ts-ignore
			window.attachments = attachments;
			// @ts-ignore
			window.listFiles = () => {
				// @ts-ignore
				return (window.attachments || []).map((a: any) => ({
					id: a.id,
					fileName: a.fileName,
					mimeType: a.mimeType,
					size: a.size,
				}));
			};
			// @ts-ignore
			window.readTextFile = (attachmentId: string) => {
				// @ts-ignore
				const a = (window.attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error("Attachment not found: " + attachmentId);
				if (a.extractedText) return a.extractedText;
				try {
					return atob(a.content);
				} catch {
					throw new Error("Failed to decode text content for: " + attachmentId);
				}
			};
			// @ts-ignore
			window.readBinaryFile = (attachmentId: string) => {
				// @ts-ignore
				const a = (window.attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error("Attachment not found: " + attachmentId);
				const bin = atob(a.content);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return bytes;
			};

			// Send completion after 2 seconds
			const sendCompletion = () => {
				window.parent.postMessage(
					{
						type: "execution-complete",
						// @ts-ignore
						logs: window.__artifactLogs || [],
						artifactId,
					},
					"*",
				);
			};

			if (document.readyState === "complete" || document.readyState === "interactive") {
				setTimeout(sendCompletion, 2000);
			} else {
				window.addEventListener("load", () => {
					setTimeout(sendCompletion, 2000);
				});
			}
		};

		// Convert function to string and wrap in IIFE with parameters
		const runtimeScript = `
			<script>
			(${runtimeFunction.toString()})(${JSON.stringify(this.artifactId)}, ${JSON.stringify(this.attachments)});
			</script>
		`;

		// Inject at start of <head> or start of document
		const headMatch = htmlContent.match(/<head[^>]*>/i);
		if (headMatch) {
			const index = headMatch.index! + headMatch[0].length;
			return htmlContent.slice(0, index) + runtimeScript + htmlContent.slice(index);
		}

		const htmlMatch = htmlContent.match(/<html[^>]*>/i);
		if (htmlMatch) {
			const index = htmlMatch.index! + htmlMatch[0].length;
			return htmlContent.slice(0, index) + runtimeScript + htmlContent.slice(index);
		}

		return runtimeScript + htmlContent;
	}

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
		// Clear logs for new content
		this.logs = [];
		// Recreate iframe for clean state
		if (this.iframe) {
			this.iframe.remove();
			this.iframe = undefined;
		}
		this.createIframe();
	}

	public getLogs(): Array<{ type: "log" | "error"; text: string }> {
		return this.logs;
	}
}
