import { html } from "@mariozechner/mini-lit";
import type {
	AgentTool,
	AssistantMessage as AssistantMessageType,
	ToolCall,
	ToolResultMessage as ToolResultMessageType,
	UserMessage as UserMessageType,
} from "@mariozechner/pi-ai";
import { LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { renderTool } from "../tools/index.js";
import type { Attachment } from "../utils/attachment-utils.js";
import { formatUsage } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";

export type UserMessageWithAttachments = UserMessageType & { attachments?: Attachment[] };

// Artifact message type for session persistence
export interface ArtifactMessage {
	role: "artifact";
	action: "create" | "update" | "delete";
	filename: string;
	content?: string;
	title?: string;
	timestamp: string;
}

// Base message union
type BaseMessage = AssistantMessageType | UserMessageWithAttachments | ToolResultMessageType | ArtifactMessage;

// Extensible interface - apps can extend via declaration merging
// Example:
// declare module "@mariozechner/pi-web-ui" {
//   interface CustomMessages {
//     "system-notification": SystemNotificationMessage;
//   }
// }
export interface CustomMessages {
	// Empty by default - apps extend via declaration merging
}

// AppMessage is union of base messages + custom messages
export type AppMessage = BaseMessage | CustomMessages[keyof CustomMessages];

@customElement("user-message")
export class UserMessage extends LitElement {
	@property({ type: Object }) message!: UserMessageWithAttachments;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	override render() {
		const content =
			typeof this.message.content === "string"
				? this.message.content
				: this.message.content.find((c) => c.type === "text")?.text || "";

		return html`
			<div class="py-2 px-4 border-l-4 border-accent-foreground/60 text-primary-foreground">
				<markdown-block .content=${content}></markdown-block>
				${
					this.message.attachments && this.message.attachments.length > 0
						? html`
							<div class="mt-3 flex flex-wrap gap-2">
								${this.message.attachments.map(
									(attachment) => html` <attachment-tile .attachment=${attachment}></attachment-tile> `,
								)}
							</div>
						`
						: ""
				}
			</div>
		`;
	}
}

@customElement("assistant-message")
export class AssistantMessage extends LitElement {
	@property({ type: Object }) message!: AssistantMessageType;
	@property({ type: Array }) tools?: AgentTool<any>[];
	@property({ type: Object }) pendingToolCalls?: Set<string>;
	@property({ type: Boolean }) hideToolCalls = false;
	@property({ type: Object }) toolResultsById?: Map<string, ToolResultMessageType>;
	@property({ type: Boolean }) isStreaming: boolean = false;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	override render() {
		// Render content in the order it appears
		const orderedParts: TemplateResult[] = [];

		for (const chunk of this.message.content) {
			if (chunk.type === "text" && chunk.text.trim() !== "") {
				orderedParts.push(html`<markdown-block .content=${chunk.text}></markdown-block>`);
			} else if (chunk.type === "thinking" && chunk.thinking.trim() !== "") {
				orderedParts.push(html` <markdown-block .content=${chunk.thinking} .isThinking=${true}></markdown-block> `);
			} else if (chunk.type === "toolCall") {
				if (!this.hideToolCalls) {
					const tool = this.tools?.find((t) => t.name === chunk.name);
					const pending = this.pendingToolCalls?.has(chunk.id) ?? false;
					const result = this.toolResultsById?.get(chunk.id);
					// A tool call is aborted if the message was aborted and there's no result for this tool call
					const aborted = this.message.stopReason === "aborted" && !result;
					orderedParts.push(
						html`<tool-message
							.tool=${tool}
							.toolCall=${chunk}
							.result=${result}
							.pending=${pending}
							.aborted=${aborted}
							.isStreaming=${this.isStreaming}
						></tool-message>`,
					);
				}
			}
		}

		return html`
			<div>
				${orderedParts.length ? html` <div class="px-4 flex flex-col gap-3">${orderedParts}</div> ` : ""}
				${
					this.message.usage
						? html` <div class="px-4 mt-2 text-xs text-muted-foreground">${formatUsage(this.message.usage)}</div> `
						: ""
				}
				${
					this.message.stopReason === "error" && this.message.errorMessage
						? html`
							<div class="mx-4 mt-3 p-3 bg-destructive/10 text-destructive rounded-lg text-sm overflow-hidden">
								<strong>${i18n("Error:")}</strong> ${this.message.errorMessage}
							</div>
						`
						: ""
				}
				${
					this.message.stopReason === "aborted"
						? html`<span class="text-sm text-destructive italic">${i18n("Request aborted")}</span>`
						: ""
				}
			</div>
		`;
	}
}

@customElement("tool-message-debug")
export class ToolMessageDebugView extends LitElement {
	@property({ type: Object }) callArgs: any;
	@property({ type: Object }) result?: ToolResultMessageType;
	@property({ type: Boolean }) hasResult: boolean = false;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this; // light DOM for shared styles
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	private pretty(value: unknown): { content: string; isJson: boolean } {
		try {
			if (typeof value === "string") {
				const maybeJson = JSON.parse(value);
				return { content: JSON.stringify(maybeJson, null, 2), isJson: true };
			}
			return { content: JSON.stringify(value, null, 2), isJson: true };
		} catch {
			return { content: typeof value === "string" ? value : String(value), isJson: false };
		}
	}

	override render() {
		const output = this.pretty(this.result?.output);
		const details = this.pretty(this.result?.details);

		return html`
			<div class="mt-3 flex flex-col gap-2">
				<div>
					<div class="text-xs font-medium mb-1 text-muted-foreground">${i18n("Call")}</div>
					<code-block .code=${this.pretty(this.callArgs).content} language="json"></code-block>
				</div>
				<div>
					<div class="text-xs font-medium mb-1 text-muted-foreground">${i18n("Result")}</div>
					${
						this.hasResult
							? html`<code-block .code=${output.content} language="${output.isJson ? "json" : "text"}"></code-block>
								<code-block .code=${details.content} language="${details.isJson ? "json" : "text"}"></code-block>`
							: html`<div class="text-xs text-muted-foreground">${i18n("(no result)")}</div>`
					}
				</div>
			</div>
		`;
	}
}

@customElement("tool-message")
export class ToolMessage extends LitElement {
	@property({ type: Object }) toolCall!: ToolCall;
	@property({ type: Object }) tool?: AgentTool<any>;
	@property({ type: Object }) result?: ToolResultMessageType;
	@property({ type: Boolean }) pending: boolean = false;
	@property({ type: Boolean }) aborted: boolean = false;
	@property({ type: Boolean }) isStreaming: boolean = false;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	override render() {
		const toolName = this.tool?.name || this.toolCall.name;

		// Render tool content (renderer handles errors and styling)
		const result: ToolResultMessageType<any> | undefined = this.aborted
			? { role: "toolResult", isError: true, output: "", toolCallId: this.toolCall.id, toolName: this.toolCall.name }
			: this.result;
		const toolContent = renderTool(
			toolName,
			this.toolCall.arguments,
			result,
			!this.aborted && (this.isStreaming || this.pending),
		);

		return html`
			<div class="p-2.5 border border-border rounded-md bg-card text-card-foreground shadow-xs">
				${toolContent}
			</div>
		`;
	}
}

@customElement("aborted-message")
export class AbortedMessage extends LitElement {
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	protected override render(): unknown {
		return html`<span class="text-sm text-destructive italic">${i18n("Request aborted")}</span>`;
	}
}
