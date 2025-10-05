import { DialogBase, DialogContent, DialogHeader, html } from "@mariozechner/mini-lit";
import { customElement, state } from "lit/decorators.js";
import "../components/ProviderKeyInput.js";
import { getAppStorage } from "../storage/app-storage.js";
import { i18n } from "../utils/i18n.js";

@customElement("api-key-prompt-dialog")
export class ApiKeyPromptDialog extends DialogBase {
	@state() private provider = "";

	private resolvePromise?: (success: boolean) => void;
	private unsubscribe?: () => void;

	protected modalWidth = "min(500px, 90vw)";
	protected modalHeight = "auto";

	static async prompt(provider: string): Promise<boolean> {
		const dialog = new ApiKeyPromptDialog();
		dialog.provider = provider;
		dialog.open();

		return new Promise((resolve) => {
			dialog.resolvePromise = resolve;
		});
	}

	override async connectedCallback() {
		super.connectedCallback();

		// Poll for key existence - when key is added, resolve and close
		const checkInterval = setInterval(async () => {
			const hasKey = await getAppStorage().providerKeys.hasKey(this.provider);
			if (hasKey) {
				clearInterval(checkInterval);
				if (this.resolvePromise) {
					this.resolvePromise(true);
					this.resolvePromise = undefined;
				}
				this.close();
			}
		}, 500);

		this.unsubscribe = () => clearInterval(checkInterval);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
	}

	override close() {
		super.close();
		if (this.resolvePromise) {
			this.resolvePromise(false);
		}
	}

	protected override renderContent() {
		return html`
			${DialogContent({
				children: html`
					${DialogHeader({
						title: i18n("API Key Required"),
						description: i18n("Enter your API key for {provider}").replace("{provider}", this.provider),
					})}
					<div class="mt-4">
						<provider-key-input .provider=${this.provider}></provider-key-input>
					</div>
				`,
			})}
		`;
	}
}
