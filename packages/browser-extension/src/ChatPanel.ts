import { html } from "@mariozechner/mini-lit";
import type { Model } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ModelSelector } from "./dialogs/ModelSelector.js";
import "./MessageEditor.js";
import type { Attachment } from "./utils/attachment-utils.js";

@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
	@state() currentModel: Model<any> | null = null;
	@state() messageText = "";
	@state() attachments: Attachment[] = [];

	createRenderRoot() {
		return this;
	}

	override async connectedCallback() {
		super.connectedCallback();
		// Set default model
		this.currentModel = getModel("anthropic", "claude-3-5-haiku-20241022");
	}

	private handleSend = (text: string, attachments: Attachment[]) => {
		// For now just alert and clear
		alert(`Message: ${text}\nAttachments: ${attachments.length}`);
		this.messageText = "";
		this.attachments = [];
	};

	private handleModelSelect = () => {
		ModelSelector.open(this.currentModel, (model) => {
			this.currentModel = model;
		});
	};

	render() {
		return html`
			<div class="flex flex-col h-full">
				<!-- Messages area (empty for now) -->
				<div class="flex-1 overflow-y-auto p-4">
					<!-- Messages will go here -->
				</div>

				<!-- Message editor at the bottom -->
				<div class="p-4 border-t border-border">
					<message-editor
						.value=${this.messageText}
						.currentModel=${this.currentModel}
						.attachments=${this.attachments}
						.showAttachmentButton=${true}
						.showThinking=${false}
						.onInput=${(value: string) => {
							this.messageText = value;
						}}
						.onSend=${this.handleSend}
						.onModelSelect=${this.handleModelSelect}
						.onFilesChange=${(files: Attachment[]) => {
							this.attachments = files;
						}}
					></message-editor>
				</div>
			</div>
		`;
	}
}
