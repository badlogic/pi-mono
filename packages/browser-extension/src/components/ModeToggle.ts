import { html } from "@mariozechner/mini-lit";
import { LitElement } from "lit";
import { property } from "lit/decorators.js";

export class ModeToggle extends LitElement {
	@property({ type: Array }) modes: string[] = ["Mode 1", "Mode 2"];
	@property({ type: Number }) selectedIndex = 0;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	private setMode(index: number) {
		if (this.selectedIndex !== index && index >= 0 && index < this.modes.length) {
			this.selectedIndex = index;
			this.dispatchEvent(
				new CustomEvent<{ index: number; mode: string }>("mode-change", {
					detail: { index, mode: this.modes[index] },
					bubbles: true,
				}),
			);
		}
	}

	override render() {
		if (this.modes.length < 2) return html``;

		return html`
			<div class="inline-flex items-center h-7 rounded-md overflow-hidden border border-border bg-muted/60">
				${this.modes.map(
					(mode, index) => html`
						<button
							class="px-3 h-full flex items-center text-sm font-medium transition-colors ${
								index === this.selectedIndex
									? "bg-card text-foreground shadow-sm"
									: "text-muted-foreground hover:text-accent-foreground"
							}"
							@click=${() => this.setMode(index)}
							title="${mode}"
						>
							${mode}
						</button>
					`,
				)}
			</div>
		`;
	}
}

// Register the custom element only once
if (!customElements.get("mode-toggle")) {
	customElements.define("mode-toggle", ModeToggle);
}
