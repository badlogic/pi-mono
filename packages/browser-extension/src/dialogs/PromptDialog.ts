import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogContent, DialogFooter, DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type PropertyValues, type TemplateResult } from "lit";
import { customElement } from "lit/decorators/custom-element.js";
import { property } from "lit/decorators/property.js";
import { state } from "lit/decorators/state.js";
import { createRef } from "lit/directives/ref.js";
import { i18n } from "../utils/i18n.js";
import { DialogBase } from "./DialogBase.js";

@customElement("prompt-dialog")
export class PromptDialog extends DialogBase {
	@property() headerTitle = "";
	@property() message = "";
	@property() defaultValue = "";
	@property() isPassword = false;

	@state() private inputValue = "";
	private resolvePromise?: (value: string | undefined) => void;
	private inputRef = createRef<HTMLInputElement>();

	protected override modalWidth = "min(400px, 90vw)";
	protected override modalHeight = "auto";

	static async ask(
		title: string,
		message: string,
		defaultValue = "",
		isPassword = false,
	): Promise<string | undefined> {
		const dialog = new PromptDialog();
		dialog.headerTitle = title;
		dialog.message = message;
		dialog.defaultValue = defaultValue;
		dialog.isPassword = isPassword;
		dialog.inputValue = defaultValue;

		return new Promise((resolve) => {
			dialog.resolvePromise = resolve;
			dialog.open();
		});
	}

	protected override firstUpdated(_changedProperties: PropertyValues): void {
		super.firstUpdated(_changedProperties);
		this.inputRef.value?.focus();
	}

	private handleConfirm() {
		this.resolvePromise?.(this.inputValue);
		this.close();
	}

	private handleCancel() {
		this.resolvePromise?.(undefined);
		this.close();
	}

	protected override renderContent(): TemplateResult {
		return DialogContent({
			children: html`
				${DialogHeader({
					title: this.headerTitle || i18n("Input Required"),
					description: this.message,
				})}
				${Input({
					type: this.isPassword ? "password" : "text",
					value: this.inputValue,
					className: "w-full",
					inputRef: this.inputRef,
					onInput: (e: Event) => {
						this.inputValue = (e.target as HTMLInputElement).value;
					},
					onKeyDown: (e: KeyboardEvent) => {
						if (e.key === "Enter") this.handleConfirm();
						if (e.key === "Escape") this.handleCancel();
					},
				})}
				${DialogFooter({
					children: html`
						${Button({
							variant: "outline",
							onClick: () => this.handleCancel(),
							children: i18n("Cancel"),
						})}
						${Button({
							variant: "default",
							onClick: () => this.handleConfirm(),
							children: i18n("Confirm"),
						})}
					`,
				})}
			`,
		});
	}
}

export default PromptDialog;
