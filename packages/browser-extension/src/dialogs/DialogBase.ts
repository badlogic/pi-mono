import { Dialog } from "@mariozechner/mini-lit/dist/Dialog.js";
import { LitElement, type TemplateResult } from "lit";

export abstract class DialogBase extends LitElement {
	// Modal configuration - can be overridden by subclasses
	protected modalWidth = "min(600px, 90vw)";
	protected modalHeight = "min(600px, 80vh)";
	private boundHandleKeyDown?: (e: KeyboardEvent) => void;
	private previousFocus?: HTMLElement;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	open() {
		// Store the currently focused element
		this.previousFocus = document.activeElement as HTMLElement;

		document.body.appendChild(this);
		this.boundHandleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				this.close();
			}
		};
		window.addEventListener("keydown", this.boundHandleKeyDown);

		// Apply custom backdrop styling after render
		requestAnimationFrame(() => {
			const backdrop = this.querySelector(".fixed.inset-0");
			if (backdrop instanceof HTMLElement) {
				backdrop.classList.remove("bg-black/50");
				backdrop.classList.add("bg-background/80", "backdrop-blur-sm");
			}
		});
	}

	close() {
		if (this.boundHandleKeyDown) {
			window.removeEventListener("keydown", this.boundHandleKeyDown);
		}
		this.remove();

		// Restore focus to the previously focused element
		if (this.previousFocus?.focus) {
			// Use requestAnimationFrame to ensure the dialog is fully removed first
			requestAnimationFrame(() => {
				this.previousFocus?.focus();
			});
		}
	}

	// Abstract method that subclasses must implement
	protected abstract renderContent(): TemplateResult;

	override render() {
		return Dialog({
			isOpen: true,
			onClose: () => this.close(),
			width: this.modalWidth,
			height: this.modalHeight,
			children: this.renderContent(),
		});
	}
}
