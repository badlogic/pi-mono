/**
 * Simple text input component for hooks.
 */

import { Container, Input, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

export class HookInputComponent extends Container {
	private input: Input;
	private onSubmitCallback: (value: string) => void;
	private onCancelCallback: () => void;

	constructor(
		title: string,
		_placeholder: string | undefined,
		onSubmit: (value: string) => void,
		onCancel: () => void,
	) {
		super();

		this.onSubmitCallback = onSubmit;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add title
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		// Create input
		this.input = new Input();
		this.addChild(this.input);

		this.addChild(new Spacer(1));

		// Add hint
		this.addChild(new Text(theme.fg("dim", "enter submit  esc cancel"), 1, 0));

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		// Enter
		if (matchesKey(keyData, "enter") || keyData === "\n") {
			this.onSubmitCallback(this.input.getValue());
			return;
		}

		// Escape or Ctrl+C to cancel
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "ctrl+c")) {
			this.onCancelCallback();
			return;
		}

		// Forward to input
		this.input.handleInput(keyData);
	}
}
