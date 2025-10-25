import { html } from "@mariozechner/mini-lit";
import type { AgentTool, ToolResultMessage } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import { createRef, ref } from "lit/directives/ref.js";
import { FileText } from "lucide";
import { EXTRACT_DOCUMENT_DESCRIPTION } from "../prompts/prompts.js";
import { loadAttachment } from "../utils/attachment-utils.js";
import { registerToolRenderer, renderCollapsibleHeader, renderHeader } from "./renderer-registry.js";
import type { ToolRenderer, ToolRenderResult } from "./types.js";

// ============================================================================
// TYPES
// ============================================================================

const extractDocumentSchema = Type.Object({
	url: Type.String({
		description: "URL of the document to extract text from (PDF, DOCX, XLSX, or PPTX)",
	}),
});

export type ExtractDocumentParams = Static<typeof extractDocumentSchema>;

export interface ExtractDocumentResult {
	extractedText: string;
	format: string;
	fileName: string;
	size: number;
}

// ============================================================================
// TOOL
// ============================================================================

export function createExtractDocumentTool(): AgentTool<typeof extractDocumentSchema, ExtractDocumentResult> & {
	corsProxyUrl?: string;
} {
	return {
		label: "Extract Document",
		name: "extract_document",
		corsProxyUrl: undefined, // Can be set by consumer (e.g., from user settings)
		description: EXTRACT_DOCUMENT_DESCRIPTION,
		parameters: extractDocumentSchema,
		execute: async function (_toolCallId: string, args: ExtractDocumentParams, signal?: AbortSignal) {
			if (signal?.aborted) {
				throw new Error("Extract document aborted");
			}

			const url = args.url.trim();
			if (!url) {
				throw new Error("URL is required");
			}

			// Validate URL format
			try {
				new URL(url);
			} catch {
				throw new Error(`Invalid URL: ${url}`);
			}

			// Determine fetch URL (with or without CORS proxy)
			let fetchUrl = url;
			if (this.corsProxyUrl) {
				fetchUrl = this.corsProxyUrl + encodeURIComponent(url);
			}

			// Size limit: 50MB
			const MAX_SIZE = 50 * 1024 * 1024;

			try {
				// Attempt to fetch the document
				const response = await fetch(fetchUrl, { signal });

				if (!response.ok) {
					throw new Error(
						`TELL USER: Unable to download the document (${response.status} ${response.statusText}). The site likely blocks automated downloads.\n\n` +
							`INSTRUCT USER: Please download the file manually and attach it to your message using the attachment button (paperclip icon) in the message input area. I can then extract the text from the attached file.`,
					);
				}

				// Check size before downloading
				const contentLength = response.headers.get("content-length");
				if (contentLength) {
					const size = Number.parseInt(contentLength, 10);
					if (size > MAX_SIZE) {
						throw new Error(
							`Document is too large (${(size / 1024 / 1024).toFixed(1)}MB). Maximum supported size is 50MB.`,
						);
					}
				}

				// Download the document
				const arrayBuffer = await response.arrayBuffer();
				const size = arrayBuffer.byteLength;

				if (size > MAX_SIZE) {
					throw new Error(
						`Document is too large (${(size / 1024 / 1024).toFixed(1)}MB). Maximum supported size is 50MB.`,
					);
				}

				// Extract filename from URL
				const urlParts = url.split("/");
				let fileName = urlParts[urlParts.length - 1]?.split("?")[0] || "document";
				if (url.startsWith("https://arxiv.org/")) {
					fileName = fileName + ".pdf";
				}

				// Use loadAttachment to process the document
				const attachment = await loadAttachment(arrayBuffer, fileName);

				if (!attachment.extractedText) {
					const mimeType = response.headers.get("content-type") || "unknown";
					throw new Error(
						`Document format not supported. Supported formats:\n` +
							`- PDF (.pdf)\n` +
							`- Word (.docx)\n` +
							`- Excel (.xlsx, .xls)\n` +
							`- PowerPoint (.pptx)\n\n` +
							`Detected: ${mimeType}`,
					);
				}

				// Determine format from attachment
				let format = "unknown";
				if (attachment.mimeType.includes("pdf")) {
					format = "pdf";
				} else if (attachment.mimeType.includes("wordprocessingml")) {
					format = "docx";
				} else if (attachment.mimeType.includes("spreadsheetml") || attachment.mimeType.includes("ms-excel")) {
					format = "xlsx";
				} else if (attachment.mimeType.includes("presentationml")) {
					format = "pptx";
				}

				return {
					output: attachment.extractedText,
					details: {
						extractedText: attachment.extractedText,
						format,
						fileName: attachment.fileName,
						size: attachment.size,
					},
				};
			} catch (error: any) {
				// Handle CORS errors specifically
				if (error.name === "TypeError" && error.message.includes("Failed to fetch")) {
					throw new Error(
						`TELL USER: Unable to fetch the document due to CORS restrictions (the server blocks requests from browser extensions).\n\n` +
							`To fix this, you need to configure a CORS proxy in Sitegeist settings:\n` +
							`1. Open Sitegeist settings\n` +
							`2. Find "CORS Proxy URL" setting\n` +
							`3. Enter a proxy URL like: https://corsproxy.io/?\n` +
							`4. Save and try again\n\n` +
							`Would you like me to explain what a CORS proxy is and how to set one up?`,
					);
				}

				// Re-throw other errors
				throw error;
			}
		},
	};
}

// Export a default instance
export const extractDocumentTool = createExtractDocumentTool();

// ============================================================================
// RENDERER
// ============================================================================

export const extractDocumentRenderer: ToolRenderer<ExtractDocumentParams, ExtractDocumentResult> = {
	render(
		params: ExtractDocumentParams | undefined,
		result: ToolResultMessage<ExtractDocumentResult> | undefined,
		isStreaming?: boolean,
	): ToolRenderResult {
		// Determine status
		const state = result ? (result.isError ? "error" : "complete") : isStreaming ? "inprogress" : "complete";

		// Create refs for collapsible sections
		const contentRef = createRef<HTMLDivElement>();
		const chevronRef = createRef<HTMLSpanElement>();

		// With result: show params + result
		if (result && params) {
			const details = result.details;
			const title = details
				? result.isError
					? `Failed to extract ${details.fileName || "document"}`
					: `Extracted text from ${details.fileName} (${details.format.toUpperCase()}, ${(details.size / 1024).toFixed(1)}KB)`
				: result.isError
					? "Failed to extract document"
					: "Extracted text from document";

			const output = result.output || "";

			return {
				content: html`
					<div>
						${renderCollapsibleHeader(state, FileText, title, contentRef, chevronRef, false)}
						<div ${ref(contentRef)} class="max-h-0 overflow-hidden transition-all duration-300 space-y-3">
							${
								params.url
									? html`<div class="text-sm text-gray-600 dark:text-gray-400">
										<strong>URL:</strong> ${params.url}
								  </div>`
									: ""
							}
							${
								output && !result.isError
									? html`<code-block .code=${output} language="plaintext"></code-block>`
									: ""
							}
							${
								result.isError && output
									? html`<console-block .content=${output} .variant="error"></console-block>`
									: ""
							}
						</div>
					</div>
				`,
				isCustom: false,
			};
		}

		// Just params (streaming or waiting for result)
		if (params) {
			const title = "Extracting document...";

			return {
				content: html`
					<div>
						${renderCollapsibleHeader(state, FileText, title, contentRef, chevronRef, false)}
						<div ${ref(contentRef)} class="max-h-0 overflow-hidden transition-all duration-300">
							<div class="text-sm text-gray-600 dark:text-gray-400"><strong>URL:</strong> ${params.url}</div>
						</div>
					</div>
				`,
				isCustom: false,
			};
		}

		// No params or result yet
		return {
			content: renderHeader(state, FileText, "Preparing extraction..."),
			isCustom: false,
		};
	},
};

// Auto-register the renderer
registerToolRenderer("extract_document", extractDocumentRenderer);
