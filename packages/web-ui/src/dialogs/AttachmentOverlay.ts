import "@mariozechner/mini-lit/dist/ModeToggle.js";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { renderAsync } from "docx-preview";
import { html, LitElement } from "lit";
import { state } from "lit/decorators.js";
import { Download, X } from "lucide";
import * as pdfjsLib from "pdfjs-dist";
import * as XLSX from "xlsx";
import type { Attachment } from "../utils/attachment-utils.js";
import { i18n } from "../utils/i18n.js";

type FileType = "image" | "pdf" | "docx" | "pptx" | "excel" | "text";

export class AttachmentOverlay extends LitElement {
	@state() private attachment?: Attachment;
	@state() private showExtractedText = false;
	@state() private error: string | null = null;

	// Track current loading task to cancel if needed
	private currentLoadingTask: any = null;
	private onCloseCallback?: () => void;
	private boundHandleKeyDown?: (e: KeyboardEvent) => void;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	static open(attachment: Attachment, onClose?: () => void) {
		const overlay = new AttachmentOverlay();
		overlay.attachment = attachment;
		overlay.onCloseCallback = onClose;
		document.body.appendChild(overlay);
		overlay.setupEventListeners();
	}

	private setupEventListeners() {
		this.boundHandleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				this.close();
			}
		};
		window.addEventListener("keydown", this.boundHandleKeyDown);
	}

	private close() {
		this.cleanup();
		if (this.boundHandleKeyDown) {
			window.removeEventListener("keydown", this.boundHandleKeyDown);
		}
		this.onCloseCallback?.();
		this.remove();
	}

	private getFileType(): FileType {
		if (!this.attachment) return "text";

		if (this.attachment.type === "image") return "image";
		if (this.attachment.mimeType === "application/pdf") return "pdf";
		if (this.attachment.mimeType?.includes("wordprocessingml")) return "docx";
		if (
			this.attachment.mimeType?.includes("presentationml") ||
			this.attachment.fileName.toLowerCase().endsWith(".pptx")
		)
			return "pptx";
		if (
			this.attachment.mimeType?.includes("spreadsheetml") ||
			this.attachment.mimeType?.includes("ms-excel") ||
			this.attachment.fileName.toLowerCase().endsWith(".xlsx") ||
			this.attachment.fileName.toLowerCase().endsWith(".xls")
		)
			return "excel";

		return "text";
	}

	private getFileTypeLabel(): string {
		const type = this.getFileType();
		switch (type) {
			case "pdf":
				return i18n("PDF");
			case "docx":
				return i18n("Document");
			case "pptx":
				return i18n("Presentation");
			case "excel":
				return i18n("Spreadsheet");
			default:
				return "";
		}
	}

	private handleBackdropClick = () => {
		this.close();
	};

	private handleDownload = () => {
		if (!this.attachment) return;

		// Create a blob from the base64 content
		const byteCharacters = atob(this.attachment.content);
		const byteNumbers = new Array(byteCharacters.length);
		for (let i = 0; i < byteCharacters.length; i++) {
			byteNumbers[i] = byteCharacters.charCodeAt(i);
		}
		const byteArray = new Uint8Array(byteNumbers);
		const blob = new Blob([byteArray], { type: this.attachment.mimeType });

		// Create download link
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = this.attachment.fileName;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	private cleanup() {
		this.showExtractedText = false;
		this.error = null;
		// Cancel any loading PDF task when closing
		if (this.currentLoadingTask) {
			this.currentLoadingTask.destroy();
			this.currentLoadingTask = null;
		}
	}

	override render() {
		if (!this.attachment) return html``;

		return html`
			<!-- Full screen overlay -->
			<div class="fixed inset-0 bg-black/90 z-50 flex flex-col" @click=${this.handleBackdropClick}>
				<!-- Compact header bar -->
				<div class="bg-background/95 backdrop-blur border-b border-border" @click=${(e: Event) => e.stopPropagation()}>
					<div class="px-4 py-2 flex items-center justify-between">
						<div class="flex items-center gap-3 min-w-0">
							<span class="text-sm font-medium text-foreground truncate">${this.attachment.fileName}</span>
						</div>
						<div class="flex items-center gap-2">
							${this.renderToggle()}
							${Button({
								variant: "ghost",
								size: "icon",
								onClick: this.handleDownload,
								children: icon(Download, "sm"),
								className: "h-8 w-8",
							})}
							${Button({
								variant: "ghost",
								size: "icon",
								onClick: () => this.close(),
								children: icon(X, "sm"),
								className: "h-8 w-8",
							})}
						</div>
					</div>
				</div>

				<!-- Content container -->
				<div class="flex-1 flex items-center justify-center overflow-auto" @click=${(e: Event) => e.stopPropagation()}>
					${this.renderContent()}
				</div>
			</div>
		`;
	}

	private renderToggle() {
		if (!this.attachment) return html``;

		const fileType = this.getFileType();
		const hasExtractedText = !!this.attachment.extractedText;
		const showToggle = fileType !== "image" && fileType !== "text" && fileType !== "pptx" && hasExtractedText;

		if (!showToggle) return html``;

		const fileTypeLabel = this.getFileTypeLabel();

		return html`
			<mode-toggle
				.modes=${[fileTypeLabel, i18n("Text")]}
				.selectedIndex=${this.showExtractedText ? 1 : 0}
				@mode-change=${(e: CustomEvent<{ index: number; mode: string }>) => {
					e.stopPropagation();
					this.showExtractedText = e.detail.index === 1;
					this.error = null;
				}}
			></mode-toggle>
		`;
	}

	private renderContent() {
		if (!this.attachment) return html``;

		// Error state
		if (this.error) {
			return html`
				<div class="bg-destructive/10 border border-destructive text-destructive p-4 rounded-lg max-w-2xl">
					<div class="font-medium mb-1">${i18n("Error loading file")}</div>
					<div class="text-sm opacity-90">${this.error}</div>
				</div>
			`;
		}

		// Content based on file type
		return this.renderFileContent();
	}

	private renderFileContent() {
		if (!this.attachment) return html``;

		const fileType = this.getFileType();

		// Show extracted text if toggled
		if (this.showExtractedText && fileType !== "image") {
			return html`
				<div class="bg-card border border-border text-foreground p-6 w-full h-full max-w-4xl overflow-auto">
					<pre class="whitespace-pre-wrap font-mono text-xs leading-relaxed">${
						this.attachment.extractedText || i18n("No text content available")
					}</pre>
				</div>
			`;
		}

		// Render based on file type
		switch (fileType) {
			case "image": {
				const imageUrl = `data:${this.attachment.mimeType};base64,${this.attachment.content}`;
				return html`
					<img src="${imageUrl}" class="max-w-full max-h-full object-contain rounded-lg shadow-lg" alt="${this.attachment.fileName}" />
				`;
			}

			case "pdf":
				return html`
					<div
						id="pdf-container"
						class="bg-card text-foreground overflow-auto shadow-lg border border-border w-full h-full max-w-[1000px]"
					></div>
				`;

			case "docx":
				return html`
					<div
						id="docx-container"
						class="bg-card text-foreground overflow-auto shadow-lg border border-border w-full h-full max-w-[1000px]"
					></div>
				`;

			case "excel":
				return html` <div id="excel-container" class="bg-card text-foreground overflow-auto w-full h-full"></div> `;

			case "pptx":
				return html`
					<div
						id="pptx-container"
						class="bg-card text-foreground overflow-auto shadow-lg border border-border w-full h-full max-w-[1000px]"
					></div>
				`;

			default:
				return html`
					<div class="bg-card border border-border text-foreground p-6 w-full h-full max-w-4xl overflow-auto">
						<pre class="whitespace-pre-wrap font-mono text-sm">${
							this.attachment.extractedText || i18n("No content available")
						}</pre>
					</div>
				`;
		}
	}

	override async updated(changedProperties: Map<string, any>) {
		super.updated(changedProperties);

		// Only process if we need to render the actual file (not extracted text)
		if (
			(changedProperties.has("attachment") || changedProperties.has("showExtractedText")) &&
			this.attachment &&
			!this.showExtractedText &&
			!this.error
		) {
			const fileType = this.getFileType();

			switch (fileType) {
				case "pdf":
					await this.renderPdf();
					break;
				case "docx":
					await this.renderDocx();
					break;
				case "excel":
					await this.renderExcel();
					break;
				case "pptx":
					await this.renderExtractedText();
					break;
			}
		}
	}

	private async renderPdf() {
		const container = this.querySelector("#pdf-container");
		if (!container || !this.attachment) return;

		let pdf: any = null;

		try {
			// Convert base64 to ArrayBuffer
			const arrayBuffer = this.base64ToArrayBuffer(this.attachment.content);

			// Cancel any existing loading task
			if (this.currentLoadingTask) {
				this.currentLoadingTask.destroy();
			}

			// Load the PDF
			this.currentLoadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
			pdf = await this.currentLoadingTask.promise;
			this.currentLoadingTask = null;

			// Clear container and add wrapper
			container.innerHTML = "";
			const wrapper = document.createElement("div");
			wrapper.className = "";
			container.appendChild(wrapper);

			// Render all pages
			for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
				const page = await pdf.getPage(pageNum);

				// Create a container for each page
				const pageContainer = document.createElement("div");
				pageContainer.className = "mb-4 last:mb-0";

				// Create canvas for this page
				const canvas = document.createElement("canvas");
				const context = canvas.getContext("2d");

				// Set scale for reasonable resolution
				const viewport = page.getViewport({ scale: 1.5 });
				canvas.height = viewport.height;
				canvas.width = viewport.width;

				// Style the canvas
				canvas.className = "w-full max-w-full h-auto block mx-auto bg-white rounded shadow-sm border border-border";

				// Fill white background for proper PDF rendering
				if (context) {
					context.fillStyle = "white";
					context.fillRect(0, 0, canvas.width, canvas.height);
				}

				// Render page
				await page.render({
					canvasContext: context!,
					viewport: viewport,
					canvas: canvas,
				}).promise;

				pageContainer.appendChild(canvas);

				// Add page separator for multi-page documents
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

	private async renderDocx() {
		const container = this.querySelector("#docx-container");
		if (!container || !this.attachment) return;

		try {
			// Convert base64 to ArrayBuffer
			const arrayBuffer = this.base64ToArrayBuffer(this.attachment.content);

			// Clear container first
			container.innerHTML = "";

			// Create a wrapper div for the document
			const wrapper = document.createElement("div");
			wrapper.className = "docx-wrapper-custom";
			container.appendChild(wrapper);

			// Render the DOCX file into the wrapper
			await renderAsync(arrayBuffer, wrapper as HTMLElement, undefined, {
				className: "docx",
				inWrapper: true,
				ignoreWidth: true, // Let it be responsive
				ignoreHeight: false,
				ignoreFonts: false,
				breakPages: true,
				ignoreLastRenderedPageBreak: true,
				experimental: false,
				trimXmlDeclaration: true,
				useBase64URL: false,
				renderHeaders: true,
				renderFooters: true,
				renderFootnotes: true,
				renderEndnotes: true,
			});

			// Apply custom styles to match theme and fix sizing
			const style = document.createElement("style");
			style.textContent = `
				#docx-container {
					padding: 0;
				}

				#docx-container .docx-wrapper-custom {
					max-width: 100%;
					overflow-x: auto;
				}

				#docx-container .docx-wrapper {
					max-width: 100% !important;
					margin: 0 !important;
					background: transparent !important;
					padding: 0em !important;
				}

				#docx-container .docx-wrapper > section.docx {
					box-shadow: none !important;
					border: none !important;
					border-radius: 0 !important;
					margin: 0 !important;
					padding: 2em !important;
					background: white !important;
					color: black !important;
					max-width: 100% !important;
					width: 100% !important;
					min-width: 0 !important;
					overflow-x: auto !important;
				}

				/* Fix tables and wide content */
				#docx-container table {
					max-width: 100% !important;
					width: auto !important;
					overflow-x: auto !important;
					display: block !important;
				}

				#docx-container img {
					max-width: 100% !important;
					height: auto !important;
				}

				/* Fix paragraphs and text */
				#docx-container p,
				#docx-container span,
				#docx-container div {
					max-width: 100% !important;
					word-wrap: break-word !important;
					overflow-wrap: break-word !important;
				}

				/* Hide page breaks in web view */
				#docx-container .docx-page-break {
					display: none !important;
				}
			`;
			container.appendChild(style);
		} catch (error: any) {
			console.error("Error rendering DOCX:", error);
			this.error = error?.message || i18n("Failed to load document");
		}
	}

	private async renderExcel() {
		const container = this.querySelector("#excel-container");
		if (!container || !this.attachment) return;

		try {
			// Convert base64 to ArrayBuffer
			const arrayBuffer = this.base64ToArrayBuffer(this.attachment.content);

			// Read the workbook
			const workbook = XLSX.read(arrayBuffer, { type: "array" });

			// Clear container
			container.innerHTML = "";
			const wrapper = document.createElement("div");
			wrapper.className = "overflow-auto h-full flex flex-col";
			container.appendChild(wrapper);

			// Create tabs for multiple sheets
			if (workbook.SheetNames.length > 1) {
				const tabContainer = document.createElement("div");
				tabContainer.className = "flex gap-2 mb-4 border-b border-border sticky top-0 bg-card z-10";

				const sheetContents: HTMLElement[] = [];

				workbook.SheetNames.forEach((sheetName, index) => {
					// Create tab button
					const tab = document.createElement("button");
					tab.textContent = sheetName;
					tab.className =
						index === 0
							? "px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary"
							: "px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-b-2 hover:border-border transition-colors";

					// Create sheet content
					const sheetDiv = document.createElement("div");
					sheetDiv.style.display = index === 0 ? "flex" : "none";
					sheetDiv.className = "flex-1 overflow-auto";
					sheetDiv.appendChild(this.renderExcelSheet(workbook.Sheets[sheetName], sheetName));
					sheetContents.push(sheetDiv);

					// Tab click handler
					tab.onclick = () => {
						// Update tab styles
						tabContainer.querySelectorAll("button").forEach((btn, btnIndex) => {
							if (btnIndex === index) {
								btn.className = "px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary";
							} else {
								btn.className =
									"px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-b-2 hover:border-border transition-colors";
							}
						});
						// Show/hide sheets
						sheetContents.forEach((content, contentIndex) => {
							content.style.display = contentIndex === index ? "flex" : "none";
						});
					};

					tabContainer.appendChild(tab);
				});

				wrapper.appendChild(tabContainer);
				sheetContents.forEach((content) => {
					wrapper.appendChild(content);
				});
			} else {
				// Single sheet
				const sheetName = workbook.SheetNames[0];
				wrapper.appendChild(this.renderExcelSheet(workbook.Sheets[sheetName], sheetName));
			}
		} catch (error: any) {
			console.error("Error rendering Excel:", error);
			this.error = error?.message || i18n("Failed to load spreadsheet");
		}
	}

	private renderExcelSheet(worksheet: any, sheetName: string): HTMLElement {
		const sheetDiv = document.createElement("div");

		// Generate HTML table
		const htmlTable = XLSX.utils.sheet_to_html(worksheet, { id: `sheet-${sheetName}` });
		const tempDiv = document.createElement("div");
		tempDiv.innerHTML = htmlTable;

		// Find and style the table
		const table = tempDiv.querySelector("table");
		if (table) {
			table.className = "w-full border-collapse text-foreground";

			// Style all cells
			table.querySelectorAll("td, th").forEach((cell) => {
				const cellEl = cell as HTMLElement;
				cellEl.className = "border border-border px-3 py-2 text-sm text-left";
			});

			// Style header row
			const headerCells = table.querySelectorAll("thead th, tr:first-child td");
			if (headerCells.length > 0) {
				headerCells.forEach((th) => {
					const thEl = th as HTMLElement;
					thEl.className =
						"border border-border px-3 py-2 text-sm font-semibold bg-muted text-foreground sticky top-0";
				});
			}

			// Alternate row colors
			table.querySelectorAll("tbody tr:nth-child(even)").forEach((row) => {
				const rowEl = row as HTMLElement;
				rowEl.className = "bg-muted/30";
			});

			sheetDiv.appendChild(table);
		}

		return sheetDiv;
	}

	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	private async renderExtractedText() {
		const container = this.querySelector("#pptx-container");
		if (!container || !this.attachment) return;

		try {
			// Display the extracted text content
			container.innerHTML = "";
			const wrapper = document.createElement("div");
			wrapper.className = "p-6 overflow-auto";

			// Create a pre element to preserve formatting
			const pre = document.createElement("pre");
			pre.className = "whitespace-pre-wrap text-sm text-foreground font-mono";
			pre.textContent = this.attachment.extractedText || i18n("No text content available");

			wrapper.appendChild(pre);
			container.appendChild(wrapper);
		} catch (error: any) {
			console.error("Error rendering extracted text:", error);
			this.error = error?.message || i18n("Failed to display text content");
		}
	}
}

// Register the custom element only once
if (!customElements.get("attachment-overlay")) {
	customElements.define("attachment-overlay", AttachmentOverlay);
}
