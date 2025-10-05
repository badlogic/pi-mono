import { Button, Diff, icon } from "@mariozechner/mini-lit";
import { type AgentTool, type Message, StringEnum, type ToolCall, type ToolResultMessage } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { X } from "lucide";
import type { Attachment } from "../../utils/attachment-utils.js";
import { i18n } from "../../utils/i18n.js";
import type { ToolRenderer } from "../types.js";
import type { ArtifactElement } from "./ArtifactElement.js";
import { HtmlArtifact } from "./HtmlArtifact.js";
import { MarkdownArtifact } from "./MarkdownArtifact.js";
import { SvgArtifact } from "./SvgArtifact.js";
import { TextArtifact } from "./TextArtifact.js";
import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import "@mariozechner/mini-lit/dist/CodeBlock.js";

// Simple artifact model
export interface Artifact {
	filename: string;
	title: string;
	content: string;
	createdAt: Date;
	updatedAt: Date;
}

// JSON-schema friendly parameters object (LLM-facing)
const artifactsParamsSchema = Type.Object({
	command: StringEnum(["create", "update", "rewrite", "get", "delete", "logs"], {
		description: "The operation to perform",
	}),
	filename: Type.String({ description: "Filename including extension (e.g., 'index.html', 'script.js')" }),
	title: Type.Optional(Type.String({ description: "Display title for the tab (defaults to filename)" })),
	content: Type.Optional(Type.String({ description: "File content" })),
	old_str: Type.Optional(Type.String({ description: "String to replace (for update command)" })),
	new_str: Type.Optional(Type.String({ description: "Replacement string (for update command)" })),
});
export type ArtifactsParams = Static<typeof artifactsParamsSchema>;

// Minimal helper to render plain text outputs consistently
function plainOutput(text: string): TemplateResult {
	return html`<div class="text-xs text-muted-foreground whitespace-pre-wrap font-mono">${text}</div>`;
}

@customElement("artifacts-panel")
export class ArtifactsPanel extends LitElement implements ToolRenderer<ArtifactsParams, undefined> {
	@state() private _artifacts = new Map<string, Artifact>();
	@state() private _activeFilename: string | null = null;

	// Programmatically managed artifact elements
	private artifactElements = new Map<string, ArtifactElement>();
	private contentRef: Ref<HTMLDivElement> = createRef();

	// External provider for attachments (decouples panel from AgentInterface)
	@property({ attribute: false }) attachmentsProvider?: () => Attachment[];
	// Sandbox URL provider for browser extensions (optional)
	@property({ attribute: false }) sandboxUrlProvider?: () => string;
	// Callbacks
	@property({ attribute: false }) onArtifactsChange?: () => void;
	@property({ attribute: false }) onClose?: () => void;
	@property({ attribute: false }) onOpen?: () => void;
	// Collapsed mode: hides panel content but can show a floating reopen pill
	@property({ type: Boolean }) collapsed = false;
	// Overlay mode: when true, panel renders full-screen overlay (mobile)
	@property({ type: Boolean }) overlay = false;

	// Public getter for artifacts
	get artifacts() {
		return this._artifacts;
	}

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this; // light DOM for shared styles
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
		this.style.height = "100%";
		// Reattach existing artifact elements when panel is re-inserted into the DOM
		requestAnimationFrame(() => {
			const container = this.contentRef.value;
			if (!container) return;
			// Ensure we have an active filename
			if (!this._activeFilename && this._artifacts.size > 0) {
				this._activeFilename = Array.from(this._artifacts.keys())[0];
			}
			this.artifactElements.forEach((element, name) => {
				if (!element.parentElement) container.appendChild(element);
				element.style.display = name === this._activeFilename ? "block" : "none";
			});
		});
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		// Do not tear down artifact elements; keep them to restore on next mount
	}

	// Helper to determine file type from extension
	private getFileType(filename: string): "html" | "svg" | "markdown" | "text" {
		const ext = filename.split(".").pop()?.toLowerCase();
		if (ext === "html") return "html";
		if (ext === "svg") return "svg";
		if (ext === "md" || ext === "markdown") return "markdown";
		return "text";
	}

	// Helper to determine language for syntax highlighting
	private getLanguageFromFilename(filename?: string): string {
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

	// Get or create artifact element
	private getOrCreateArtifactElement(filename: string, content: string, title: string): ArtifactElement {
		let element = this.artifactElements.get(filename);

		if (!element) {
			const type = this.getFileType(filename);
			if (type === "html") {
				element = new HtmlArtifact();
				(element as HtmlArtifact).attachments = this.attachmentsProvider?.() || [];
				if (this.sandboxUrlProvider) {
					(element as HtmlArtifact).sandboxUrlProvider = this.sandboxUrlProvider;
				}
			} else if (type === "svg") {
				element = new SvgArtifact();
			} else if (type === "markdown") {
				element = new MarkdownArtifact();
			} else {
				element = new TextArtifact();
			}
			element.filename = filename;
			element.displayTitle = title;
			element.content = content;
			element.style.display = "none";
			element.style.height = "100%";

			// Store element
			this.artifactElements.set(filename, element);

			// Add to DOM - try immediately if container exists, otherwise schedule
			const newElement = element;
			if (this.contentRef.value) {
				this.contentRef.value.appendChild(newElement);
			} else {
				requestAnimationFrame(() => {
					if (this.contentRef.value && !newElement.parentElement) {
						this.contentRef.value.appendChild(newElement);
					}
				});
			}
		} else {
			// Just update content
			element.content = content;
			element.displayTitle = title;
			if (element instanceof HtmlArtifact) {
				element.attachments = this.attachmentsProvider?.() || [];
			}
		}

		return element;
	}

	// Show/hide artifact elements
	private showArtifact(filename: string) {
		// Ensure the active element is in the DOM
		requestAnimationFrame(() => {
			this.artifactElements.forEach((element, name) => {
				if (this.contentRef.value && !element.parentElement) {
					this.contentRef.value.appendChild(element);
				}
				element.style.display = name === filename ? "block" : "none";
			});
		});
		this._activeFilename = filename;
		this.requestUpdate(); // Only for tab bar update
	}

	// Open panel and focus an artifact tab by filename
	private openArtifact(filename: string) {
		if (this._artifacts.has(filename)) {
			this.showArtifact(filename);
			// Ask host to open panel (AgentInterface demo listens to onOpen)
			this.onOpen?.();
		}
	}

	// Build the AgentTool (no details payload; return only output strings)
	public get tool(): AgentTool<typeof artifactsParamsSchema, undefined> {
		return {
			label: "Artifacts",
			name: "artifacts",
			description: `Creates and manages file artifacts. Each artifact is a file with a filename and content.

IMPORTANT: Always prefer updating existing files over creating new ones. Check available files first.

Commands:
1. create: Create a new file
   - filename: Name with extension (required, e.g., 'index.html', 'script.js', 'README.md')
   - title: Display name for the tab (optional, defaults to filename)
   - content: File content (required)

2. update: Update part of an existing file
   - filename: File to update (required)
   - old_str: Exact string to replace (required)
   - new_str: Replacement string (required)

3. rewrite: Completely replace a file's content
   - filename: File to rewrite (required)
   - content: New content (required)
   - title: Optionally update display title

4. get: Retrieve the full content of a file
   - filename: File to retrieve (required)
   - Returns the complete file content

5. delete: Delete a file
   - filename: File to delete (required)

6. logs: Get console logs and errors (HTML files only)
   - filename: HTML file to get logs for (required)
   - Returns all console output and runtime errors

For text/html artifacts with attachments:
- HTML artifacts automatically have access to user attachments via JavaScript
- Available global functions in HTML artifacts:
  * listFiles() - Returns array of {id, fileName, mimeType, size} for all attachments
  * readTextFile(attachmentId) - Returns text content of attachment (for CSV, JSON, text files)
  * readBinaryFile(attachmentId) - Returns Uint8Array of binary data (for images, Excel, etc.)
- Example HTML artifact that processes a CSV attachment:
  <script>
    // List available files
    const files = listFiles();
    console.log('Available files:', files);

    // Find CSV file
    const csvFile = files.find(f => f.mimeType === 'text/csv');
    if (csvFile) {
      const csvContent = readTextFile(csvFile.id);
      // Process CSV data...
    }

    // Display image
    const imageFile = files.find(f => f.mimeType.startsWith('image/'));
    if (imageFile) {
      const bytes = readBinaryFile(imageFile.id);
      const blob = new Blob([bytes], {type: imageFile.mimeType});
      const url = URL.createObjectURL(blob);
      document.body.innerHTML = '<img src="' + url + '">';
    }
  </script>

For text/html artifacts:
- Must be a single self-contained file
- External scripts: Use CDNs like https://esm.sh, https://unpkg.com, or https://cdnjs.cloudflare.com
- Preferred: Use https://esm.sh for npm packages (e.g., https://esm.sh/three for Three.js)
- For ES modules, use: <script type="module">import * as THREE from 'https://esm.sh/three';</script>
- For Three.js specifically: import from 'https://esm.sh/three' or 'https://esm.sh/three@0.160.0'
- For addons: import from 'https://esm.sh/three/examples/jsm/controls/OrbitControls.js'
- No localStorage/sessionStorage - use in-memory variables only
- CSS should be included inline
- CRITICAL REMINDER FOR HTML ARTIFACTS:
	- ALWAYS set a background color inline in <style> or directly on body element
	- Failure to set a background color is a COMPLIANCE ERROR
	- Background color MUST be explicitly defined to ensure visibility and proper rendering
- Can embed base64 images directly in img tags
- Ensure the layout is responsive as the iframe might be resized
- Note: Network errors (404s) for external scripts may not be captured in logs due to browser security

For application/vnd.ant.code artifacts:
- Include the language parameter for syntax highlighting
- Supports all major programming languages

For text/markdown:
- Standard markdown syntax
- Will be rendered with full formatting
- Can include base64 images using markdown syntax

For image/svg+xml:
- Complete SVG markup
- Will be rendered inline
- Can embed raster images as base64 in SVG

CRITICAL REMINDER FOR ALL ARTIFACTS:
- Prefer to update existing files rather than creating new ones
- Keep filenames consistent and descriptive
- Use appropriate file extensions
- Ensure HTML artifacts have a defined background color
`,
			parameters: artifactsParamsSchema,
			// Execute mutates our local store and returns a plain output
			execute: async (_toolCallId: string, args: Static<typeof artifactsParamsSchema>, _signal?: AbortSignal) => {
				const output = await this.executeCommand(args);
				return { output, details: undefined };
			},
		};
	}

	// ToolRenderer implementation
	renderParams(params: ArtifactsParams, isStreaming?: boolean): TemplateResult {
		if (isStreaming && !params.command) {
			return html`<div class="text-sm text-muted-foreground">${i18n("Processing artifact...")}</div>`;
		}

		let commandLabel = i18n("Processing");
		if (params.command) {
			switch (params.command) {
				case "create":
					commandLabel = i18n("Create");
					break;
				case "update":
					commandLabel = i18n("Update");
					break;
				case "rewrite":
					commandLabel = i18n("Rewrite");
					break;
				case "get":
					commandLabel = i18n("Get");
					break;
				case "delete":
					commandLabel = i18n("Delete");
					break;
				case "logs":
					commandLabel = i18n("Get logs");
					break;
				default:
					commandLabel = params.command.charAt(0).toUpperCase() + params.command.slice(1);
			}
		}
		const filename = params.filename || "";

		switch (params.command) {
			case "create":
				return html`
					<div
						class="text-sm cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1"
						@click=${() => this.openArtifact(params.filename)}
					>
						<div>
							<span class="font-medium">${i18n("Create")}</span>
							<span class="text-muted-foreground ml-1">${filename}</span>
						</div>
						${
							params.content
								? html`<code-block
									.code=${params.content}
									language=${this.getLanguageFromFilename(params.filename)}
									class="mt-2"
								></code-block>`
								: ""
						}
					</div>
				`;
			case "update":
				return html`
					<div
						class="text-sm cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1"
						@click=${() => this.openArtifact(params.filename)}
					>
						<div>
							<span class="font-medium">${i18n("Update")}</span>
							<span class="text-muted-foreground ml-1">${filename}</span>
						</div>
						${
							params.old_str !== undefined && params.new_str !== undefined
								? Diff({ oldText: params.old_str, newText: params.new_str, className: "mt-2" })
								: ""
						}
					</div>
				`;
			case "rewrite":
				return html`
					<div
						class="text-sm cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1"
						@click=${() => this.openArtifact(params.filename)}
					>
						<div>
							<span class="font-medium">${i18n("Rewrite")}</span>
							<span class="text-muted-foreground ml-1">${filename}</span>
						</div>
						${
							params.content
								? html`<code-block
									.code=${params.content}
									language=${this.getLanguageFromFilename(params.filename)}
									class="mt-2"
								></code-block>`
								: ""
						}
					</div>
				`;
			case "get":
				return html`
					<div
						class="text-sm cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1"
						@click=${() => this.openArtifact(params.filename)}
					>
						<span class="font-medium">${i18n("Get")}</span>
						<span class="text-muted-foreground ml-1">${filename}</span>
					</div>
				`;
			case "delete":
				return html`
					<div
						class="text-sm cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1"
						@click=${() => this.openArtifact(params.filename)}
					>
						<span class="font-medium">${i18n("Delete")}</span>
						<span class="text-muted-foreground ml-1">${filename}</span>
					</div>
				`;
			case "logs":
				return html`
					<div
						class="text-sm cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1"
						@click=${() => this.openArtifact(params.filename)}
					>
						<span class="font-medium">${i18n("Get logs")}</span>
						<span class="text-muted-foreground ml-1">${filename}</span>
					</div>
				`;
			default:
				// Fallback for any command not yet handled during streaming
				return html`
					<div
						class="text-sm cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1"
						@click=${() => this.openArtifact(params.filename)}
					>
						<span class="font-medium">${commandLabel}</span>
						<span class="text-muted-foreground ml-1">${filename}</span>
					</div>
				`;
		}
	}

	renderResult(params: ArtifactsParams, result: ToolResultMessage<undefined>): TemplateResult {
		// Make result clickable to focus the referenced file when applicable
		const content = result.output || i18n("(no output)");
		return html`
			<div class="cursor-pointer hover:bg-muted/50 rounded-sm px-2 py-1" @click=${() => this.openArtifact(params.filename)}>
				${plainOutput(content)}
			</div>
		`;
	}

	// Re-apply artifacts by scanning a message list (optional utility)
	public async reconstructFromMessages(messages: Array<Message | { role: "aborted" }>): Promise<void> {
		const toolCalls = new Map<string, ToolCall>();
		const artifactToolName = "artifacts";

		// 1) Collect tool calls from assistant messages
		for (const message of messages) {
			if (message.role === "assistant") {
				for (const block of message.content) {
					if (block.type === "toolCall" && block.name === artifactToolName) {
						toolCalls.set(block.id, block);
					}
				}
			}
		}

		// 2) Build an ordered list of successful artifact operations
		const operations: Array<ArtifactsParams> = [];
		for (const m of messages) {
			if ((m as any).role === "toolResult" && (m as any).toolName === artifactToolName && !(m as any).isError) {
				const toolCallId = (m as any).toolCallId as string;
				const call = toolCalls.get(toolCallId);
				if (!call) continue;
				const params = call.arguments as ArtifactsParams;
				if (params.command === "get" || params.command === "logs") continue; // no state change
				operations.push(params);
			}
		}

		// 3) Compute final state per filename by simulating operations in-memory
		type FinalArtifact = { title: string; content: string };
		const finalArtifacts = new Map<string, FinalArtifact>();
		for (const op of operations) {
			const filename = op.filename;
			switch (op.command) {
				case "create": {
					if (op.content) {
						finalArtifacts.set(filename, { title: op.title || filename, content: op.content });
					}
					break;
				}
				case "rewrite": {
					if (op.content) {
						// If file didn't exist earlier but rewrite succeeded, treat as fresh content
						const existing = finalArtifacts.get(filename);
						finalArtifacts.set(filename, { title: op.title || existing?.title || filename, content: op.content });
					}
					break;
				}
				case "update": {
					const existing = finalArtifacts.get(filename);
					if (!existing) break; // skip invalid update (shouldn't happen for successful results)
					if (op.old_str !== undefined && op.new_str !== undefined) {
						existing.content = existing.content.replace(op.old_str, op.new_str);
						finalArtifacts.set(filename, existing);
					}
					break;
				}
				case "delete": {
					finalArtifacts.delete(filename);
					break;
				}
				case "get":
				case "logs":
					// Ignored above, just for completeness
					break;
			}
		}

		// 4) Reset current UI state before bulk create
		this._artifacts.clear();
		this.artifactElements.forEach((el) => {
			el.remove();
		});
		this.artifactElements.clear();
		this._activeFilename = null;
		this._artifacts = new Map(this._artifacts);

		// 5) Create artifacts in a single pass without waiting for iframe execution or tab switching
		for (const [filename, { title, content }] of finalArtifacts.entries()) {
			const createParams: ArtifactsParams = { command: "create", filename, title, content } as const;
			try {
				await this.createArtifact(createParams, { skipWait: true, silent: true });
			} catch {
				// Ignore failures during reconstruction
			}
		}

		// 6) Show first artifact if any exist, and notify listeners once
		if (!this._activeFilename && this._artifacts.size > 0) {
			this.showArtifact(Array.from(this._artifacts.keys())[0]);
		}
		this.onArtifactsChange?.();
		this.requestUpdate();
	}

	// Core command executor
	private async executeCommand(
		params: ArtifactsParams,
		options: { skipWait?: boolean; silent?: boolean } = {},
	): Promise<string> {
		switch (params.command) {
			case "create":
				return await this.createArtifact(params, options);
			case "update":
				return await this.updateArtifact(params, options);
			case "rewrite":
				return await this.rewriteArtifact(params, options);
			case "get":
				return this.getArtifact(params);
			case "delete":
				return this.deleteArtifact(params);
			case "logs":
				return this.getLogs(params);
			default:
				// Should never happen with TypeBox validation
				return `Error: Unknown command ${(params as any).command}`;
		}
	}

	// Wait for HTML artifact execution and get logs
	private async waitForHtmlExecution(filename: string): Promise<string> {
		const element = this.artifactElements.get(filename);
		if (!(element instanceof HtmlArtifact)) {
			return "";
		}

		return new Promise((resolve) => {
			let resolved = false;

			// Listen for the execution-complete message
			const messageHandler = (event: MessageEvent) => {
				if (event.data?.type === "execution-complete" && event.data?.artifactId === filename) {
					if (!resolved) {
						resolved = true;
						window.removeEventListener("message", messageHandler);

						// Get the logs from the element
						const logs = element.getLogs();
						if (logs.includes("[error]")) {
							resolve(`\n\nExecution completed with errors:\n${logs}`);
						} else if (logs !== `No logs for ${filename}`) {
							resolve(`\n\nExecution logs:\n${logs}`);
						} else {
							resolve("");
						}
					}
				}
			};

			window.addEventListener("message", messageHandler);

			// Fallback timeout in case the message never arrives
			setTimeout(() => {
				if (!resolved) {
					resolved = true;
					window.removeEventListener("message", messageHandler);

					// Get whatever logs we have so far
					const logs = element.getLogs();
					if (logs.includes("[error]")) {
						resolve(`\n\nExecution timed out with errors:\n${logs}`);
					} else if (logs !== `No logs for ${filename}`) {
						resolve(`\n\nExecution timed out. Partial logs:\n${logs}`);
					} else {
						resolve("");
					}
				}
			}, 1500);
		});
	}

	private async createArtifact(
		params: ArtifactsParams,
		options: { skipWait?: boolean; silent?: boolean } = {},
	): Promise<string> {
		if (!params.filename || !params.content) {
			return "Error: create command requires filename and content";
		}
		if (this._artifacts.has(params.filename)) {
			return `Error: File ${params.filename} already exists`;
		}

		const title = params.title || params.filename;
		const artifact: Artifact = {
			filename: params.filename,
			title: title,
			content: params.content,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		this._artifacts.set(params.filename, artifact);
		this._artifacts = new Map(this._artifacts);

		// Create or update element
		this.getOrCreateArtifactElement(params.filename, params.content, title);
		if (!options.silent) {
			this.showArtifact(params.filename);
			this.onArtifactsChange?.();
			this.requestUpdate();
		}

		// For HTML files, wait for execution
		let result = `Created file ${params.filename}`;
		if (this.getFileType(params.filename) === "html" && !options.skipWait) {
			const logs = await this.waitForHtmlExecution(params.filename);
			result += logs;
		}

		return result;
	}

	private async updateArtifact(
		params: ArtifactsParams,
		options: { skipWait?: boolean; silent?: boolean } = {},
	): Promise<string> {
		const artifact = this._artifacts.get(params.filename);
		if (!artifact) {
			const files = Array.from(this._artifacts.keys());
			if (files.length === 0) return `Error: File ${params.filename} not found. No files have been created yet.`;
			return `Error: File ${params.filename} not found. Available files: ${files.join(", ")}`;
		}
		if (!params.old_str || params.new_str === undefined) {
			return "Error: update command requires old_str and new_str";
		}
		if (!artifact.content.includes(params.old_str)) {
			return `Error: String not found in file. Here is the full content:\n\n${artifact.content}`;
		}

		artifact.content = artifact.content.replace(params.old_str, params.new_str);
		artifact.updatedAt = new Date();
		this._artifacts.set(params.filename, artifact);

		// Update element
		this.getOrCreateArtifactElement(params.filename, artifact.content, artifact.title);
		if (!options.silent) {
			this.onArtifactsChange?.();
			this.requestUpdate();
		}

		// Show the artifact
		this.showArtifact(params.filename);

		// For HTML files, wait for execution
		let result = `Updated file ${params.filename}`;
		if (this.getFileType(params.filename) === "html" && !options.skipWait) {
			const logs = await this.waitForHtmlExecution(params.filename);
			result += logs;
		}

		return result;
	}

	private async rewriteArtifact(
		params: ArtifactsParams,
		options: { skipWait?: boolean; silent?: boolean } = {},
	): Promise<string> {
		const artifact = this._artifacts.get(params.filename);
		if (!artifact) {
			const files = Array.from(this._artifacts.keys());
			if (files.length === 0) return `Error: File ${params.filename} not found. No files have been created yet.`;
			return `Error: File ${params.filename} not found. Available files: ${files.join(", ")}`;
		}
		if (!params.content) {
			return "Error: rewrite command requires content";
		}

		artifact.content = params.content;
		if (params.title) artifact.title = params.title;
		artifact.updatedAt = new Date();
		this._artifacts.set(params.filename, artifact);

		// Update element
		this.getOrCreateArtifactElement(params.filename, artifact.content, artifact.title);
		if (!options.silent) {
			this.onArtifactsChange?.();
		}

		// Show the artifact
		this.showArtifact(params.filename);

		// For HTML files, wait for execution
		let result = `Rewrote file ${params.filename}`;
		if (this.getFileType(params.filename) === "html" && !options.skipWait) {
			const logs = await this.waitForHtmlExecution(params.filename);
			result += logs;
		}

		return result;
	}

	private getArtifact(params: ArtifactsParams): string {
		const artifact = this._artifacts.get(params.filename);
		if (!artifact) {
			const files = Array.from(this._artifacts.keys());
			if (files.length === 0) return `Error: File ${params.filename} not found. No files have been created yet.`;
			return `Error: File ${params.filename} not found. Available files: ${files.join(", ")}`;
		}
		return artifact.content;
	}

	private deleteArtifact(params: ArtifactsParams): string {
		const artifact = this._artifacts.get(params.filename);
		if (!artifact) {
			const files = Array.from(this._artifacts.keys());
			if (files.length === 0) return `Error: File ${params.filename} not found. No files have been created yet.`;
			return `Error: File ${params.filename} not found. Available files: ${files.join(", ")}`;
		}

		this._artifacts.delete(params.filename);
		this._artifacts = new Map(this._artifacts);

		// Remove element
		const element = this.artifactElements.get(params.filename);
		if (element) {
			element.remove();
			this.artifactElements.delete(params.filename);
		}

		// Show another artifact if this was active
		if (this._activeFilename === params.filename) {
			const remaining = Array.from(this._artifacts.keys());
			if (remaining.length > 0) {
				this.showArtifact(remaining[0]);
			} else {
				this._activeFilename = null;
				this.requestUpdate();
			}
		}
		this.onArtifactsChange?.();
		this.requestUpdate();

		return `Deleted file ${params.filename}`;
	}

	private getLogs(params: ArtifactsParams): string {
		const element = this.artifactElements.get(params.filename);
		if (!element) {
			const files = Array.from(this._artifacts.keys());
			if (files.length === 0) return `Error: File ${params.filename} not found. No files have been created yet.`;
			return `Error: File ${params.filename} not found. Available files: ${files.join(", ")}`;
		}

		if (!(element instanceof HtmlArtifact)) {
			return `Error: File ${params.filename} is not an HTML file. Logs are only available for HTML files.`;
		}

		return element.getLogs();
	}

	override render(): TemplateResult {
		const artifacts = Array.from(this._artifacts.values());

		// Panel is hidden when collapsed OR when there are no artifacts
		const showPanel = artifacts.length > 0 && !this.collapsed;

		return html`
			<div
				class="${showPanel ? "" : "hidden"} ${
					this.overlay ? "fixed inset-0 z-40 pointer-events-auto backdrop-blur-sm bg-background/95" : "relative"
				} h-full flex flex-col bg-background text-card-foreground ${
					!this.overlay ? "border-l border-border" : ""
				} overflow-hidden shadow-xl"
			>
				<!-- Tab bar (always shown when there are artifacts) -->
				<div class="flex items-center justify-between border-b border-border bg-background">
					<div class="flex overflow-x-auto">
						${artifacts.map((a) => {
							const isActive = a.filename === this._activeFilename;
							const activeClass = isActive
								? "border-primary text-primary"
								: "border-transparent text-muted-foreground hover:text-foreground";
							return html`
								<button
									class="px-3 py-2 whitespace-nowrap border-b-2 ${activeClass}"
									@click=${() => this.showArtifact(a.filename)}
								>
									<span class="font-mono text-xs">${a.filename}</span>
								</button>
							`;
						})}
					</div>
					<div class="flex items-center gap-1 px-2">
						${(() => {
							const active = this._activeFilename ? this.artifactElements.get(this._activeFilename) : undefined;
							return active ? active.getHeaderButtons() : "";
						})()}
						${Button({
							variant: "ghost",
							size: "sm",
							onClick: () => this.onClose?.(),
							title: i18n("Close artifacts"),
							children: icon(X, "sm"),
						})}
					</div>
				</div>

				<!-- Content area where artifact elements are added programmatically -->
				<div class="flex-1 overflow-hidden" ${ref(this.contentRef)}></div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"artifacts-panel": ArtifactsPanel;
	}
}
