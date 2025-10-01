import { Button, html, icon } from "@mariozechner/mini-lit";
import type { Model } from "@mariozechner/pi-ai";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { BookOpen, Loader2, Paperclip, Send, Sparkles, Square } from "lucide";
import "./AttachmentTile.js";
import { type Attachment, loadAttachment } from "./utils/attachment-utils.js";
import { i18n } from "./utils/i18n.js";

@customElement("message-editor")
export class MessageEditor extends LitElement {
	private _value = "";
	private textareaRef = createRef<HTMLTextAreaElement>();

	@property()
	get value() {
		return this._value;
	}

	set value(val: string) {
		const oldValue = this._value;
		this._value = val;
		this.requestUpdate("value", oldValue);
		this.updateComplete.then(() => {
			const textarea = this.textareaRef.value;
			if (textarea) {
				textarea.style.height = "auto";
				textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
			}
		});
	}

	@property() isStreaming = false;
	@property() currentModel?: Model<any>;
	@property() showAttachmentButton = true;
	@property() showModelSelector = true;
	@property() showThinking = false; // Disabled for now
	@property() onInput?: (value: string) => void;
	@property() onSend?: (input: string, attachments: Attachment[]) => void;
	@property() onAbort?: () => void;
	@property() onModelSelect?: () => void;
	@property() onFilesChange?: (files: Attachment[]) => void;
	@property() attachments: Attachment[] = [];
	@property() maxFiles = 10;
	@property() maxFileSize = 20 * 1024 * 1024; // 20MB
	@property() acceptedTypes =
		"image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml";

	@state() processingFiles = false;
	private fileInputRef = createRef<HTMLInputElement>();

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	private handleTextareaInput = (e: Event) => {
		const textarea = e.target as HTMLTextAreaElement;
		this.value = textarea.value;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
		this.onInput?.(this.value);
	};

	private handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (!this.isStreaming && !this.processingFiles && (this.value.trim() || this.attachments.length > 0)) {
				this.handleSend();
			}
		} else if (e.key === "Escape" && this.isStreaming) {
			e.preventDefault();
			this.onAbort?.();
		}
	};

	private handleSend = () => {
		this.onSend?.(this.value, this.attachments);
	};

	private handleAttachmentClick = () => {
		this.fileInputRef.value?.click();
	};

	private async handleFilesSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		if (files.length === 0) return;

		if (files.length + this.attachments.length > this.maxFiles) {
			alert(`Maximum ${this.maxFiles} files allowed`);
			input.value = "";
			return;
		}

		this.processingFiles = true;
		const newAttachments: Attachment[] = [];

		for (const file of files) {
			try {
				if (file.size > this.maxFileSize) {
					alert(`${file.name} exceeds maximum size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
					continue;
				}

				const attachment = await loadAttachment(file);
				newAttachments.push(attachment);
			} catch (error) {
				console.error(`Error processing ${file.name}:`, error);
				alert(`Failed to process ${file.name}: ${String(error)}`);
			}
		}

		this.attachments = [...this.attachments, ...newAttachments];
		this.onFilesChange?.(this.attachments);
		this.processingFiles = false;
		input.value = ""; // Reset input
	}

	private removeFile(fileId: string) {
		this.attachments = this.attachments.filter((f) => f.id !== fileId);
		this.onFilesChange?.(this.attachments);
	}

	private adjustTextareaHeight() {
		const textarea = this.textareaRef.value;
		if (textarea) {
			// Reset height to auto to get accurate scrollHeight
			textarea.style.height = "auto";
			// Only adjust if there's content, otherwise keep minimal height
			if (this.value.trim()) {
				textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
			}
		}
	}

	override firstUpdated() {
		const textarea = this.textareaRef.value;
		if (textarea) {
			// Don't adjust height on first render - let it be minimal
			textarea.focus();
		}
	}

	override updated() {
		// Only adjust height when component updates if there's content
		if (this.value) {
			this.adjustTextareaHeight();
		}
	}

	override render() {
		return html`
			<div class="bg-card rounded-xl border border-border shadow-sm">
				<!-- Attachments -->
				${
					this.attachments.length > 0
						? html`
							<div class="px-4 pt-3 pb-2 flex flex-wrap gap-2">
								${this.attachments.map(
									(attachment) => html`
										<attachment-tile
											.attachment=${attachment}
											.showDelete=${true}
											.onDelete=${() => this.removeFile(attachment.id)}
										></attachment-tile>
									`,
								)}
							</div>
						`
						: ""
				}

				<textarea
					class="w-full bg-transparent p-4 text-foreground placeholder-muted-foreground outline-none resize-none overflow-y-auto"
					placeholder=${i18n("Type a message...")}
					rows="1"
					style="max-height: 200px;"
					.value=${this.value}
					@input=${this.handleTextareaInput}
					@keydown=${this.handleKeyDown}
					${ref(this.textareaRef)}
				></textarea>

				<!-- Hidden file input -->
				<input
					type="file"
					${ref(this.fileInputRef)}
					@change=${this.handleFilesSelected}
					accept=${this.acceptedTypes}
					multiple
					style="display: none;"
				/>

				<!-- Button Row -->
				<div class="px-2 pb-2 flex items-center justify-between">
					<!-- Left side - attachment and quick action buttons -->
					<div class="flex gap-2 items-center">
						${
							this.showAttachmentButton
								? this.processingFiles
									? html`
										<div class="h-8 w-8 flex items-center justify-center">
											${icon(Loader2, "sm", "animate-spin text-muted-foreground")}
										</div>
									`
									: html`
										${Button({
											variant: "ghost",
											size: "icon",
											className: "h-8 w-8",
											onClick: this.handleAttachmentClick,
											children: icon(Paperclip, "sm"),
										})}
									`
								: ""
						}
					</div>

					<!-- Model selector and send on the right -->
					<div class="flex gap-2 items-center">
						${
							this.showModelSelector && this.currentModel
								? html`
									${Button({
										variant: "ghost",
										size: "sm",
										onClick: () => {
											// Focus textarea before opening model selector so focus returns there
											this.textareaRef.value?.focus();
											// Wait for next frame to ensure focus takes effect before dialog captures it
											requestAnimationFrame(() => {
												this.onModelSelect?.();
											});
										},
										children: html`
											${icon(Sparkles, "sm")}
											<span class="ml-1">${this.currentModel.id}</span>
										`,
										className: "h-8 text-xs truncate",
									})}
								`
								: ""
						}
						${
							this.isStreaming
								? html`
									${Button({
										variant: "ghost",
										size: "icon",
										onClick: this.onAbort,
										children: icon(Square, "sm"),
										className: "h-8 w-8",
									})}
								`
								: html`
									${Button({
										variant: "ghost",
										size: "icon",
										onClick: this.handleSend,
										disabled: (!this.value.trim() && this.attachments.length === 0) || this.processingFiles,
										children: html`<div style="transform: rotate(-45deg)">${icon(Send, "sm")}</div>`,
										className: "h-8 w-8",
									})}
								`
						}
					</div>
				</div>
			</div>
		`;
	}
}
