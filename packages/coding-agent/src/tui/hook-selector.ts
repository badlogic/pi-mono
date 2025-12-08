import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { SelectorItem } from "../hooks/types.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/**
 * Generic selector component for hooks.
 * Displays a list of items with keyboard navigation.
 */
export class HookSelectorComponent extends Container {
	private items: SelectorItem[];
	private selectedIndex: number = 0;
	private listContainer: Container;
	private onSelectCallback: (id: string) => void;
	private onCancelCallback: () => void;

	constructor(title: string, items: SelectorItem[], onSelect: (id: string) => void, onCancel: () => void) {
		super();

		this.items = items;
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

		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			const isSelected = i === this.selectedIndex;

			let text = "";
			if (isSelected) {
				text = theme.fg("accent", "→ ") + theme.fg("accent", item.label);
			} else {
				text = "  " + theme.fg("text", item.label);
			}

			if (item.hint) {
				text += "  " + theme.fg("dim", item.hint);
			}

			this.listContainer.addChild(new Text(text, 1, 0));
		}
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (keyData === "\x1b[A" || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		}
		// Down arrow
		else if (keyData === "\x1b[B" || keyData === "j") {
			this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
			this.updateList();
		}
		// Enter
		else if (keyData === "\r" || keyData === "\n") {
			const selected = this.items[this.selectedIndex];
			if (selected) {
				this.onSelectCallback(selected.id);
			}
		}
		// Escape
		else if (keyData === "\x1b") {
			this.onCancelCallback();
		}
	}
}
