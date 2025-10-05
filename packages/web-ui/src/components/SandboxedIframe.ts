import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Attachment } from "../utils/attachment-utils.js";

export interface SandboxFile {
	fileName: string;
	content: string | Uint8Array;
	mimeType: string;
}

export interface SandboxResult {
	success: boolean;
	console: Array<{ type: string; text: string }>;
	files?: SandboxFile[];
	error?: { message: string; stack: string };
}

/**
 * Function that returns the URL to the sandbox HTML file.
 * Used in browser extensions to load sandbox.html via chrome.runtime.getURL().
 */
export type SandboxUrlProvider = () => string;

@customElement("sandbox-iframe")
export class SandboxIframe extends LitElement {
	private iframe?: HTMLIFrameElement;

	/**
	 * Optional: Provide a function that returns the sandbox HTML URL.
	 * If provided, the iframe will use this URL instead of srcdoc.
	 * This is required for browser extensions with strict CSP.
	 */
	@property({ attribute: false }) sandboxUrlProvider?: SandboxUrlProvider;

	createRenderRoot() {
		return this;
	}

	override connectedCallback() {
		super.connectedCallback();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.iframe?.remove();
	}

	/**
	 * Load HTML content into sandbox and keep it displayed (for HTML artifacts)
	 * @param sandboxId Unique ID
	 * @param htmlContent Full HTML content
	 * @param attachments Attachments available
	 */
	public loadContent(sandboxId: string, htmlContent: string, attachments: Attachment[]): void {
		const completeHtml = this.prepareHtmlDocument(sandboxId, htmlContent, attachments);

		if (this.sandboxUrlProvider) {
			// Browser extension mode: use sandbox.html with postMessage
			this.loadViaSandboxUrl(sandboxId, completeHtml, attachments);
		} else {
			// Web mode: use srcdoc
			this.loadViaSrcdoc(completeHtml);
		}
	}

	private loadViaSandboxUrl(sandboxId: string, completeHtml: string, attachments: Attachment[]): void {
		// Wait for sandbox-ready and send content
		const readyHandler = (e: MessageEvent) => {
			if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
				window.removeEventListener("message", readyHandler);
				this.iframe?.contentWindow?.postMessage(
					{
						type: "sandbox-load",
						sandboxId,
						code: completeHtml,
						attachments,
					},
					"*",
				);
			}
		};
		window.addEventListener("message", readyHandler);

		// Always recreate iframe to ensure fresh sandbox and sandbox-ready message
		this.iframe?.remove();
		this.iframe = document.createElement("iframe");
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.sandbox.add("allow-modals");
		this.iframe.style.width = "100%";
		this.iframe.style.height = "100%";
		this.iframe.style.border = "none";

		this.iframe.src = this.sandboxUrlProvider!();

		this.appendChild(this.iframe);
	}

	private loadViaSrcdoc(completeHtml: string): void {
		// Always recreate iframe to ensure fresh sandbox
		this.iframe?.remove();
		this.iframe = document.createElement("iframe");
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.sandbox.add("allow-modals");
		this.iframe.style.width = "100%";
		this.iframe.style.height = "100%";
		this.iframe.style.border = "none";

		// Set content directly via srcdoc (no CSP restrictions in web apps)
		this.iframe.srcdoc = completeHtml;

		this.appendChild(this.iframe);
	}

	/**
	 * Execute code in sandbox
	 * @param sandboxId Unique ID for this execution
	 * @param code User code (plain JS for REPL, or full HTML for artifacts)
	 * @param attachments Attachments available to the code
	 * @param signal Abort signal
	 * @returns Promise resolving to execution result
	 */
	public async execute(
		sandboxId: string,
		code: string,
		attachments: Attachment[],
		signal?: AbortSignal,
	): Promise<SandboxResult> {
		if (signal?.aborted) {
			throw new Error("Execution aborted");
		}

		// Prepare the complete HTML document with runtime + user code
		const completeHtml = this.prepareHtmlDocument(sandboxId, code, attachments);

		// Wait for execution to complete
		return new Promise((resolve, reject) => {
			const logs: Array<{ type: string; text: string }> = [];
			const files: SandboxFile[] = [];
			let completed = false;

			const messageHandler = (e: MessageEvent) => {
				// Ignore messages not for this sandbox
				if (e.data.sandboxId !== sandboxId) return;

				if (e.data.type === "console") {
					logs.push({
						type: e.data.method === "error" ? "error" : "log",
						text: e.data.text,
					});
				} else if (e.data.type === "file-returned") {
					files.push({
						fileName: e.data.fileName,
						content: e.data.content,
						mimeType: e.data.mimeType,
					});
				} else if (e.data.type === "execution-complete") {
					completed = true;
					cleanup();
					resolve({
						success: true,
						console: logs,
						files: files,
					});
				} else if (e.data.type === "execution-error") {
					completed = true;
					cleanup();
					resolve({
						success: false,
						console: logs,
						error: e.data.error,
						files,
					});
				}
			};

			const abortHandler = () => {
				if (!completed) {
					cleanup();
					reject(new Error("Execution aborted"));
				}
			};

			let readyHandler: ((e: MessageEvent) => void) | undefined;

			const cleanup = () => {
				window.removeEventListener("message", messageHandler);
				signal?.removeEventListener("abort", abortHandler);
				if (readyHandler) {
					window.removeEventListener("message", readyHandler);
				}
				clearTimeout(timeoutId);
			};

			// Set up listeners BEFORE creating iframe
			window.addEventListener("message", messageHandler);
			signal?.addEventListener("abort", abortHandler);

			// Timeout after 30 seconds
			const timeoutId = setTimeout(() => {
				if (!completed) {
					cleanup();
					resolve({
						success: false,
						error: { message: "Execution timeout (30s)", stack: "" },
						console: logs,
						files,
					});
				}
			}, 30000);

			if (this.sandboxUrlProvider) {
				// Browser extension mode: wait for sandbox-ready and send content
				readyHandler = (e: MessageEvent) => {
					if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
						window.removeEventListener("message", readyHandler!);
						// Send the complete HTML
						this.iframe?.contentWindow?.postMessage(
							{
								type: "sandbox-load",
								sandboxId,
								code: completeHtml,
								attachments,
							},
							"*",
						);
					}
				};
				window.addEventListener("message", readyHandler);

				// Create iframe AFTER all listeners are set up
				this.iframe?.remove();
				this.iframe = document.createElement("iframe");
				this.iframe.sandbox.add("allow-scripts");
				this.iframe.sandbox.add("allow-modals");
				this.iframe.style.width = "100%";
				this.iframe.style.height = "100%";
				this.iframe.style.border = "none";

				this.iframe.src = this.sandboxUrlProvider();

				this.appendChild(this.iframe);
			} else {
				// Web mode: use srcdoc
				this.iframe?.remove();
				this.iframe = document.createElement("iframe");
				this.iframe.sandbox.add("allow-scripts");
				this.iframe.sandbox.add("allow-modals");
				this.iframe.style.width = "100%";
				this.iframe.style.height = "100%";
				this.iframe.style.border = "none";

				// Set content via srcdoc BEFORE appending to DOM
				this.iframe.srcdoc = completeHtml;

				this.appendChild(this.iframe);
			}
		});
	}

	/**
	 * Prepare complete HTML document with runtime + user code
	 */
	private prepareHtmlDocument(sandboxId: string, userCode: string, attachments: Attachment[]): string {
		// Runtime script that will be injected
		const runtime = this.getRuntimeScript(sandboxId, attachments);

		// Check if user provided full HTML
		const hasHtmlTag = /<html[^>]*>/i.test(userCode);

		if (hasHtmlTag) {
			// HTML Artifact - inject runtime into existing HTML
			const headMatch = userCode.match(/<head[^>]*>/i);
			if (headMatch) {
				const index = headMatch.index! + headMatch[0].length;
				return userCode.slice(0, index) + runtime + userCode.slice(index);
			}

			const htmlMatch = userCode.match(/<html[^>]*>/i);
			if (htmlMatch) {
				const index = htmlMatch.index! + htmlMatch[0].length;
				return userCode.slice(0, index) + runtime + userCode.slice(index);
			}

			// Fallback: prepend runtime
			return runtime + userCode;
		} else {
			// REPL - wrap code in HTML with runtime and call complete() when done
			return `<!DOCTYPE html>
<html>
<head>
	${runtime}
</head>
<body>
	<script type="module">
		(async () => {
			try {
				${userCode}
				window.complete();
			} catch (error) {
				console.error(error?.stack || error?.message || String(error));
				window.complete({
					message: error?.message || String(error),
					stack: error?.stack || new Error().stack
				});
			}
		})();
	</script>
</body>
</html>`;
		}
	}

	/**
	 * Get the runtime script that captures console, provides helpers, etc.
	 */
	private getRuntimeScript(sandboxId: string, attachments: Attachment[]): string {
		// Convert attachments to serializable format
		const attachmentsData = attachments.map((a) => ({
			id: a.id,
			fileName: a.fileName,
			mimeType: a.mimeType,
			size: a.size,
			content: a.content,
			extractedText: a.extractedText,
		}));

		// Runtime function that will run in the sandbox (NO parameters - values injected before function)
		const runtimeFunc = () => {
			// Helper functions
			(window as any).listFiles = () =>
				(attachments || []).map((a: any) => ({
					id: a.id,
					fileName: a.fileName,
					mimeType: a.mimeType,
					size: a.size,
				}));

			(window as any).readTextFile = (attachmentId: string) => {
				const a = (attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error("Attachment not found: " + attachmentId);
				if (a.extractedText) return a.extractedText;
				try {
					return atob(a.content);
				} catch {
					throw new Error("Failed to decode text content for: " + attachmentId);
				}
			};

			(window as any).readBinaryFile = (attachmentId: string) => {
				const a = (attachments || []).find((x: any) => x.id === attachmentId);
				if (!a) throw new Error("Attachment not found: " + attachmentId);
				const bin = atob(a.content);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return bytes;
			};

			(window as any).returnFile = async (fileName: string, content: any, mimeType?: string) => {
				let finalContent: any, finalMimeType: string;

				if (content instanceof Blob) {
					const arrayBuffer = await content.arrayBuffer();
					finalContent = new Uint8Array(arrayBuffer);
					finalMimeType = mimeType || content.type || "application/octet-stream";
					if (!mimeType && !content.type) {
						throw new Error(
							"returnFile: MIME type is required for Blob content. Please provide a mimeType parameter (e.g., 'image/png').",
						);
					}
				} else if (content instanceof Uint8Array) {
					finalContent = content;
					if (!mimeType) {
						throw new Error(
							"returnFile: MIME type is required for Uint8Array content. Please provide a mimeType parameter (e.g., 'image/png').",
						);
					}
					finalMimeType = mimeType;
				} else if (typeof content === "string") {
					finalContent = content;
					finalMimeType = mimeType || "text/plain";
				} else {
					finalContent = JSON.stringify(content, null, 2);
					finalMimeType = mimeType || "application/json";
				}

				window.parent.postMessage(
					{
						type: "file-returned",
						sandboxId,
						fileName,
						content: finalContent,
						mimeType: finalMimeType,
					},
					"*",
				);
			};

			// Console capture
			const originalConsole = {
				log: console.log,
				error: console.error,
				warn: console.warn,
				info: console.info,
			};

			["log", "error", "warn", "info"].forEach((method) => {
				(console as any)[method] = (...args: any[]) => {
					const text = args
						.map((arg) => {
							try {
								return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
							} catch {
								return String(arg);
							}
						})
						.join(" ");

					window.parent.postMessage(
						{
							type: "console",
							sandboxId,
							method,
							text,
						},
						"*",
					);

					(originalConsole as any)[method].apply(console, args);
				};
			});

			// Track errors for HTML artifacts
			let lastError: { message: string; stack: string } | null = null;

			// Error handlers
			window.addEventListener("error", (e) => {
				const text =
					(e.error?.stack || e.message || String(e)) + " at line " + (e.lineno || "?") + ":" + (e.colno || "?");

				// Store the error
				lastError = {
					message: e.error?.message || e.message || String(e),
					stack: e.error?.stack || text,
				};

				window.parent.postMessage(
					{
						type: "console",
						sandboxId,
						method: "error",
						text,
					},
					"*",
				);
			});

			window.addEventListener("unhandledrejection", (e) => {
				const text = "Unhandled promise rejection: " + (e.reason?.message || e.reason || "Unknown error");

				// Store the error
				lastError = {
					message: e.reason?.message || String(e.reason) || "Unhandled promise rejection",
					stack: e.reason?.stack || text,
				};

				window.parent.postMessage(
					{
						type: "console",
						sandboxId,
						method: "error",
						text,
					},
					"*",
				);
			});

			// Expose complete() method for user code to call
			let completionSent = false;
			(window as any).complete = (error?: { message: string; stack: string }) => {
				if (completionSent) return;
				completionSent = true;

				// Use provided error or last caught error
				const finalError = error || lastError;

				if (finalError) {
					window.parent.postMessage(
						{
							type: "execution-error",
							sandboxId,
							error: finalError,
						},
						"*",
					);
				} else {
					window.parent.postMessage(
						{
							type: "execution-complete",
							sandboxId,
						},
						"*",
					);
				}
			};

			// Fallback timeout for HTML artifacts that don't call complete()
			if (document.readyState === "complete" || document.readyState === "interactive") {
				setTimeout(() => (window as any).complete(), 2000);
			} else {
				window.addEventListener("load", () => {
					setTimeout(() => (window as any).complete(), 2000);
				});
			}
		};

		// Prepend the const declarations, then the function
		return (
			`<script>\n` +
			`window.sandboxId = ${JSON.stringify(sandboxId)};\n` +
			`window.attachments = ${JSON.stringify(attachmentsData)};\n` +
			`(${runtimeFunc.toString()})();\n` +
			`</script>`
		);
	}
}
