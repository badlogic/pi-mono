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

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		const result: string[] = [];

		// Empty line padded to width
		const emptyLine = " ".repeat(width);

		// Add vertical padding above
		for (let i = 0; i < this.paddingY; i++) {
			result.push(emptyLine);
		}

		// Calculate available width after horizontal padding
		const availableWidth = Math.max(1, width - this.paddingX * 2);

		// Take only the first line (stop at newline)
		let singleLineText = this.text;
		const newlineIndex = this.text.indexOf("\n");
		if (newlineIndex !== -1) {
			singleLineText = this.text.substring(0, newlineIndex);
		}

		// Truncate text if needed (accounting for ANSI codes)
		let displayText = singleLineText;
		const textVisibleWidth = visibleWidth(singleLineText);

		if (textVisibleWidth > availableWidth) {
			// Need to truncate - walk through the string character by character
			let currentWidth = 0;
			let truncateAt = 0;
			let i = 0;
			const ellipsisWidth = 3;
			const targetWidth = availableWidth - ellipsisWidth;

			while (i < singleLineText.length && currentWidth < targetWidth) {
				// Skip ANSI escape sequences (include them in output but don't count width)
				if (singleLineText[i] === "\x1b" && singleLineText[i + 1] === "[") {
					let j = i + 2;
					while (j < singleLineText.length && !/[a-zA-Z]/.test(singleLineText[j])) {
						j++;
					}
					// Include the final letter of the escape sequence
					j++;
					truncateAt = j;
					i = j;
					continue;
				}

				const char = singleLineText[i];
				const charWidth = visibleWidth(char);

				if (currentWidth + charWidth > targetWidth) {
					break;
				}

				currentWidth += charWidth;
				truncateAt = i + 1;
				i++;
			}

			// Add reset code before ellipsis to prevent styling leaking into it
			displayText = singleLineText.substring(0, truncateAt) + "\x1b[0m...";
		}

		// Add horizontal padding
		const leftPadding = " ".repeat(this.paddingX);
		const rightPadding = " ".repeat(this.paddingX);
		const lineWithPadding = leftPadding + displayText + rightPadding;

		// Pad line to exactly width characters
		const lineVisibleWidth = visibleWidth(lineWithPadding);
		const paddingNeeded = Math.max(0, width - lineVisibleWidth);
		const finalLine = lineWithPadding + " ".repeat(paddingNeeded);

		result.push(finalLine);

		// Add vertical padding below
		for (let i = 0; i < this.paddingY; i++) {
			result.push(emptyLine);
		}

		return result;
	}
}
