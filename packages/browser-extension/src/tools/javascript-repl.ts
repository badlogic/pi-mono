import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { AgentTool, ToolResultMessage } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import type { Attachment } from "../utils/attachment-utils.js";

import { registerToolRenderer } from "./renderer-registry.js";
import type { ToolRenderer } from "./types.js";
import "../ConsoleBlock.js"; // Ensure console-block is registered

// Core JavaScript REPL execution logic without UI dependencies
export interface ReplExecuteResult {
	success: boolean;
	console?: Array<{ type: string; args: any[] }>;
	files?: Array<{ fileName: string; content: string | Uint8Array; mimeType: string }>;
	error?: { message: string; stack: string };
}

export class ReplExecutor {
	private iframe: HTMLIFrameElement;
	private ready: boolean = false;
	private attachments: any[] = [];
	// biome-ignore lint/complexity/noBannedTypes: fine here
	private currentExecution: { resolve: Function; reject: Function } | null = null;

	constructor(attachments: any[]) {
		this.attachments = attachments;
		this.iframe = this.createIframe();
		this.setupMessageHandler();
		this.initialize();
	}

	private createIframe(): HTMLIFrameElement {
		const iframe = document.createElement("iframe");
		// Use the sandboxed page from the manifest
		iframe.src = chrome.runtime.getURL("sandbox.html");
		iframe.style.display = "none";
		document.body.appendChild(iframe);
		return iframe;
	}

	private setupMessageHandler() {
		const handler = (event: MessageEvent) => {
			if (event.source !== this.iframe.contentWindow) return;

			if (event.data.type === "ready") {
				this.ready = true;
			} else if (event.data.type === "result" && this.currentExecution) {
				const { resolve } = this.currentExecution;
				this.currentExecution = null;
				resolve(event.data);
				this.cleanup();
			} else if (event.data.type === "error" && this.currentExecution) {
				const { resolve } = this.currentExecution;
				this.currentExecution = null;
				resolve({
					success: false,
					error: event.data.error,
					console: event.data.console || [],
				});
				this.cleanup();
			}
		};

		window.addEventListener("message", handler);
		// Store handler reference for cleanup
		(this.iframe as any).__messageHandler = handler;
	}

	private initialize() {
		// Send attachments once iframe is loaded
		this.iframe.onload = () => {
			setTimeout(() => {
				this.iframe.contentWindow?.postMessage(
					{
						type: "setAttachments",
						attachments: this.attachments,
					},
					"*",
				);
			}, 100);
		};
	}

	cleanup() {
		// Remove message handler
		const handler = (this.iframe as any).__messageHandler;
		if (handler) {
			window.removeEventListener("message", handler);
		}
		// Remove iframe
		this.iframe.remove();

		// If there's a pending execution, reject it
		if (this.currentExecution) {
			this.currentExecution.reject(new Error("Execution aborted"));
			this.currentExecution = null;
		}
	}

	async execute(code: string): Promise<ReplExecuteResult> {
		return new Promise((resolve, reject) => {
			this.currentExecution = { resolve, reject };

			// Wait for iframe to be ready
			const checkReady = () => {
				if (this.ready) {
					this.iframe.contentWindow?.postMessage(
						{
							type: "execute",
							code: code,
						},
						"*",
					);
				} else {
					setTimeout(checkReady, 10);
				}
			};
			checkReady();

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.currentExecution?.resolve === resolve) {
					this.currentExecution = null;
					resolve({
						success: false,
						error: { message: "Execution timeout (30s)", stack: "" },
					});
					this.cleanup();
				}
			}, 30000);
		});
	}
}

// Execute JavaScript code with attachments
export async function executeJavaScript(
	code: string,
	attachments: any[] = [],
	signal?: AbortSignal,
): Promise<{ output: string; files?: Array<{ fileName: string; content: any; mimeType: string }> }> {
	if (!code) {
		throw new Error("Code parameter is required");
	}

	// Check for abort before starting
	if (signal?.aborted) {
		throw new Error("Execution aborted");
	}

	// Create a one-shot executor
	const executor = new ReplExecutor(attachments);

	// Listen for abort signal
	const abortHandler = () => {
		executor.cleanup();
	};
	signal?.addEventListener("abort", abortHandler);

	try {
		const result = await executor.execute(code);

		// Return plain text output
		if (!result.success) {
			// Return error as plain text
			return {
				output: `${"Error:"} ${result.error?.message || "Unknown error"}\n${result.error?.stack || ""}`,
			};
		}

		// Build plain text response
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
		} else {
			// Explicitly note when no files were returned (helpful for debugging)
			if (code.includes("returnFile")) {
				output += "\n[No files returned - check async operations]";
			}
		}

		return {
			output: output.trim() || "Code executed successfully (no output)",
			files: result.files,
		};
	} catch (error: any) {
		throw new Error(error.message || "Execution failed");
	} finally {
		signal?.removeEventListener("abort", abortHandler);
	}
}

export type JavaScriptReplToolResult = {
	files?:
		| {
				fileName: string;
				contentBase64: any;
				mimeType: string;
		  }[]
		| undefined;
};

const javascriptReplSchema = Type.Object({
	code: Type.String({ description: "JavaScript code to execute" }),
});

export function createJavaScriptReplTool(): AgentTool<typeof javascriptReplSchema, JavaScriptReplToolResult> & {
	attachmentsProvider?: () => any[];
} {
	return {
		label: "JavaScript REPL",
		name: "javascript_repl",
		attachmentsProvider: () => [], // default to empty array
		description: `Execute JavaScript code in a sandboxed browser environment with full modern browser capabilities.

Environment: Modern browser with ALL Web APIs available:
- ES2023+ JavaScript (async/await, optional chaining, nullish coalescing, etc.)
- DOM APIs (document, window, Canvas, WebGL, etc.)
- Fetch API for HTTP requests

Loading external libraries via dynamic imports (use esm.run):
- XLSX (Excel files): const XLSX = await import('https://esm.run/xlsx');
- Papa Parse (CSV): const Papa = (await import('https://esm.run/papaparse')).default;
- Lodash: const _ = await import('https://esm.run/lodash-es');
- D3.js: const d3 = await import('https://esm.run/d3');
- Chart.js: const Chart = (await import('https://esm.run/chart.js/auto')).default;
- Three.js: const THREE = await import('https://esm.run/three');
- Any npm package: await import('https://esm.run/package-name')

IMPORTANT for graphics/canvas:
- Use fixed dimensions like 400x400 or 800x600, NOT window.innerWidth/Height
- For Three.js: renderer.setSize(400, 400) and camera aspect ratio of 1
- For Chart.js: Set options: { responsive: false, animation: false } to ensure immediate rendering
- Web Storage (localStorage, sessionStorage, IndexedDB)
- Web Workers, WebAssembly, WebSockets
- Media APIs (Audio, Video, WebRTC)
- File APIs (Blob, FileReader, etc.)
- Crypto API for cryptography
- And much more - anything a modern browser supports!

Output:
- console.log() - All output is captured as text
- await returnFile(filename, content, mimeType?) - Create downloadable files (async function!)
  * Always use await with returnFile
  * REQUIRED: For Blob/Uint8Array binary content, you MUST supply a proper MIME type (e.g., "image/png").
    If omitted, the REPL throws an Error with stack trace pointing to the offending line.
  * Strings without a MIME default to text/plain.
  * Objects are auto-JSON stringified and default to application/json unless a MIME is provided.
  * Canvas images: Use toBlob() with await Promise wrapper
  * Examples:
    - await returnFile('data.txt', 'Hello World', 'text/plain')
    - await returnFile('data.json', {key: 'value'}, 'application/json')
    - await returnFile('data.csv', 'name,age\\nJohn,30', 'text/csv')
    - Chart.js example:
      const Chart = (await import('https://esm.run/chart.js/auto')).default;
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 300;
      document.body.appendChild(canvas);
      new Chart(canvas, {
        type: 'line',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr'],
          datasets: [{ label: 'Sales', data: [10, 20, 15, 25], borderColor: 'blue' }]
        },
        options: { responsive: false, animation: false }
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await returnFile('chart.png', blob, 'image/png');

Global variables:
- attachments[] - Array of attachment objects from user messages
  * Properties:
    - id: string (unique identifier)
    - fileName: string (e.g., "data.xlsx")
    - mimeType: string (e.g., "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    - size: number (bytes)
  * Helper functions:
    - listFiles() - Returns array of {id, fileName, mimeType, size} for all attachments
    - readTextFile(attachmentId) - Returns text content of attachment (for CSV, JSON, text files)
    - readBinaryFile(attachmentId) - Returns Uint8Array of binary data (for images, Excel, etc.)
  * Examples:
    - const files = listFiles();
    - const csvContent = readTextFile(files[0].id); // Read CSV as text
    - const xlsxBytes = readBinaryFile(files[0].id); // Read Excel as binary
- All standard browser globals (window, document, fetch, etc.)`,
		parameters: javascriptReplSchema,
		execute: async function (_toolCallId: string, args: Static<typeof javascriptReplSchema>, signal?: AbortSignal) {
			const attachments = this.attachmentsProvider?.() || [];
			const result = await executeJavaScript(args.code, attachments, signal);
			// Convert files to JSON-serializable with base64 payloads
			const files = (result.files || []).map((f) => {
				const toBase64 = (input: any): { base64: string; size: number } => {
					if (input instanceof Uint8Array) {
						let binary = "";
						const chunk = 0x8000;
						for (let i = 0; i < input.length; i += chunk) {
							binary += String.fromCharCode(...input.subarray(i, i + chunk));
						}
						return { base64: btoa(binary), size: input.length };
					} else if (typeof input === "string") {
						const enc = new TextEncoder();
						const bytes = enc.encode(input);
						let binary = "";
						const chunk = 0x8000;
						for (let i = 0; i < bytes.length; i += chunk) {
							binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
						}
						return { base64: btoa(binary), size: bytes.length };
					} else {
						const s = String(input);
						const enc = new TextEncoder();
						const bytes = enc.encode(s);
						let binary = "";
						const chunk = 0x8000;
						for (let i = 0; i < bytes.length; i += chunk) {
							binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
						}
						return { base64: btoa(binary), size: bytes.length };
					}
				};

				const { base64, size } = toBase64((f as any).content);
				return {
					fileName: (f as any).fileName || "file",
					mimeType: (f as any).mimeType || "application/octet-stream",
					size,
					contentBase64: base64,
				};
			});
			return { output: result.output, details: { files } };
		},
	};
}

// Export a default instance for backward compatibility
export const javascriptReplTool = createJavaScriptReplTool();

// JavaScript REPL renderer with streaming support

interface JavaScriptReplParams {
	code: string;
}

interface JavaScriptReplResult {
	output?: string;
	files?: Array<{
		fileName: string;
		mimeType: string;
		size: number;
		contentBase64: string;
	}>;
}

export const javascriptReplRenderer: ToolRenderer<JavaScriptReplParams, JavaScriptReplResult> = {
	renderParams(params: JavaScriptReplParams, isStreaming?: boolean): TemplateResult {
		if (isStreaming && (!params.code || params.code.length === 0)) {
			return html`<div class="text-sm text-muted-foreground">${"Writing JavaScript code..."}</div>`;
		}

		return html`
			<div class="text-sm text-muted-foreground mb-2">${"Executing JavaScript"}</div>
			<code-block .code=${params.code || ""} language="javascript"></code-block>
		`;
	},

	renderResult(_params: JavaScriptReplParams, result: ToolResultMessage<JavaScriptReplResult>): TemplateResult {
		// Console output is in the main output field, files are in details
		const output = result.output || "";
		const files = result.details?.files || [];

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
				id: `repl-${Date.now()}-${i}`,
				type: f.mimeType?.startsWith("image/") ? "image" : "document",
				fileName: f.fileName || `file-${i}`,
				mimeType: f.mimeType || "application/octet-stream",
				size: f.size ?? 0,
				content: f.contentBase64,
				preview: f.mimeType?.startsWith("image/") ? f.contentBase64 : undefined,
				extractedText,
			};
		});

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
registerToolRenderer(javascriptReplTool.name, javascriptReplRenderer);
