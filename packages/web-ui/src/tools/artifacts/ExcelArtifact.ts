import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import { html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import * as XLSX from "xlsx";
import { i18n } from "../../utils/i18n.js";
import { ArtifactElement } from "./ArtifactElement.js";

@customElement("excel-artifact")
export class ExcelArtifact extends ArtifactElement {
	@property({ type: String }) private _content = "";
	@state() private error: string | null = null;

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

	private getMimeType(): string {
		const ext = this.filename.split(".").pop()?.toLowerCase();
		if (ext === "xls") return "application/vnd.ms-excel";
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
	}

	public getHeaderButtons() {
		return html`
			<div class="flex items-center gap-1">
				${DownloadButton({
					content: this.decodeBase64(),
					filename: this.filename,
					mimeType: this.getMimeType(),
					title: i18n("Download"),
				})}
			</div>
		`;
	}

	override async updated(changedProperties: Map<string, any>) {
		super.updated(changedProperties);

		if (changedProperties.has("_content") && this._content && !this.error) {
			await this.renderExcel();
		}
	}

	private async renderExcel() {
		const container = this.querySelector("#excel-container");
		if (!container || !this._content) return;

		try {
			const arrayBuffer = this.base64ToArrayBuffer(this._content);
			const workbook = XLSX.read(arrayBuffer, { type: "array" });

			container.innerHTML = "";
			const wrapper = document.createElement("div");
			wrapper.className = "overflow-auto h-full flex flex-col";
			container.appendChild(wrapper);

			// Create tabs for multiple sheets
			if (workbook.SheetNames.length > 1) {
				const tabContainer = document.createElement("div");
				tabContainer.className = "flex gap-2 mb-4 border-b border-border sticky top-0 bg-background z-10";

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

	override render(): TemplateResult {
		if (this.error) {
			return html`
				<div class="h-full flex items-center justify-center bg-background p-4">
					<div class="bg-destructive/10 border border-destructive text-destructive p-4 rounded-lg max-w-2xl">
						<div class="font-medium mb-1">${i18n("Error loading spreadsheet")}</div>
						<div class="text-sm opacity-90">${this.error}</div>
					</div>
				</div>
			`;
		}

		return html`
			<div class="h-full flex flex-col bg-background overflow-auto">
				<div id="excel-container" class="flex-1 overflow-auto"></div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"excel-artifact": ExcelArtifact;
	}
}
