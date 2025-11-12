import { i18n } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { CustomProvider } from "../storage/stores/custom-providers-store.js";

@customElement("custom-provider-card")
export class CustomProviderCard extends LitElement {
	@property({ type: Object }) provider!: CustomProvider;
	@property({ type: Boolean }) isAutoDiscovery = false;
	@property({ type: Object }) status?: { modelCount: number; status: "connected" | "disconnected" | "checking" };
	@property() onRefresh?: (provider: CustomProvider) => void;
	@property() onEdit?: (provider: CustomProvider) => void;
	@property() onDelete?: (provider: CustomProvider) => void;

	protected createRenderRoot() {
		return this;
	}

	private renderStatus(): TemplateResult {
		if (!this.isAutoDiscovery) {
			return html`
				<div class="text-xs text-muted-foreground mt-1">
					${i18n("Models")}: ${this.provider.models?.length || 0}
				</div>
			`;
		}

		if (!this.status) return html``;

		const statusIcon =
			this.status.status === "connected"
				? html`<span class="text-green-500">●</span>`
				: this.status.status === "checking"
					? html`<span class="text-yellow-500">●</span>`
					: html`<span class="text-red-500">●</span>`;

		const statusText =
			this.status.status === "connected"
				? `${this.status.modelCount} ${i18n("models")}`
				: this.status.status === "checking"
					? i18n("Checking...")
					: i18n("Disconnected");

		return html`
			<div class="text-xs text-muted-foreground mt-1 flex items-center gap-1">
				${statusIcon} ${statusText}
			</div>
		`;
	}

	render(): TemplateResult {
		return html`
			<div class="border border-border rounded-lg p-4 space-y-2">
				<div class="flex items-center justify-between">
					<div class="flex-1">
						<div class="font-medium text-sm text-foreground">${this.provider.name}</div>
						<div class="text-xs text-muted-foreground mt-1">
							<span class="capitalize">${this.provider.type}</span>
							${this.provider.baseUrl ? html` • ${this.provider.baseUrl}` : ""}
						</div>
						${this.renderStatus()}
					</div>
					<div class="flex gap-2">
						${
							this.isAutoDiscovery && this.onRefresh
								? Button({
										onClick: () => this.onRefresh?.(this.provider),
										variant: "ghost",
										size: "sm",
										children: i18n("Refresh"),
									})
								: ""
						}
						${
							this.onEdit
								? Button({
										onClick: () => this.onEdit?.(this.provider),
										variant: "ghost",
										size: "sm",
										children: i18n("Edit"),
									})
								: ""
						}
						${
							this.onDelete
								? Button({
										onClick: () => this.onDelete?.(this.provider),
										variant: "ghost",
										size: "sm",
										children: i18n("Delete"),
									})
								: ""
						}
					</div>
				</div>
			</div>
		`;
	}
}
