import { icon } from "@mariozechner/mini-lit";
import "@mariozechner/mini-lit/dist/CopyButton.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { ChevronDown, ChevronRight, ChevronsDown, Lock } from "lucide";
import { i18n } from "../../utils/i18n.js";

interface LogEntry {
	type: "log" | "error";
	text: string;
}

@customElement("artifact-console")
export class Console extends LitElement {
	@property({ attribute: false }) logs: LogEntry[] = [];
	@state() private expanded = false;
	@state() private autoscroll = true;
	private logsContainerRef: Ref<HTMLDivElement> = createRef();

	protected createRenderRoot() {
		return this; // light DOM
	}

	override updated() {
		// Autoscroll to bottom when new logs arrive
		if (this.autoscroll && this.expanded && this.logsContainerRef.value) {
			this.logsContainerRef.value.scrollTop = this.logsContainerRef.value.scrollHeight;
		}
	}

	private getLogsText(): string {
		return this.logs.map((l) => `[${l.type}] ${l.text}`).join("\n");
	}

	override render(): TemplateResult {
		const errorCount = this.logs.filter((l) => l.type === "error").length;
		const summary =
			errorCount > 0
				? `${i18n("console")} (${errorCount} ${errorCount === 1 ? "error" : "errors"})`
				: `${i18n("console")} (${this.logs.length})`;

		return html`
			<div class="border-t border-border p-2">
				<div class="flex items-center gap-2 w-full">
					<button
						@click=${() => {
							this.expanded = !this.expanded;
						}}
						class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors flex-1 text-left"
					>
						${icon(this.expanded ? ChevronDown : ChevronRight, "sm")}
						<span>${summary}</span>
					</button>
					${
						this.expanded
							? html`
							<button
								@click=${() => {
									this.autoscroll = !this.autoscroll;
								}}
								class="p-1 rounded transition-colors ${this.autoscroll ? "bg-accent text-accent-foreground" : "hover:bg-muted"}"
								title=${this.autoscroll ? i18n("Autoscroll enabled") : i18n("Autoscroll disabled")}
							>
								${icon(this.autoscroll ? ChevronsDown : Lock, "sm")}
							</button>
							<copy-button .text=${this.getLogsText()} title=${i18n("Copy logs")} .showText=${false} class="!bg-transparent hover:!bg-accent"></copy-button>
						`
							: ""
					}
				</div>
				${
					this.expanded
						? html`
						<div class="max-h-48 overflow-y-auto space-y-1 mt-2" ${ref(this.logsContainerRef)}>
							${repeat(
								this.logs,
								(_log, index) => index,
								(log) => html`
									<div class="text-xs font-mono ${log.type === "error" ? "text-destructive" : "text-muted-foreground"}">
										[${log.type}] ${log.text}
									</div>
								`,
							)}
						</div>
					`
						: ""
				}
			</div>
		`;
	}
}
