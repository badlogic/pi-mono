import chalk from "chalk";
import type { Component } from "../tui.js";

export interface SelectItem {
	value: string;
	label: string;
	description?: string;
}

export class SelectList implements Component {
	private items: SelectItem[] = [];
	private filteredItems: SelectItem[] = [];
	private selectedIndex: number = 0;
	private filter: string = "";
	private maxVisible: number = 5;

	public onSelect?: (item: SelectItem) => void;
	public onCancel?: () => void;

	constructor(items: SelectItem[], maxVisible: number = 5) {
		this.items = items;
		this.filteredItems = items;
		this.maxVisible = maxVisible;
	}

	setFilter(filter: string): void {
		this.filter = filter;
		this.filteredItems = this.items.filter((item) => item.value.toLowerCase().startsWith(filter.toLowerCase()));
		// Reset selection when filter changes
		this.selectedIndex = 0;
	}

	render(width: number): string[] {
		const lines: string[] = [];

		// If no items match filter, show message
		if (this.filteredItems.length === 0) {
			lines.push(chalk.gray("  No matching commands"));
			return lines;
		}

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

		// Render visible items
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;

			let line = "";
			if (isSelected) {
				// Use arrow indicator for selection
				const prefix = chalk.blue("→ ");
				const displayValue = item.label || item.value;

				if (item.description && width > 40) {
					// Calculate how much space we have for value + description
					const maxValueLength = Math.min(displayValue.length, 30);
					const truncatedValue = displayValue.substring(0, maxValueLength);
					const spacing = " ".repeat(Math.max(1, 32 - truncatedValue.length));

					// Calculate remaining space for description
					const descriptionStart = prefix.length + truncatedValue.length + spacing.length - 2; // -2 for arrow color codes
					const remainingWidth = width - descriptionStart - 2; // -2 for safety

					if (remainingWidth > 10) {
						const truncatedDesc = item.description.substring(0, remainingWidth);
						line = prefix + chalk.blue(truncatedValue) + chalk.gray(spacing + truncatedDesc);
					} else {
						// Not enough space for description
						const maxWidth = width - 4; // 2 for arrow + space, 2 for safety
						line = prefix + chalk.blue(displayValue.substring(0, maxWidth));
					}
				} else {
					// No description or not enough width
					const maxWidth = width - 4; // 2 for arrow + space, 2 for safety
					line = prefix + chalk.blue(displayValue.substring(0, maxWidth));
				}
			} else {
				const displayValue = item.label || item.value;
				const prefix = "  ";

				if (item.description && width > 40) {
					// Calculate how much space we have for value + description
					const maxValueLength = Math.min(displayValue.length, 30);
					const truncatedValue = displayValue.substring(0, maxValueLength);
					const spacing = " ".repeat(Math.max(1, 32 - truncatedValue.length));

					// Calculate remaining space for description
					const descriptionStart = prefix.length + truncatedValue.length + spacing.length;
					const remainingWidth = width - descriptionStart - 2; // -2 for safety

					if (remainingWidth > 10) {
						const truncatedDesc = item.description.substring(0, remainingWidth);
						line = prefix + truncatedValue + chalk.gray(spacing + truncatedDesc);
					} else {
						// Not enough space for description
						const maxWidth = width - prefix.length - 2;
						line = prefix + displayValue.substring(0, maxWidth);
					}
				} else {
					// No description or not enough width
					const maxWidth = width - prefix.length - 2;
					line = prefix + displayValue.substring(0, maxWidth);
				}
			}

			lines.push(line);
		}

		// Add scroll indicators if needed
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			const scrollInfo = chalk.gray(`  (${this.selectedIndex + 1}/${this.filteredItems.length})`);
			lines.push(scrollInfo);
		}

		return lines;
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (keyData === "\x1b[A") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		}
		// Down arrow
		else if (keyData === "\x1b[B") {
			this.selectedIndex = Math.min(this.filteredItems.length - 1, this.selectedIndex + 1);
		}
		// Enter
		else if (keyData === "\r") {
			const selectedItem = this.filteredItems[this.selectedIndex];
			if (selectedItem && this.onSelect) {
				this.onSelect(selectedItem);
			}
		}
		// Escape
		else if (keyData === "\x1b") {
			if (this.onCancel) {
				this.onCancel();
			}
		}
	}

	getSelectedItem(): SelectItem | null {
		const item = this.filteredItems[this.selectedIndex];
		return item || null;
	}
}
