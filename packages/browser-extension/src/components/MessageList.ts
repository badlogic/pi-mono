import { html } from "@mariozechner/mini-lit";
import type {
	AgentTool,
	AssistantMessage as AssistantMessageType,
	Message,
	ToolResultMessage as ToolResultMessageType,
} from "@mariozechner/pi-ai";
import { LitElement, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

export class MessageList extends LitElement {
	@property({ type: Array }) messages: Message[] = [];
	@property({ type: Array }) tools: AgentTool[] = [];
	@property({ type: Object }) pendingToolCalls?: Set<string>;
	@property({ type: Boolean }) isStreaming: boolean = false;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	private buildRenderItems() {
		// Map tool results by call id for quick lookup
		const resultByCallId = new Map<string, ToolResultMessageType>();
		for (const message of this.messages) {
			if (message.role === "toolResult") {
				resultByCallId.set(message.toolCallId, message);
			}
		}

		const items: Array<{ key: string; template: TemplateResult }> = [];
		let index = 0;
		for (const msg of this.messages) {
			if (msg.role === "user") {
				items.push({
					key: `msg:${index}`,
					template: html`<user-message .message=${msg}></user-message>`,
				});
				index++;
			} else if (msg.role === "assistant") {
				const amsg = msg as AssistantMessageType;
				items.push({
					key: `msg:${index}`,
					template: html`<assistant-message
						.message=${amsg}
						.tools=${this.tools}
						.isStreaming=${this.isStreaming}
						.pendingToolCalls=${this.pendingToolCalls}
						.toolResultsById=${resultByCallId}
						.hideToolCalls=${false}
					></assistant-message>`,
				});
				index++;
			} else {
				// Skip standalone toolResult messages; they are rendered via paired tool-message above
				// For completeness, other roles are not expected
			}
		}
		return items;
	}

	override render() {
		const items = this.buildRenderItems();
		return html`<div class="flex flex-col gap-3">
			${repeat(
				items,
				(it) => it.key,
				(it) => it.template,
			)}
		</div>`;
	}
}

// Register custom element
if (!customElements.get("message-list")) {
	customElements.define("message-list", MessageList);
}
