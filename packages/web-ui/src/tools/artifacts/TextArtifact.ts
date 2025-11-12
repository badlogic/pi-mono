import { CopyButton } from "@mariozechner/mini-lit/dist/CopyButton.js";
import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import hljs from "highlight.js";
import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { i18n } from "../../utils/i18n.js";
import { ArtifactElement } from "./ArtifactElement.js";

// Known code file extensions for highlighting
const CODE_EXTENSIONS = [
	"js",
	"javascript",
	"ts",
	"typescript",
	"jsx",
	"tsx",
	"py",
	"python",
	"java",
	"c",
	"cpp",
	"cs",
	"php",
	"rb",
	"ruby",
	"go",
	"rust",
	"swift",
	"kotlin",
	"scala",
	"dart",
	"html",
	"css",
	"scss",
	"sass",
	"less",
	"json",
	"xml",
	"yaml",
	"yml",
	"toml",
	"sql",
	"sh",
	"bash",
	"ps1",
	"bat",
	"r",
	"matlab",
	"julia",
	"lua",
	"perl",
	"vue",
	"svelte",
];

@customElement("text-artifact")
export class TextArtifact extends ArtifactElement {
	@property() override filename = "";

	private _content = "";
	override get content(): string {
		return this._content;
	}
	override set content(value: string) {
		this._content = value;
		this.requestUpdate();
	}

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this; // light DOM
	}

	private isCode(): boolean {
		const ext = this.filename.split(".").pop()?.toLowerCase() || "";
		return CODE_EXTENSIONS.includes(ext);
	}

	private getLanguageFromExtension(ext: string): string {
		const languageMap: Record<string, string> = {
			js: "javascript",
			ts: "typescript",
			py: "python",
			rb: "ruby",
			yml: "yaml",
			ps1: "powershell",
			bat: "batch",
		};
		return languageMap[ext] || ext;
	}

	private getMimeType(): string {
		const ext = this.filename.split(".").pop()?.toLowerCase() || "";
		if (ext === "svg") return "image/svg+xml";
		if (ext === "md" || ext === "markdown") return "text/markdown";
		return "text/plain";
	}

	public getHeaderButtons() {
		const copyButton = new CopyButton();
		copyButton.text = this.content;
		copyButton.title = i18n("Copy");
		copyButton.showText = false;

		return html`
			<div class="flex items-center gap-1">
				${copyButton}
				${DownloadButton({
					content: this.content,
					filename: this.filename,
					mimeType: this.getMimeType(),
					title: i18n("Download"),
				})}
			</div>
		`;
	}

	override render() {
		const isCode = this.isCode();
		const ext = this.filename.split(".").pop() || "";
		return html`
			<div class="h-full flex flex-col">
				<div class="flex-1 overflow-auto">
					${
						isCode
							? html`
								<pre class="m-0 p-4 text-xs"><code class="hljs language-${this.getLanguageFromExtension(
									ext.toLowerCase(),
								)}">${unsafeHTML(
									hljs.highlight(this.content, {
										language: this.getLanguageFromExtension(ext.toLowerCase()),
										ignoreIllegals: true,
									}).value,
								)}</code></pre>
							`
							: html` <pre class="m-0 p-4 text-xs font-mono">${this.content}</pre> `
					}
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"text-artifact": TextArtifact;
	}
}
