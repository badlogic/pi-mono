import { Diff, html, type TemplateResult } from "@mariozechner/mini-lit";
import "@mariozechner/mini-lit/dist/CodeBlock.js";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { FileCode2 } from "lucide";
import "../../components/ConsoleBlock.js";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
import type { ToolRenderer } from "../types.js";
import type { ArtifactsParams } from "./artifacts.js";

// Helper to determine language for syntax highlighting
function getLanguageFromFilename(filename?: string): string {
	if (!filename) return "text";
	const ext = filename.split(".").pop()?.toLowerCase();
	const languageMap: Record<string, string> = {
		js: "javascript",
		jsx: "javascript",
		ts: "typescript",
		tsx: "typescript",
		html: "html",
		css: "css",
		scss: "scss",
		json: "json",
		py: "python",
		md: "markdown",
		svg: "xml",
		xml: "xml",
		yaml: "yaml",
		yml: "yaml",
		sh: "bash",
		bash: "bash",
		sql: "sql",
		java: "java",
		c: "c",
		cpp: "cpp",
		cs: "csharp",
		go: "go",
		rs: "rust",
		php: "php",
		rb: "ruby",
		swift: "swift",
		kt: "kotlin",
		r: "r",
	};
	return languageMap[ext || ""] || "text";
}

export class ArtifactsToolRenderer implements ToolRenderer<ArtifactsParams, undefined> {
	render(
		params: ArtifactsParams | undefined,
		result: ToolResultMessage<undefined> | undefined,
		isStreaming?: boolean,
	): TemplateResult {
		const state = result ? (result.isError ? "error" : "complete") : "inprogress";

		// Helper to get command labels
		const getCommandLabels = (command: string): { streaming: string; complete: string } => {
			const labels: Record<string, { streaming: string; complete: string }> = {
				create: { streaming: i18n("Creating artifact"), complete: i18n("Created artifact") },
				update: { streaming: i18n("Updating artifact"), complete: i18n("Updated artifact") },
				rewrite: { streaming: i18n("Rewriting artifact"), complete: i18n("Rewrote artifact") },
				get: { streaming: i18n("Getting artifact"), complete: i18n("Got artifact") },
				delete: { streaming: i18n("Deleting artifact"), complete: i18n("Deleted artifact") },
				logs: { streaming: i18n("Getting logs"), complete: i18n("Got logs") },
			};
			return labels[command] || { streaming: i18n("Processing artifact"), complete: i18n("Processed artifact") };
		};

		// Error handling
		if (result?.isError) {
			const command = params?.command;
			const filename = params?.filename;
			const labels = command
				? getCommandLabels(command)
				: { streaming: i18n("Processing artifact"), complete: i18n("Processed artifact") };
			const headerText = filename ? `${labels.streaming} ${filename}` : labels.streaming;

			// For create/update/rewrite errors, show code block + console/error
			if (command === "create" || command === "update" || command === "rewrite") {
				const content = command === "update" ? params?.new_str || params?.old_str || "" : params?.content || "";

				const isHtml = filename?.endsWith(".html");

				return html`
					<div class="space-y-3">
						${renderHeader(state, FileCode2, headerText)}
						${content ? html`<code-block .code=${content} language=${getLanguageFromFilename(filename)}></code-block>` : ""}
						${
							isHtml
								? html`<console-block .content=${result.output || i18n("An error occurred")} variant="error"></console-block>`
								: html`<div class="text-sm text-destructive">${result.output || i18n("An error occurred")}</div>`
						}
					</div>
				`;
			}

			// For other errors, just show error message
			return html`
				<div class="space-y-3">
					${renderHeader(state, FileCode2, headerText)}
					<div class="text-sm text-destructive">${result.output || i18n("An error occurred")}</div>
				</div>
			`;
		}

		// Full params + result
		if (result && params) {
			const { command, filename, content } = params;
			const labels = command
				? getCommandLabels(command)
				: { streaming: i18n("Processing artifact"), complete: i18n("Processed artifact") };
			const headerText = filename ? `${labels.complete} ${filename}` : labels.complete;

			// GET command: show code block with file content
			if (command === "get") {
				const fileContent = result.output || i18n("(no output)");
				return html`
					<div class="space-y-3">
						${renderHeader(state, FileCode2, headerText)}
						<code-block .code=${fileContent} language=${getLanguageFromFilename(filename)}></code-block>
					</div>
				`;
			}

			// LOGS command: show console block
			if (command === "logs") {
				const logs = result.output || i18n("(no output)");
				return html`
					<div class="space-y-3">
						${renderHeader(state, FileCode2, headerText)}
						<console-block .content=${logs}></console-block>
					</div>
				`;
			}

			// CREATE/UPDATE/REWRITE: always show code block, + console block for .html files
			if (command === "create" || command === "update" || command === "rewrite") {
				const codeContent = content || "";
				const isHtml = filename?.endsWith(".html");
				const logs = result.output || "";

				return html`
					<div class="space-y-3">
						${renderHeader(state, FileCode2, headerText)}
						${codeContent ? html`<code-block .code=${codeContent} language=${getLanguageFromFilename(filename)}></code-block>` : ""}
						${isHtml && logs ? html`<console-block .content=${logs}></console-block>` : ""}
					</div>
				`;
			}

			// For DELETE, just show header
			return html`
				<div class="space-y-3">
					${renderHeader(state, FileCode2, headerText)}
				</div>
			`;
		}

		// Params only (streaming or waiting for result)
		if (params) {
			const { command, filename, content, old_str, new_str } = params;

			// If no command yet
			if (!command) {
				return renderHeader(state, FileCode2, i18n("Preparing artifact..."));
			}

			const labels = getCommandLabels(command);
			const headerText = filename ? `${labels.streaming} ${filename}` : labels.streaming;

			// Render based on command type
			switch (command) {
				case "create":
				case "rewrite":
					return html`
						<div class="space-y-3">
							${renderHeader(state, FileCode2, headerText)}
							${
								content
									? html`<code-block .code=${content} language=${getLanguageFromFilename(filename)} class="mt-2"></code-block>`
									: ""
							}
						</div>
					`;

				case "update":
					return html`
						<div class="space-y-3">
							${renderHeader(state, FileCode2, headerText)}
							${
								old_str !== undefined && new_str !== undefined
									? Diff({ oldText: old_str, newText: new_str, className: "mt-2" })
									: ""
							}
						</div>
					`;

				case "get":
				case "delete":
				case "logs":
				default:
					return renderHeader(state, FileCode2, headerText);
			}
		}

		// No params or result yet
		return renderHeader(state, FileCode2, i18n("Preparing artifact..."));
	}
}
