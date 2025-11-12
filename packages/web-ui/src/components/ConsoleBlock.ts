import { icon } from "@mariozechner/mini-lit";
import { LitElement } from "lit";
import { property, state } from "lit/decorators.js";
import { html } from "lit/html.js";
import { Check, Copy } from "lucide";
import { i18n } from "../utils/i18n.js";

export class ConsoleBlock extends LitElement {
	@property() content: string = "";
	@property() variant: "default" | "error" = "default";
	@state() private copied = false;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	private async copy() {
		try {
			await navigator.clipboard.writeText(this.content || "");
			this.copied = true;
			setTimeout(() => {
				this.copied = false;
			}, 1500);
		} catch (e) {
			console.error("Copy failed", e);
		}
	}

	override updated() {
		// Auto-scroll to bottom on content changes
		const container = this.querySelector(".console-scroll") as HTMLElement | null;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}

	override render() {
		const isError = this.variant === "error";
		const textClass = isError ? "text-destructive" : "text-foreground";

		return html`
			<div class="border border-border rounded-lg overflow-hidden">
				<div class="flex items-center justify-between px-3 py-1.5 bg-muted border-b border-border">
					<span class="text-xs text-muted-foreground font-mono">${i18n("console")}</span>
					<button
						@click=${() => this.copy()}
						class="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors"
						title="${i18n("Copy output")}"
					>
						${this.copied ? icon(Check, "sm") : icon(Copy, "sm")}
						${this.copied ? html`<span>${i18n("Copied!")}</span>` : ""}
					</button>
				</div>
				<div class="console-scroll overflow-auto max-h-64">
					<pre class="!bg-background !border-0 !rounded-none m-0 p-3 text-xs ${textClass} font-mono whitespace-pre-wrap">
${this.content || ""}</pre
					>
				</div>
			</div>
		`;
	}
}

// Register custom element
if (!customElements.get("console-block")) {
	customElements.define("console-block", ConsoleBlock);
}
