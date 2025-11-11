import chalk from "chalk";
import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";

/**
 * Text component - displays multi-line text with word wrapping
 */
export class Text implements Component {
	private text: string;
	private paddingX: number; // Left/right padding
	private paddingY: number; // Top/bottom padding
	private customBgRgb?: { r: number; g: number; b: number };

	// Cache for rendered output
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		text: string = "",
		paddingX: number = 1,
		paddingY: number = 1,
		customBgRgb?: { r: number; g: number; b: number },
	) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.customBgRgb = customBgRgb;
	}

	setText(text: string): void {
		this.text = text;
		// Invalidate cache when text changes
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	setCustomBgRgb(customBgRgb?: { r: number; g: number; b: number }): void {
		this.customBgRgb = customBgRgb;
		// Invalidate cache when color changes
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		// Check cache
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
			return this.cachedLines;
		}

		// Calculate available width for content (subtract horizontal padding)
		const contentWidth = Math.max(1, width - this.paddingX * 2);

		// Don't render anything if there's no actual text
		if (!this.text || this.text.trim() === "") {
			const result: string[] = [];
			// Update cache
			this.cachedText = this.text;
			this.cachedWidth = width;
			this.cachedLines = result;
			return result;
		}

		// Replace tabs with 3 spaces for consistent rendering
		const normalizedText = this.text.replace(/\t/g, "   ");

		const lines: string[] = [];
		const textLines = normalizedText.split("\n");

		for (const line of textLines) {
			// Measure visible length (strip ANSI codes)
			const visibleLineLength = visibleWidth(line);

			if (visibleLineLength <= contentWidth) {
				lines.push(line);
			} else {
				// Word wrap
				const words = line.split(" ");
				let currentLine = "";

				for (const word of words) {
					const currentVisible = visibleWidth(currentLine);
					const wordVisible = visibleWidth(word);

					if (currentVisible === 0) {
						currentLine = word;
					} else if (currentVisible + 1 + wordVisible <= contentWidth) {
						currentLine += " " + word;
					} else {
						lines.push(currentLine);
						currentLine = word;
					}
				}

				if (currentLine.length > 0) {
					lines.push(currentLine);
				}
			}
		}

		// Add padding to each line
		const leftPad = " ".repeat(this.paddingX);
		const paddedLines: string[] = [];

		for (const line of lines) {
			// Calculate visible length (strip ANSI codes)
			const visibleLength = visibleWidth(line);
			// Right padding to fill to width (accounting for left padding and content)
			const rightPadLength = Math.max(0, width - this.paddingX - visibleLength);
			const rightPad = " ".repeat(rightPadLength);
			let paddedLine = leftPad + line + rightPad;

			// Apply background color if specified
			if (this.customBgRgb) {
				paddedLine = chalk.bgRgb(this.customBgRgb.r, this.customBgRgb.g, this.customBgRgb.b)(paddedLine);
			}

			paddedLines.push(paddedLine);
		}

		// Add top padding (empty lines)
		const emptyLine = " ".repeat(width);
		const topPadding: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			let emptyPaddedLine = emptyLine;
			if (this.customBgRgb) {
				emptyPaddedLine = chalk.bgRgb(this.customBgRgb.r, this.customBgRgb.g, this.customBgRgb.b)(emptyPaddedLine);
			}
			topPadding.push(emptyPaddedLine);
		}

		// Add bottom padding (empty lines)
		const bottomPadding: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			let emptyPaddedLine = emptyLine;
			if (this.customBgRgb) {
				emptyPaddedLine = chalk.bgRgb(this.customBgRgb.r, this.customBgRgb.g, this.customBgRgb.b)(emptyPaddedLine);
			}
			bottomPadding.push(emptyPaddedLine);
		}

		// Combine top padding, content, and bottom padding
		const result = [...topPadding, ...paddedLines, ...bottomPadding];

		// Update cache
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;

		return result.length > 0 ? result : [""];
	}
}
