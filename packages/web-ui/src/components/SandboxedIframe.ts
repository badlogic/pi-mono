import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ConsoleRuntimeProvider } from "./sandbox/ConsoleRuntimeProvider.js";
import { RuntimeMessageBridge } from "./sandbox/RuntimeMessageBridge.js";
import { type MessageConsumer, RUNTIME_MESSAGE_ROUTER } from "./sandbox/RuntimeMessageRouter.js";
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
	returnValue?: any;
}

/**
 * Function that returns the URL to the sandbox HTML file.
 * Used in browser extensions to load sandbox.html via chrome.runtime.getURL().
 */
export type SandboxUrlProvider = () => string;

/**
 * Configuration for prepareHtmlDocument
 */
export interface PrepareHtmlOptions {
	/** True if this is an HTML artifact (inject into existing HTML), false if REPL (wrap in HTML) */
	isHtmlArtifact: boolean;
	/** True if this is a standalone download (no runtime bridge, no navigation interceptor) */
	isStandalone?: boolean;
}

/**
 * Escape HTML special sequences in code to prevent premature tag closure
 * @param code Code that will be injected into <script> tags
 * @returns Escaped code safe for injection
 */
function escapeScriptContent(code: string): string {
	return code.replace(/<\/script/gi, "<\\/script");
}

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
			RUNTIME_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
		} catch {
			// Sandbox might not exist, that's ok
		}

		providers = [new ConsoleRuntimeProvider(), ...providers];

		RUNTIME_MESSAGE_ROUTER.registerSandbox(sandboxId, providers, consumers);

		// loadContent is always used for HTML artifacts (not standalone)
		const completeHtml = this.prepareHtmlDocument(sandboxId, htmlContent, providers, {
			isHtmlArtifact: true,
			isStandalone: false,
		});

		// Validate HTML before loading
		const validationError = this.validateHtml(completeHtml);
		if (validationError) {
			console.error("HTML validation failed:", validationError);
			// Show error in iframe instead of crashing
			this.iframe?.remove();
			this.iframe = document.createElement("iframe");
			this.iframe.style.cssText = "width: 100%; height: 100%; border: none;";
			this.iframe.srcdoc = `
				<html>
				<body style="font-family: monospace; padding: 20px; background: #fff; color: #000;">
					<h3 style="color: #c00;">HTML Validation Error</h3>
					<pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap;">${validationError}</pre>
				</body>
				</html>
			`;
			this.appendChild(this.iframe);
			return;
		}

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
		RUNTIME_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

		// Listen for open-external-url messages from iframe
		const externalUrlHandler = (e: MessageEvent) => {
			if (e.data.type === "open-external-url" && e.source === this.iframe?.contentWindow) {
				// Use chrome.tabs API to open in new tab
				const chromeAPI = (globalThis as any).chrome;
				if (chromeAPI?.tabs) {
					chromeAPI.tabs.create({ url: e.data.url });
				} else {
					// Fallback for non-extension context
					window.open(e.data.url, "_blank");
				}
			}
		};
		window.addEventListener("message", externalUrlHandler);

		// Listen for sandbox-ready and sandbox-error messages directly
		const readyHandler = (e: MessageEvent) => {
			if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
				window.removeEventListener("message", readyHandler);
				window.removeEventListener("message", errorHandler);

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

		const errorHandler = (e: MessageEvent) => {
			if (e.data.type === "sandbox-error" && e.source === this.iframe?.contentWindow) {
				window.removeEventListener("message", readyHandler);
				window.removeEventListener("message", errorHandler);

				// The sandbox.js already sent us the error via postMessage.
				// We need to convert it to an execution-error message that the execute() consumer will handle.
				// Simulate receiving an execution-error from the sandbox
				window.postMessage(
					{
						sandboxId: sandboxId,
						type: "execution-error",
						error: { message: e.data.error, stack: e.data.stack },
					},
					"*",
				);
			}
		};

		window.addEventListener("message", readyHandler);
		window.addEventListener("message", errorHandler);

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
		RUNTIME_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

		// Listen for open-external-url messages from iframe
		const externalUrlHandler = (e: MessageEvent) => {
			if (e.data.type === "open-external-url" && e.source === this.iframe?.contentWindow) {
				// Fallback for non-extension context
				window.open(e.data.url, "_blank");
			}
		};
		window.addEventListener("message", externalUrlHandler);

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
		isHtmlArtifact: boolean = false,
	): Promise<SandboxResult> {
		if (signal?.aborted) {
			throw new Error("Execution aborted");
		}

		const consoleProvider = new ConsoleRuntimeProvider();
		providers = [consoleProvider, ...providers];
		RUNTIME_MESSAGE_ROUTER.registerSandbox(sandboxId, providers, consumers);

		// Notify providers that execution is starting
		for (const provider of providers) {
			provider.onExecutionStart?.(sandboxId, signal);
		}

		const files: SandboxFile[] = [];
		let completed = false;

		return new Promise((resolve, reject) => {
			// 4. Create execution consumer for lifecycle messages
			const executionConsumer: MessageConsumer = {
				async handleMessage(message: any): Promise<void> {
					if (message.type === "file-returned") {
						files.push({
							fileName: message.fileName,
							content: message.content,
							mimeType: message.mimeType,
						});
					} else if (message.type === "execution-complete") {
						completed = true;
						cleanup();
						resolve({
							success: true,
							console: consoleProvider.getLogs(),
							files,
							returnValue: message.returnValue,
						});
					} else if (message.type === "execution-error") {
						completed = true;
						cleanup();
						resolve({ success: false, console: consoleProvider.getLogs(), error: message.error, files });
					}
				},
			};

			RUNTIME_MESSAGE_ROUTER.addConsumer(sandboxId, executionConsumer);

			const cleanup = () => {
				// Notify providers that execution has ended
				for (const provider of providers) {
					provider.onExecutionEnd?.(sandboxId);
				}

				RUNTIME_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
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
						console: consoleProvider.getLogs(),
						error: { message: "Execution timeout (120s)", stack: "" },
						files,
					});
				}
			}, 120000);

			// 4. Prepare HTML and create iframe
			const completeHtml = this.prepareHtmlDocument(sandboxId, code, providers, {
				isHtmlArtifact,
				isStandalone: false,
			});

			// 5. Validate HTML before sending to sandbox
			const validationError = this.validateHtml(completeHtml);
			if (validationError) {
				reject(new Error(`HTML validation failed: ${validationError}`));
				return;
			}

			if (this.sandboxUrlProvider) {
				// Browser extension mode: wait for sandbox-ready
				this.iframe = document.createElement("iframe");
				this.iframe.sandbox.add("allow-scripts", "allow-modals");
				this.iframe.style.cssText = "width: 100%; height: 100%; border: none;";
				this.iframe.src = this.sandboxUrlProvider();

				// Update router with iframe reference BEFORE appending to DOM
				RUNTIME_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

				// Listen for sandbox-ready and sandbox-error messages
				const readyHandler = (e: MessageEvent) => {
					if (e.data.type === "sandbox-ready" && e.source === this.iframe?.contentWindow) {
						window.removeEventListener("message", readyHandler);
						window.removeEventListener("message", errorHandler);

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

				const errorHandler = (e: MessageEvent) => {
					if (e.data.type === "sandbox-error" && e.source === this.iframe?.contentWindow) {
						window.removeEventListener("message", readyHandler);
						window.removeEventListener("message", errorHandler);

						// Convert sandbox-error to execution-error for the execution consumer
						window.postMessage(
							{
								sandboxId: sandboxId,
								type: "execution-error",
								error: { message: e.data.error, stack: e.data.stack },
							},
							"*",
						);
					}
				};

				window.addEventListener("message", readyHandler);
				window.addEventListener("message", errorHandler);

				this.appendChild(this.iframe);
			} else {
				// Web mode: use srcdoc
				this.iframe = document.createElement("iframe");
				this.iframe.sandbox.add("allow-scripts", "allow-modals");
				this.iframe.style.cssText = "width: 100%; height: 100%; border: none; display: none;";
				this.iframe.srcdoc = completeHtml;

				// Update router with iframe reference BEFORE appending to DOM
				RUNTIME_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

				this.appendChild(this.iframe);
			}
		});
	}

	/**
	 * Validate HTML using DOMParser - returns error message if invalid, null if valid
	 * Note: JavaScript syntax validation is done in sandbox.js to avoid CSP restrictions
	 */
	private validateHtml(html: string): string | null {
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, "text/html");

			// Check for parser errors
			const parserError = doc.querySelector("parsererror");
			if (parserError) {
				return parserError.textContent || "Unknown parse error";
			}

			return null;
		} catch (error: any) {
			return error.message || "Unknown validation error";
		}
	}

	/**
	 * Prepare complete HTML document with runtime + user code
	 * PUBLIC so HtmlArtifact can use it for download button
	 */
	public prepareHtmlDocument(
		sandboxId: string,
		userCode: string,
		providers: SandboxRuntimeProvider[] = [],
		options?: PrepareHtmlOptions,
	): string {
		// Default options
		const opts: PrepareHtmlOptions = {
			isHtmlArtifact: false,
			isStandalone: false,
			...options,
		};

		// Runtime script that will be injected
		const runtime = this.getRuntimeScript(sandboxId, providers, opts.isStandalone || false);

		// Only check for HTML tags if explicitly marked as HTML artifact
		// For javascript_repl, userCode is JavaScript that may contain HTML in string literals
		if (opts.isHtmlArtifact) {
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
			// Escape </script> in user code to prevent premature tag closure
			const escapedUserCode = escapeScriptContent(userCode);

			return `<!DOCTYPE html>
<html>
<head>
	${runtime}
</head>
<body>
	<script type="module">
		(async () => {
			try {
				// Wrap user code in async function to capture return value
				const userCodeFunc = async () => {
					${escapedUserCode}
				};

				const returnValue = await userCodeFunc();

				// Call completion callbacks before complete()
				if (window.__completionCallbacks && window.__completionCallbacks.length > 0) {
					try {
						await Promise.all(window.__completionCallbacks.map(cb => cb(true)));
					} catch (e) {
						console.error('Completion callback error:', e);
					}
				}

				await window.complete(null, returnValue);
			} catch (error) {

				// Call completion callbacks before complete() (error path)
				if (window.__completionCallbacks && window.__completionCallbacks.length > 0) {
					try {
						await Promise.all(window.__completionCallbacks.map(cb => cb(false)));
					} catch (e) {
						console.error('Completion callback error:', e);
					}
				}

				await window.complete({
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
	 * @param sandboxId Unique sandbox ID
	 * @param providers Runtime providers
	 * @param isStandalone If true, skip runtime bridge and navigation interceptor (for standalone downloads)
	 */
	private getRuntimeScript(
		sandboxId: string,
		providers: SandboxRuntimeProvider[] = [],
		isStandalone: boolean = false,
	): string {
		// Collect all data from providers
		const allData: Record<string, any> = {};
		for (const provider of providers) {
			Object.assign(allData, provider.getData());
		}

		// Generate bridge code (skip if standalone)
		const bridgeCode = isStandalone
			? ""
			: RuntimeMessageBridge.generateBridgeCode({
					context: "sandbox-iframe",
					sandboxId,
				});

		// Collect all runtime functions - pass sandboxId as string literal
		const runtimeFunctions: string[] = [];
		for (const provider of providers) {
			runtimeFunctions.push(`(${provider.getRuntime().toString()})(${JSON.stringify(sandboxId)});`);
		}

		// Build script with HTML escaping
		// Escape </script> to prevent premature tag closure in HTML parser
		const dataInjection = Object.entries(allData)
			.map(([key, value]) => {
				const jsonStr = JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
				return `window.${key} = ${jsonStr};`;
			})
			.join("\n");

		// TODO the font-size is needed, as chrome seems to inject a stylesheet into iframes
		// found in an extension context like sidepanel, setting body { font-size: 75% }. It's
		// definitely not our code doing that.
		// See  https://stackoverflow.com/questions/71480433/chrome-is-injecting-some-stylesheet-in-popup-ui-which-reduces-the-font-size-to-7

		// Navigation interceptor (only if NOT standalone)
		const navigationInterceptor = isStandalone
			? ""
			: `
// Navigation interceptor: prevent all navigation and open externally
(function() {
	// Intercept link clicks
	document.addEventListener('click', function(e) {
		const link = e.target.closest('a');
		if (link && link.href) {
			// Check if it's an external link (not javascript: or #hash)
			if (link.href.startsWith('http://') || link.href.startsWith('https://')) {
				e.preventDefault();
				e.stopPropagation();
				window.parent.postMessage({ type: 'open-external-url', url: link.href }, '*');
			}
		}
	}, true);

	// Intercept form submissions
	document.addEventListener('submit', function(e) {
		const form = e.target;
		if (form && form.action) {
			e.preventDefault();
			e.stopPropagation();
			window.parent.postMessage({ type: 'open-external-url', url: form.action }, '*');
		}
	}, true);

	// Prevent window.location changes (only if not already redefined)
	try {
		const originalLocation = window.location;
		Object.defineProperty(window, 'location', {
			get: function() { return originalLocation; },
			set: function(url) {
				window.parent.postMessage({ type: 'open-external-url', url: url.toString() }, '*');
			}
		});
	} catch (e) {
		// Already defined, skip
	}
})();
`;

		return `<style>
html, body {
	font-size: initial;
}
</style>
<script>
window.sandboxId = ${JSON.stringify(sandboxId)};
${dataInjection}
${bridgeCode}
${runtimeFunctions.join("\n")}
${navigationInterceptor}
</script>`;
	}
}
