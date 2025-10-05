import { Button, html, icon } from "@mariozechner/mini-lit";
import type {
	AgentTool,
	AssistantMessage as AssistantMessageType,
	ToolCall,
	ToolResultMessage as ToolResultMessageType,
	UserMessage as UserMessageType,
} from "@mariozechner/pi-ai";
import type { AgentToolResult } from "@mariozechner/pi-ai/dist/agent/types.js";
import { LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Bug, Loader, Wrench } from "lucide";
import { renderToolParams, renderToolResult } from "../tools/index.js";
import type { Attachment } from "../utils/attachment-utils.js";
import { formatUsage } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";

export type UserMessageWithAttachments = UserMessageType & { attachments?: Attachment[] };
export type AppMessage = AssistantMessageType | UserMessageWithAttachments | ToolResultMessageType;

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
					const aborted = !pending && !result && !this.isStreaming;
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
	@property({ type: String }) result?: AgentToolResult<any>;
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
	@state() private _showDebug = false;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	private toggleDebug = () => {
		this._showDebug = !this._showDebug;
	};

	override render() {
		const toolLabel = this.tool?.label || this.toolCall.name;
		const toolName = this.tool?.name || this.toolCall.name;
		const isError = this.result?.isError === true;
		const hasResult = !!this.result;

		let statusIcon: TemplateResult;
		if (this.pending || (this.isStreaming && !hasResult)) {
			statusIcon = html`<span class="inline-block text-muted-foreground animate-spin">${icon(Loader, "sm")}</span>`;
		} else if (this.aborted && !hasResult) {
			statusIcon = html`<span class="inline-block text-destructive">${icon(Wrench, "sm")}</span>`;
		} else if (hasResult && isError) {
			statusIcon = html`<span class="inline-block text-destructive">${icon(Wrench, "sm")}</span>`;
		} else if (hasResult) {
			statusIcon = html`<span class="inline-block text-muted-foreground">${icon(Wrench, "sm")}</span>`;
		} else {
			statusIcon = html`<span class="inline-block text-muted-foreground">${icon(Wrench, "sm")}</span>`;
		}

		// Normalize error text
		let errorMessage = this.result?.output || "";
		if (isError) {
			try {
				const parsed = JSON.parse(errorMessage);
				if ((parsed as any).error) errorMessage = (parsed as any).error;
				else if ((parsed as any).message) errorMessage = (parsed as any).message;
			} catch {}
			errorMessage = errorMessage.replace(/^(Tool )?Error:\s*/i, "");
			errorMessage = errorMessage.replace(/^Error:\s*/i, "");
		}

		const paramsTpl = renderToolParams(
			toolName,
			this.toolCall.arguments,
			this.isStreaming || (this.pending && !hasResult),
		);
		const resultTpl =
			hasResult && !isError ? renderToolResult(toolName, this.toolCall.arguments, this.result!) : undefined;

		return html`
			<div class="p-2.5 border border-border rounded-md bg-card text-card-foreground">
				<div class="flex items-center justify-between text-xs text-muted-foreground">
					<div class="flex items-center gap-2">
						${statusIcon}
						<span class="font-medium">${toolLabel}</span>
					</div>
					${Button({
						variant: this._showDebug ? "default" : "ghost",
						size: "sm",
						onClick: this.toggleDebug,
						children: icon(Bug, "sm"),
						className: "text-muted-foreground",
					})}
				</div>

				${
					this._showDebug
						? html`<tool-message-debug
							.callArgs=${this.toolCall.arguments}
							.result=${this.result}
							.hasResult=${!!this.result}
						></tool-message-debug>`
						: html`
							<div class="mt-2 text-sm text-muted-foreground">${paramsTpl}</div>
							${
								this.pending && !hasResult
									? html`<div class="mt-2 text-sm text-muted-foreground">${i18n("Waiting for tool result…")}</div>`
									: ""
							}
							${
								this.aborted && !hasResult
									? html`<div class="mt-2 text-sm text-muted-foreground">${i18n("Call was aborted; no result.")}</div>`
									: ""
							}
							${
								hasResult && isError
									? html`<div class="mt-2 p-2 border border-destructive rounded bg-destructive/10 text-sm text-destructive">
										${errorMessage}
									</div>`
									: ""
							}
							${resultTpl ? html`<div class="mt-2">${resultTpl}</div>` : ""}
						`
				}
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
