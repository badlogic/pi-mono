import { DownloadButton } from "@mariozechner/mini-lit/dist/DownloadButton.js";
import { html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { i18n } from "../../utils/i18n.js";
import { ArtifactElement } from "./ArtifactElement.js";

@customElement("generic-artifact")
export class GenericArtifact extends ArtifactElement {
	@property({ type: String }) private _content = "";

	get content(): string {
		return this._content;
	}

	set content(value: string) {
		this._content = value;
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
		// Add common MIME types
		const mimeTypes: Record<string, string> = {
			pdf: "application/pdf",
			zip: "application/zip",
			tar: "application/x-tar",
			gz: "application/gzip",
			rar: "application/vnd.rar",
			"7z": "application/x-7z-compressed",
			mp3: "audio/mpeg",
			mp4: "video/mp4",
			avi: "video/x-msvideo",
			mov: "video/quicktime",
			wav: "audio/wav",
			ogg: "audio/ogg",
			json: "application/json",
			xml: "application/xml",
			bin: "application/octet-stream",
		};
		return mimeTypes[ext || ""] || "application/octet-stream";
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

	override render(): TemplateResult {
		return html`
			<div class="h-full flex items-center justify-center bg-background p-8">
				<div class="text-center max-w-md">
					<div class="text-muted-foreground text-lg mb-4">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-16 w-16 mx-auto mb-4 text-muted-foreground/50"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
							/>
						</svg>
						<div class="font-medium text-foreground mb-2">${this.filename}</div>
						<p class="text-sm">
							${i18n("Preview not available for this file type.")} ${i18n("Click the download button above to view it on your computer.")}
						</p>
					</div>
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"generic-artifact": GenericArtifact;
	}
}
