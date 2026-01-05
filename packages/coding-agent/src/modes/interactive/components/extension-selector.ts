/**
 * Generic selector component for extensions.
 * Displays a list of string options with keyboard navigation.
 */

import { Container, getEditorKeybindings, Spacer, Text } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

export class ExtensionSelectorComponent extends Container {
	private options: string[];
	private selectedIndex = 0;
	private listContainer: Container;
	private onSelectCallback: (option: string) => void;
	private onCancelCallback: () => void;

	constructor(title: string, options: string[], onSelect: (option: string) => void, onCancel: () => void) {
		super();

		this.options = options;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add title
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add hint
		this.addChild(new Text(theme.fg("dim", "↑↓ navigate  enter select  esc cancel"), 1, 0));

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Initial render
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		for (let i = 0; i < this.options.length; i++) {
			const option = this.options[i];
			const isSelected = i === this.selectedIndex;

			let text = "";
			if (isSelected) {
				text = theme.fg("accent", "→ ") + theme.fg("accent", option);
			} else {
				text = `  ${theme.fg("text", option)}`;
			}

			this.listContainer.addChild(new Text(text, 1, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		// Up arrow or k
		if (kb.matches(keyData, "selectUp") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		}
		// Down arrow or j
		else if (kb.matches(keyData, "selectDown") || keyData === "j") {
			this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "selectConfirm") || keyData === "\n") {
			const selected = this.options[this.selectedIndex];
			if (selected) {
				this.onSelectCallback(selected);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "selectCancel")) {
			this.onCancelCallback();
		}
	}
}
