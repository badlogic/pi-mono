import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ConsoleRuntimeProvider } from "./sandbox/ConsoleRuntimeProvider.js";
import { type MessageConsumer, SANDBOX_MESSAGE_ROUTER } from "./sandbox/SandboxMessageRouter.js";
import type { SandboxRuntimeProvider } from "./sandbox/SandboxRuntimeProvider.js";

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
		// Note: We don't unregister the sandbox here for loadContent() mode
		// because the caller (HtmlArtifact) owns the sandbox lifecycle.
		// For execute() mode, the sandbox is unregistered in the cleanup function.
		this.iframe?.remove();
	}

	/**
	 * Load HTML content into sandbox and keep it displayed (for HTML artifacts)
	 * @param sandboxId Unique ID
	 * @param htmlContent Full HTML content
	 * @param providers Runtime providers to inject
	 * @param consumers Message consumers to register (optional)
	 */
	public loadContent(
		sandboxId: string,
		htmlContent: string,
		providers: SandboxRuntimeProvider[] = [],
		consumers: MessageConsumer[] = [],
	): void {
		// Unregister previous sandbox if exists
		try {
			SANDBOX_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
		} catch {
			// Sandbox might not exist, that's ok
		}

		providers = [new ConsoleRuntimeProvider(), ...providers];

		SANDBOX_MESSAGE_ROUTER.registerSandbox(sandboxId, providers, consumers);

		const completeHtml = this.prepareHtmlDocument(sandboxId, htmlContent, providers);

		// Remove previous iframe if exists
		this.iframe?.remove();

		if (this.sandboxUrlProvider) {
			// Browser extension mode: use sandbox.html with postMessage
			this.loadViaSandboxUrl(sandboxId, completeHtml);
		} else {
			// Web mode: use srcdoc
			this.loadViaSrcdoc(sandboxId, completeHtml);
		}
	}

	private loadViaSandboxUrl(sandboxId: string, completeHtml: string): void {
		// Create iframe pointing to sandbox URL
		this.iframe = document.createElement("iframe");
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.sandbox.add("allow-modals");
		this.iframe.style.width = "100%";
		this.iframe.style.height = "100%";
		this.iframe.style.border = "none";
		this.iframe.src = this.sandboxUrlProvider!();

		// Update router with iframe reference BEFORE appending to DOM
		SANDBOX_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

		// Listen for sandbox-ready message directly
		const readyHandler = (e: MessageEvent) => {
			if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
				window.removeEventListener("message", readyHandler);

				// Send content to sandbox
				this.iframe?.contentWindow?.postMessage(
					{
						type: "sandbox-load",
						sandboxId,
						code: completeHtml,
					},
					"*",
				);
			}
		};

		window.addEventListener("message", readyHandler);

		this.appendChild(this.iframe);
	}

	private loadViaSrcdoc(sandboxId: string, completeHtml: string): void {
		// Create iframe with srcdoc
		this.iframe = document.createElement("iframe");
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.sandbox.add("allow-modals");
		this.iframe.style.width = "100%";
		this.iframe.style.height = "100%";
		this.iframe.style.border = "none";
		this.iframe.srcdoc = completeHtml;

		// Update router with iframe reference BEFORE appending to DOM
		SANDBOX_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

		this.appendChild(this.iframe);
	}

	/**
	 * Execute code in sandbox
	 * @param sandboxId Unique ID for this execution
	 * @param code User code (plain JS for REPL, or full HTML for artifacts)
	 * @param providers Runtime providers to inject
	 * @param consumers Additional message consumers (optional, execute has its own internal consumer)
	 * @param signal Abort signal
	 * @returns Promise resolving to execution result
	 */
	public async execute(
		sandboxId: string,
		code: string,
		providers: SandboxRuntimeProvider[] = [],
		consumers: MessageConsumer[] = [],
		signal?: AbortSignal,
	): Promise<SandboxResult> {
		if (signal?.aborted) {
			throw new Error("Execution aborted");
		}

		providers = [new ConsoleRuntimeProvider(), ...providers];
		SANDBOX_MESSAGE_ROUTER.registerSandbox(sandboxId, providers, consumers);

		const logs: Array<{ type: string; text: string }> = [];
		const files: SandboxFile[] = [];
		let completed = false;

		return new Promise((resolve, reject) => {
			// 4. Create execution consumer for lifecycle messages
			const executionConsumer: MessageConsumer = {
				async handleMessage(message: any): Promise<boolean> {
					if (message.type === "console") {
						logs.push({
							type: message.method === "error" ? "error" : "log",
							text: message.text,
						});
						return true;
					} else if (message.type === "file-returned") {
						files.push({
							fileName: message.fileName,
							content: message.content,
							mimeType: message.mimeType,
						});
						return true;
					} else if (message.type === "execution-complete") {
						completed = true;
						cleanup();
						resolve({ success: true, console: logs, files });
						return true;
					} else if (message.type === "execution-error") {
						completed = true;
						cleanup();
						resolve({ success: false, console: logs, error: message.error, files });
						return true;
					}
					return false;
				},
			};

			SANDBOX_MESSAGE_ROUTER.addConsumer(sandboxId, executionConsumer);

			const cleanup = () => {
				SANDBOX_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
				signal?.removeEventListener("abort", abortHandler);
				clearTimeout(timeoutId);
				this.iframe?.remove();
				this.iframe = undefined;
			};

			// Abort handler
			const abortHandler = () => {
				if (!completed) {
					completed = true;
					cleanup();
					reject(new Error("Execution aborted"));
				}
			};

			if (signal) {
				signal.addEventListener("abort", abortHandler);
			}

			// Timeout handler (30 seconds)
			const timeoutId = setTimeout(() => {
				if (!completed) {
					completed = true;
					cleanup();
					resolve({
						success: false,
						console: logs,
						error: { message: "Execution timeout (30s)", stack: "" },
						files,
					});
				}
			}, 30000);

			// 4. Prepare HTML and create iframe
			const completeHtml = this.prepareHtmlDocument(sandboxId, code, providers);

			if (this.sandboxUrlProvider) {
				// Browser extension mode: wait for sandbox-ready
				this.iframe = document.createElement("iframe");
				this.iframe.sandbox.add("allow-scripts", "allow-modals");
				this.iframe.style.cssText = "width: 100%; height: 100%; border: none;";
				this.iframe.src = this.sandboxUrlProvider();

				// Update router with iframe reference BEFORE appending to DOM
				SANDBOX_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

				// Listen for sandbox-ready message directly
				const readyHandler = (e: MessageEvent) => {
					if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
						window.removeEventListener("message", readyHandler);

						// Send content to sandbox
						this.iframe?.contentWindow?.postMessage(
							{
								type: "sandbox-load",
								sandboxId,
								code: completeHtml,
							},
							"*",
						);
					}
				};

				window.addEventListener("message", readyHandler);

				this.appendChild(this.iframe);
			} else {
				// Web mode: use srcdoc
				this.iframe = document.createElement("iframe");
				this.iframe.sandbox.add("allow-scripts", "allow-modals");
				this.iframe.style.cssText = "width: 100%; height: 100%; border: none; display: none;";
				this.iframe.srcdoc = completeHtml;

				// Update router with iframe reference BEFORE appending to DOM
				SANDBOX_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

				this.appendChild(this.iframe);
			}
		});
	}

	/**
	 * Prepare complete HTML document with runtime + user code
	 * PUBLIC so HtmlArtifact can use it for download button
	 */
	public prepareHtmlDocument(sandboxId: string, userCode: string, providers: SandboxRuntimeProvider[] = []): string {
		// Runtime script that will be injected
		const runtime = this.getRuntimeScript(sandboxId, providers);

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
	 * Generate runtime script from providers
	 */
	private getRuntimeScript(sandboxId: string, providers: SandboxRuntimeProvider[] = []): string {
		// Collect all data from providers
		const allData: Record<string, any> = {};
		for (const provider of providers) {
			Object.assign(allData, provider.getData());
		}

		// Collect all runtime functions - pass sandboxId as string literal
		const runtimeFunctions: string[] = [];
		for (const provider of providers) {
			runtimeFunctions.push(`(${provider.getRuntime().toString()})(${JSON.stringify(sandboxId)});`);
		}

		// Build script
		const dataInjection = Object.entries(allData)
			.map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
			.join("\n");

		return `<script>
window.sandboxId = ${JSON.stringify(sandboxId)};
${dataInjection}
${runtimeFunctions.join("\n")}
</script>`;
	}
}
