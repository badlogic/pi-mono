import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { AgentTool, ToolResultMessage } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import "../components/ConsoleBlock.js"; // Ensure console-block is registered
import type { Attachment } from "../utils/attachment-utils.js";
import { registerToolRenderer } from "./renderer-registry.js";
import type { ToolRenderer } from "./types.js";

// Cross-browser API compatibility
// @ts-expect-error - browser global exists in Firefox, chrome in Chrome
const browser = globalThis.browser || globalThis.chrome;

const browserJavaScriptSchema = Type.Object({
	code: Type.String({ description: "JavaScript code to execute in the active browser tab" }),
});

export type BrowserJavaScriptToolResult = {
	files?:
		| {
				fileName: string;
				contentBase64: string;
				mimeType: string;
				size: number;
		  }[]
		| undefined;
};

export const browserJavaScriptTool: AgentTool<typeof browserJavaScriptSchema, BrowserJavaScriptToolResult> = {
	label: "Browser JavaScript",
	name: "browser_javascript",
	description: `Execute JavaScript code in the context of the active browser tab.

Environment: The current page's JavaScript context with full access to:
- The page's DOM (document, window, all elements)
- The page's JavaScript variables and functions
- All web APIs available to the page
- localStorage, sessionStorage, cookies
- Page frameworks (React, Vue, Angular, etc.)
- Can modify the page, read data, interact with page scripts

The code is executed using eval() in the page context, so it can:
- Access and modify global variables
- Call page functions
- Read/write to localStorage, cookies, etc.
- Make fetch requests from the page's origin
- Interact with page frameworks (React, Vue, etc.)

Output:
- console.log() - All output is captured as text
- await returnFile(filename, content, mimeType?) - Create downloadable files for the user (async function!)
  * Always use await with returnFile
  * REQUIRED: For Blob/Uint8Array binary content, you MUST supply a proper MIME type (e.g., "image/png").
    If omitted, throws an Error with stack trace pointing to the offending line.
  * Strings without a MIME default to text/plain.
  * Objects are auto-JSON stringified and default to application/json unless a MIME is provided.
  * Canvas images: Use toBlob() with await Promise wrapper
  * Examples:
    - await returnFile('data.txt', 'Hello World', 'text/plain')
    - await returnFile('data.json', {key: 'value'}, 'application/json')
    - await returnFile('page-screenshot.png', blob, 'image/png')
    - Extract page data to CSV:
      const links = Array.from(document.querySelectorAll('a')).map(a => ({text: a.textContent, href: a.href}));
      const csv = 'text,href\\n' + links.map(l => \`"\${l.text}","\${l.href}"\`).join('\\n');
      await returnFile('links.csv', csv, 'text/csv');
  * You will not have access to the file content, only the filename, mimeType and size.
- NOT CAPTURED: returning values via return or a statement does NOT capture output. Use console.log() or returnFile().

Examples:
- Get page title: document.title
- Get all links: Array.from(document.querySelectorAll('a')).map(a => ({text: a.textContent, href: a.href}))
- Extract all text: document.body.innerText
- Modify page: document.body.style.backgroundColor = 'lightblue'
- Read page data: window.myAppData
- Get cookies: document.cookie
- Execute page functions: window.myPageFunction()
- Access React/Vue instances: window.__REACT_DEVTOOLS_GLOBAL_HOOK__, window.$vm

IMPORTANT - Navigation:
Navigation commands (history.back/forward/go, window.location=, location.href=) destroy the execution context.
You MUST use them in a separate, single-line tool call with NO other code before or after.
Example: First call with just "history.back()", then a second call with other code after navigation completes.

Note: This requires the activeTab permission and only works on http/https pages, not on chrome:// URLs.`,
	parameters: browserJavaScriptSchema,
	execute: async (_toolCallId: string, args: Static<typeof browserJavaScriptSchema>, signal?: AbortSignal) => {
		try {
			// Check if already aborted
			if (signal?.aborted) {
				return {
					output: "Tool execution was aborted",
					isError: true,
					details: { files: [] },
				};
			}

			// Check if code contains navigation that will destroy execution context
			const navigationRegex =
				/\b(window\.location\s*=|location\.href\s*=|history\.(back|forward|go)\s*\(|window\.open\s*\(|document\.location\s*=)/;
			const navigationMatch = args.code.match(navigationRegex);

			// Extract just the navigation command if found
			let navigationCommand: string | null = null;
			if (navigationMatch) {
				// Find the line containing the navigation
				const lines = args.code.split("\n");
				for (const line of lines) {
					if (navigationRegex.test(line)) {
						navigationCommand = line.trim();
						break;
					}
				}
			}

			// If navigation is detected and there's other code around it, reject and ask for split
			if (navigationMatch) {
				const codeWithoutComments = args.code
					.replace(/\/\/.*$/gm, "")
					.replace(/\/\*[\s\S]*?\*\//g, "")
					.trim();
				const codeLines = codeWithoutComments.split("\n").filter((line) => line.trim().length > 0);

				// If there's more than just the navigation line, reject
				if (codeLines.length > 1) {
					return {
						output: `⚠️ Navigation command detected in multi-line code block.

Navigation commands (history.back/forward/go, window.location assignment, etc.) destroy the execution context, so any code before or after them may not execute properly.

Please split this into TWO separate tool calls:

1. First tool call - navigation only:
${navigationCommand}

2. Second tool call - everything else (will run on the new page after navigation completes)

This ensures reliable execution.`,
						isError: true,
						details: { files: [] },
					};
				}
			}

			// Check if scripting API is available
			if (!browser.scripting || !browser.scripting.executeScript) {
				return {
					output:
						"Error: browser.scripting API is not available. Make sure 'scripting' permission is declared in manifest.json",
					isError: true,
					details: { files: [] },
				};
			}

			// Get the active tab
			const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
			if (!tab || !tab.id) {
				return {
					output: "Error: No active tab found",
					isError: true,
					details: { files: [] },
				};
			}

			// Check if we can execute scripts on this tab
			if (
				tab.url?.startsWith("chrome://") ||
				tab.url?.startsWith("chrome-extension://") ||
				tab.url?.startsWith("about:")
			) {
				return {
					output: `Error: Cannot execute scripts on ${tab.url}. Extension pages and internal URLs are protected.`,
					isError: true,
					details: { files: [] },
				};
			}

			// First, detect CSP policy to choose execution strategy
			const cspCheckResults = await browser.scripting.executeScript({
				target: { tabId: tab.id },
				world: "MAIN",
				func: () => {
					// Try to detect if eval is allowed
					let canEval = false;
					try {
						// biome-ignore lint/security/noGlobalEval: CSP detection test
						// biome-ignore lint/complexity/noCommaOperator: indirect eval pattern
						(0, eval)("1");
						canEval = true;
					} catch (e) {
						// eval blocked
					}

					// Try to detect if script tag injection works
					let canUseScriptTag = false;
					const testId = `__test_${Date.now()}`;
					const testScript = document.createElement("script");
					testScript.textContent = `window.${testId} = true;`;
					try {
						document.head.appendChild(testScript);
						// Check if it executed synchronously
						canUseScriptTag = !!(window as any)[testId];
						delete (window as any)[testId];
						testScript.remove();
					} catch (e) {
						// script injection failed
					}

					return { canEval, canUseScriptTag };
				},
			});

			const canUseEval = cspCheckResults[0]?.result?.canEval ?? false;
			const canUseScriptTag = cspCheckResults[0]?.result?.canUseScriptTag ?? false;

			// If neither method works, return error immediately
			if (!canUseEval && !canUseScriptTag) {
				return {
					output:
						"Cannot execute JavaScript on this page. The page's Content Security Policy blocks both eval() and inline script injection. This is common on sites with strict CSP.",
					isError: true,
					details: { files: [] },
				};
			}

			// Execute the JavaScript in the tab context with abort handling
			const executePromise = browser.scripting.executeScript({
				target: { tabId: tab.id },
				world: "MAIN",
				func: (code: string, useScriptTag: boolean) => {
					return new Promise((resolve) => {
						// Capture console output
						const consoleOutput: Array<{ type: string; args: unknown[] }> = [];
						const files: Array<{ fileName: string; content: string | Uint8Array; mimeType: string }> = [];
						let timeoutId: number;

						const originalConsole = {
							log: console.log,
							warn: console.warn,
							error: console.error,
						};

						// Override console methods to capture output
						console.log = (...args: unknown[]) => {
							consoleOutput.push({ type: "log", args });
							originalConsole.log(...args);
						};
						console.warn = (...args: unknown[]) => {
							consoleOutput.push({ type: "warn", args });
							originalConsole.warn(...args);
						};
						console.error = (...args: unknown[]) => {
							consoleOutput.push({ type: "error", args });
							originalConsole.error(...args);
						};

						// Create returnFile function
						(window as any).returnFile = async (
							fileName: string,
							content: string | Uint8Array | Blob | Record<string, unknown>,
							mimeType?: string,
						) => {
							let finalContent: string | Uint8Array;
							let finalMimeType: string;

							if (content instanceof Blob) {
								// Convert Blob to Uint8Array
								const arrayBuffer = await content.arrayBuffer();
								finalContent = new Uint8Array(arrayBuffer);
								finalMimeType = mimeType || content.type || "application/octet-stream";

								// Enforce MIME type requirement for binary data
								if (!mimeType && !content.type) {
									throw new Error(
										`returnFile: MIME type is required for Blob content. Please provide a mimeType parameter (e.g., "image/png").`,
									);
								}
							} else if (content instanceof Uint8Array) {
								finalContent = content;
								if (!mimeType) {
									throw new Error(
										`returnFile: MIME type is required for Uint8Array content. Please provide a mimeType parameter (e.g., "image/png").`,
									);
								}
								finalMimeType = mimeType;
							} else if (typeof content === "string") {
								finalContent = content;
								finalMimeType = mimeType || "text/plain";
							} else {
								// Assume it's an object to be JSON stringified
								finalContent = JSON.stringify(content, null, 2);
								finalMimeType = mimeType || "application/json";
							}

							files.push({
								fileName,
								content: finalContent,
								mimeType: finalMimeType,
							});
						};

						const cleanup = () => {
							// Clear timeout
							if (timeoutId) clearTimeout(timeoutId);

							// Restore console
							console.log = originalConsole.log;
							console.warn = originalConsole.warn;
							console.error = originalConsole.error;

							// Clean up returnFile
							delete (window as any).returnFile;
						};

						const handleError = (error: unknown) => {
							cleanup();
							const err = error as Error;
							resolve({
								success: false,
								error: err.message,
								stack: err.stack,
								console: consoleOutput,
							});
						};

						const handleSuccess = () => {
							cleanup();
							resolve({
								success: true,
								console: consoleOutput,
								files: files,
							});
						};

						// Set timeout to prevent hanging indefinitely
						timeoutId = setTimeout(() => {
							cleanup();
							resolve({
								success: false,
								error: "Execution timeout",
								stack: "Code execution did not complete within 30 seconds",
								console: consoleOutput,
							});
						}, 30000) as unknown as number;

						try {
							if (useScriptTag) {
								// Strategy 2: Inject as script tag (works with 'unsafe-inline' but not Trusted Types)
								const script = document.createElement("script");
								const uniqueId = `__browserjs_${Date.now()}_${Math.random().toString(36).substring(7)}`;

								// Wrap code in async IIFE and attach to window for result handling
								const wrappedCode = `
									(async () => {
										try {
											${code}
											window.${uniqueId} = { success: true };
										} catch (error) {
											window.${uniqueId} = { success: false, error: error.message, stack: error.stack };
										}
									})();
								`;

								script.textContent = wrappedCode;

								// Listen for execution completion
								const checkCompletion = () => {
									const result = (window as any)[uniqueId];
									if (result) {
										delete (window as any)[uniqueId];
										script.remove();

										if (result.success === false) {
											handleError(new Error(result.error));
										} else {
											handleSuccess();
										}
									} else {
										setTimeout(checkCompletion, 100);
									}
								};

								document.head.appendChild(script);
								setTimeout(checkCompletion, 100);
							} else {
								// Strategy 1: Use eval (fastest, but requires 'unsafe-eval' in CSP)
								// Wrap code in async function to support await
								const asyncCode = `(async () => { ${code} })()`;
								// biome-ignore lint/security/noGlobalEval: needed for code execution
								// biome-ignore lint/complexity/noCommaOperator: indirect eval pattern
								const resultPromise = (0, eval)(asyncCode);

								// Wait for async code to complete
								Promise.resolve(resultPromise).then(handleSuccess).catch(handleError);
							}
						} catch (error: unknown) {
							handleError(error);
						}
					});
				},
				args: [args.code, canUseScriptTag && !canUseEval],
			});

			// Race between execution and abort signal
			let results: Awaited<typeof executePromise>;
			if (signal) {
				const abortPromise = new Promise<never>((_, reject) => {
					signal.addEventListener("abort", () => reject(new Error("Aborted")));
				});
				results = await Promise.race([executePromise, abortPromise]);
			} else {
				results = await executePromise;
			}

			const result = results[0]?.result as
				| {
						success: boolean;
						console?: Array<{ type: string; args: unknown[] }>;
						files?: Array<{ fileName: string; content: string | Uint8Array; mimeType: string }>;
						error?: string;
						stack?: string;
				  }
				| undefined;

			if (!result) {
				return {
					output: "Error: No result returned from script execution",
					isError: true,
					details: { files: [] },
				};
			}

			if (!result.success) {
				// Build error output with console logs if any
				let errorOutput = `Error: ${result.error}\n\nStack trace:\n${result.stack || "No stack trace available"}`;

				if (result.console && result.console.length > 0) {
					errorOutput += "\n\nConsole output:\n";
					for (const entry of result.console) {
						const prefix = entry.type === "error" ? "[ERROR]" : entry.type === "warn" ? "[WARN]" : "[LOG]";
						const line = `${prefix} ${entry.args.join(" ")}`;
						errorOutput += line + "\n";
					}
				}

				return {
					output: errorOutput,
					isError: true,
					details: { files: [] },
				};
			}

			// Build output with console logs
			let output = "";

			// Add console output
			if (result.console && result.console.length > 0) {
				for (const entry of result.console) {
					const prefix = entry.type === "error" ? "[ERROR]" : entry.type === "warn" ? "[WARN]" : "";
					const line = prefix ? `${prefix} ${entry.args.join(" ")}` : entry.args.join(" ");
					output += line + "\n";
				}
			}

			// Add file notifications
			if (result.files && result.files.length > 0) {
				output += `\n[Files returned: ${result.files.length}]\n`;
				for (const file of result.files) {
					output += `  - ${file.fileName} (${file.mimeType})\n`;
				}
			}

			// Convert files to base64 for transport
			const files = (result.files || []).map(
				(f: { fileName: string; content: string | Uint8Array; mimeType: string }) => {
					const toBase64 = (input: string | Uint8Array): { base64: string; size: number } => {
						if (input instanceof Uint8Array) {
							let binary = "";
							const chunk = 0x8000;
							for (let i = 0; i < input.length; i += chunk) {
								binary += String.fromCharCode(...input.subarray(i, i + chunk));
							}
							return { base64: btoa(binary), size: input.length };
						} else {
							const enc = new TextEncoder();
							const bytes = enc.encode(input);
							let binary = "";
							const chunk = 0x8000;
							for (let i = 0; i < bytes.length; i += chunk) {
								binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
							}
							return { base64: btoa(binary), size: bytes.length };
						}
					};

					const { base64, size } = toBase64(f.content);
					return {
						fileName: f.fileName || "file",
						mimeType: f.mimeType || "application/octet-stream",
						size,
						contentBase64: base64,
					};
				},
			);

			return {
				output: output.trim() || "Code executed successfully (no output)",
				isError: false,
				details: { files },
			};
		} catch (error: unknown) {
			const err = error as Error;
			// Check if this was an abort
			if (err.message === "Aborted" || signal?.aborted) {
				return {
					output: "Tool execution was aborted by user",
					isError: true,
					details: { files: [] },
				};
			}
			return {
				output: `Error executing script: ${err.message}`,
				isError: true,
				details: { files: [] },
			};
		}
	},
};

// Browser JavaScript renderer
interface BrowserJavaScriptParams {
	code: string;
}

interface BrowserJavaScriptResult {
	files?: Array<{
		fileName: string;
		mimeType: string;
		size: number;
		contentBase64: string;
	}>;
}

export const browserJavaScriptRenderer: ToolRenderer<BrowserJavaScriptParams, BrowserJavaScriptResult> = {
	renderParams(params: BrowserJavaScriptParams, isStreaming?: boolean): TemplateResult {
		if (isStreaming && (!params.code || params.code.length === 0)) {
			return html`<div class="text-sm text-muted-foreground">Writing JavaScript code...</div>`;
		}

		return html`
			<div class="text-sm text-muted-foreground mb-2">Executing in active tab</div>
			<code-block .code=${params.code || ""} language="javascript"></code-block>
		`;
	},

	renderResult(_params: BrowserJavaScriptParams, result: ToolResultMessage<BrowserJavaScriptResult>): TemplateResult {
		const output = result.output || "";
		const files = result.details?.files || [];
		const isError = result.isError === true;

		const attachments: Attachment[] = files.map((f, i) => {
			// Decode base64 content for text files to show in overlay
			let extractedText: string | undefined;
			const isTextBased =
				f.mimeType?.startsWith("text/") ||
				f.mimeType === "application/json" ||
				f.mimeType === "application/javascript" ||
				f.mimeType?.includes("xml");

			if (isTextBased && f.contentBase64) {
				try {
					extractedText = atob(f.contentBase64);
				} catch (e) {
					console.warn("Failed to decode base64 content for", f.fileName);
				}
			}

			return {
				id: `browser-js-${Date.now()}-${i}`,
				type: f.mimeType?.startsWith("image/") ? "image" : "document",
				fileName: f.fileName || `file-${i}`,
				mimeType: f.mimeType || "application/octet-stream",
				size: f.size ?? 0,
				content: f.contentBase64,
				preview: f.mimeType?.startsWith("image/") ? f.contentBase64 : undefined,
				extractedText,
			};
		});

		if (isError) {
			return html`
				<div class="text-sm">
					<div class="text-destructive font-medium mb-1">Execution failed:</div>
					<pre class="text-xs font-mono text-destructive bg-destructive/10 p-2 rounded overflow-x-auto">${output}</pre>
				</div>
			`;
		}

		return html`
			<div class="flex flex-col gap-3">
				${output ? html`<console-block .content=${output}></console-block>` : ""}
				${
					attachments.length
						? html`<div class="flex flex-wrap gap-2">
							${attachments.map((att) => html`<attachment-tile .attachment=${att}></attachment-tile>`)}
						</div>`
						: ""
				}
			</div>
		`;
	},
};

// Auto-register the renderer
registerToolRenderer(browserJavaScriptTool.name, browserJavaScriptRenderer);
