import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogContent, DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { i18n } from "../utils/i18n.js";

@customElement("persistent-storage-dialog")
export class PersistentStorageDialog extends DialogBase {
	@state() private requesting = false;

	private resolvePromise?: (userApproved: boolean) => void;

	protected modalWidth = "min(500px, 90vw)";
	protected modalHeight = "auto";

	/**
	 * Request persistent storage permission.
	 * Returns true if browser granted persistent storage, false otherwise.
	 */
	static async request(): Promise<boolean> {
		// Check if already persisted
		if (navigator.storage?.persisted) {
			const alreadyPersisted = await navigator.storage.persisted();
			if (alreadyPersisted) {
				console.log("✓ Persistent storage already granted");
				return true;
			}
		}

		// Show dialog and wait for user response
		const dialog = new PersistentStorageDialog();
		dialog.open();

		const userApproved = await new Promise<boolean>((resolve) => {
			dialog.resolvePromise = resolve;
		});

		if (!userApproved) {
			console.warn("⚠ User declined persistent storage - sessions may be lost");
			return false;
		}

		// User approved, request from browser
		if (!navigator.storage?.persist) {
			console.warn("⚠ Persistent storage API not available");
			return false;
		}

		try {
			const granted = await navigator.storage.persist();
			if (granted) {
				console.log("✓ Persistent storage granted - sessions will be preserved");
			} else {
				console.warn("⚠ Browser denied persistent storage - sessions may be lost under storage pressure");
			}
			return granted;
		} catch (error) {
			console.error("Failed to request persistent storage:", error);
			return false;
		}
	}

	private handleGrant() {
		if (this.resolvePromise) {
			this.resolvePromise(true);
			this.resolvePromise = undefined;
		}
		this.close();
	}

	private handleDeny() {
		if (this.resolvePromise) {
			this.resolvePromise(false);
			this.resolvePromise = undefined;
		}
		this.close();
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
						title: i18n("Storage Permission Required"),
						description: i18n("This app needs persistent storage to save your conversations"),
					})}

					<div class="mt-4 flex flex-col gap-4">
						<div class="flex gap-3 p-4 bg-warning/10 border border-warning/20 rounded-lg">
							<div class="flex-shrink-0 text-warning">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
									<line x1="12" y1="9" x2="12" y2="13"></line>
									<line x1="12" y1="17" x2="12.01" y2="17"></line>
								</svg>
							</div>
							<div class="text-sm">
								<p class="font-medium text-foreground mb-1">${i18n("Why is this needed?")}</p>
								<p class="text-muted-foreground">
									${i18n(
										"Without persistent storage, your browser may delete saved conversations when it needs disk space. Granting this permission ensures your chat history is preserved.",
									)}
								</p>
							</div>
						</div>

						<div class="text-sm text-muted-foreground">
							<p class="mb-2">${i18n("What this means:")}</p>
							<ul class="list-disc list-inside space-y-1 ml-2">
								<li>${i18n("Your conversations will be saved locally in your browser")}</li>
								<li>${i18n("Data will not be deleted automatically to free up space")}</li>
								<li>${i18n("You can still manually clear data at any time")}</li>
								<li>${i18n("No data is sent to external servers")}</li>
							</ul>
						</div>
					</div>

					<div class="mt-6 flex gap-3 justify-end">
						${Button({
							variant: "outline",
							onClick: () => this.handleDeny(),
							disabled: this.requesting,
							children: i18n("Continue Anyway"),
						})}
						${Button({
							variant: "default",
							onClick: () => this.handleGrant(),
							disabled: this.requesting,
							children: this.requesting ? i18n("Requesting...") : i18n("Grant Permission"),
						})}
					</div>
				`,
			})}
		`;
	}
}
