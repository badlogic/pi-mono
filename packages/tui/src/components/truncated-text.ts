import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";

/**
 * Text component that truncates to fit viewport width
 */
export class TruncatedText implements Component {
	private text: string;
	private paddingX: number;
	private paddingY: number;

	constructor(text: string, paddingX: number = 0, paddingY: number = 0) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
	}

	render(width: number): string[] {
		const result: string[] = [];

		// Add vertical padding above
		for (let i = 0; i < this.paddingY; i++) {
			result.push("");
		}

		// Calculate available width after horizontal padding
		const availableWidth = Math.max(1, width - this.paddingX * 2);

		// Truncate text if needed (accounting for ANSI codes)
		let displayText = this.text;
		const textVisibleWidth = visibleWidth(this.text);

		if (textVisibleWidth > availableWidth) {
			// Need to truncate - walk through the string character by character
			let currentWidth = 0;
			let truncateAt = 0;
			let i = 0;
			const ellipsisWidth = 3;
			const targetWidth = availableWidth - ellipsisWidth;

			while (i < this.text.length && currentWidth < targetWidth) {
				// Skip ANSI escape sequences
				if (this.text[i] === "\x1b" && this.text[i + 1] === "[") {
					let j = i + 2;
					while (j < this.text.length && !/[a-zA-Z]/.test(this.text[j])) {
						j++;
					}
					i = j + 1;
					continue;
				}

				const char = this.text[i];
				const charWidth = visibleWidth(char);

				if (currentWidth + charWidth > targetWidth) {
					break;
				}

				currentWidth += charWidth;
				truncateAt = i + 1;
				i++;
			}

			displayText = this.text.substring(0, truncateAt) + "...";
		}

		// Add horizontal padding
		const paddingStr = " ".repeat(this.paddingX);
		result.push(paddingStr + displayText);

		// Add vertical padding below
		for (let i = 0; i < this.paddingY; i++) {
			result.push("");
		}

		return result;
	}
}
