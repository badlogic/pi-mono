import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import * as pdfjsLib from "pdfjs-dist";
import { i18n } from "../../utils/i18n.js";
import { ArtifactElement } from "./ArtifactElement.js";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

@customElement("pdf-artifact")
export class PdfArtifact extends ArtifactElement {
	@property({ type: String }) private _content = "";
	@state() private error: string | null = null;
	private currentLoadingTask: any = null;

	get content(): string {
		return this._content;
	}

	set content(value: string) {
		this._content = value;
		this.error = null;
		this.requestUpdate();
	}

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
		this.style.height = "100%";
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.cleanup();
	}

	private cleanup() {
		if (this.currentLoadingTask) {
			this.currentLoadingTask.destroy();
			this.currentLoadingTask = null;
		}
	}

	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		// Remove data URL prefix if present
		let base64Data = base64;
		if (base64.startsWith("data:")) {
			const base64Match = base64.match(/base64,(.+)/);
			if (base64Match) {
				base64Data = base64Match[1];
			}
		}

		const binaryString = atob(base64Data);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	private decodeBase64(): Uint8Array {
		let base64Data = this._content;
		if (this._content.startsWith("data:")) {
			const base64Match = this._content.match(/base64,(.+)/);
			if (base64Match) {
				base64Data = base64Match[1];
			}
		}

		const binaryString = atob(base64Data);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes;
	}

	public getHeaderButtons() {
		return html`
			<div class="flex items-center gap-1">
				${DownloadButton({
					content: this.decodeBase64(),
					filename: this.filename,
					mimeType: "application/pdf",
					title: i18n("Download"),
				})}
			</div>
		`;
	}

	override async updated(changedProperties: Map<string, any>) {
		super.updated(changedProperties);

		if (changedProperties.has("_content") && this._content && !this.error) {
			await this.renderPdf();
		}
	}

	private async renderPdf() {
		const container = this.querySelector("#pdf-container");
		if (!container || !this._content) return;

		let pdf: any = null;

		try {
			const arrayBuffer = this.base64ToArrayBuffer(this._content);

			// Cancel any existing loading task
			if (this.currentLoadingTask) {
				this.currentLoadingTask.destroy();
			}

			// Load the PDF
			this.currentLoadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
			pdf = await this.currentLoadingTask.promise;
			this.currentLoadingTask = null;

			// Clear container
			container.innerHTML = "";
			const wrapper = document.createElement("div");
			wrapper.className = "p-4";
			container.appendChild(wrapper);

			// Render all pages
			for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
				const page = await pdf.getPage(pageNum);

				const pageContainer = document.createElement("div");
				pageContainer.className = "mb-4 last:mb-0";

				const canvas = document.createElement("canvas");
				const context = canvas.getContext("2d");

				const viewport = page.getViewport({ scale: 1.5 });
				canvas.height = viewport.height;
				canvas.width = viewport.width;

				canvas.className = "w-full max-w-full h-auto block mx-auto bg-white rounded shadow-sm border border-border";

				if (context) {
					context.fillStyle = "white";
					context.fillRect(0, 0, canvas.width, canvas.height);
				}

				await page.render({
					canvasContext: context!,
					viewport: viewport,
					canvas: canvas,
				}).promise;

				pageContainer.appendChild(canvas);

				if (pageNum < pdf.numPages) {
					const separator = document.createElement("div");
					separator.className = "h-px bg-border my-4";
					pageContainer.appendChild(separator);
				}

				wrapper.appendChild(pageContainer);
			}
		} catch (error: any) {
			console.error("Error rendering PDF:", error);
			this.error = error?.message || i18n("Failed to load PDF");
		} finally {
			if (pdf) {
				pdf.destroy();
			}
		}
	}

	override render(): TemplateResult {
		if (this.error) {
			return html`
				<div class="h-full flex items-center justify-center bg-background p-4">
					<div class="bg-destructive/10 border border-destructive text-destructive p-4 rounded-lg max-w-2xl">
						<div class="font-medium mb-1">${i18n("Error loading PDF")}</div>
						<div class="text-sm opacity-90">${this.error}</div>
					</div>
				</div>
			`;
		}

		return html`
			<div class="h-full flex flex-col bg-background overflow-auto">
				<div id="pdf-container" class="flex-1 overflow-auto"></div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"pdf-artifact": PdfArtifact;
	}
}
