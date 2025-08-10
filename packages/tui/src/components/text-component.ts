import { type Component, type ComponentRenderResult, getNextComponentId, type Padding } from "../tui.js";

export class TextComponent implements Component {
	readonly id = getNextComponentId();
	private text: string;
	private lastRenderedLines: string[] = [];
	private padding: Required<Padding>;

	constructor(text: string, padding?: Padding) {
		this.text = text;
		this.padding = {
			top: padding?.top ?? 0,
			bottom: padding?.bottom ?? 0,
			left: padding?.left ?? 0,
			right: padding?.right ?? 0,
		};
	}

	render(width: number): ComponentRenderResult {
		// Calculate available width after horizontal padding
		const availableWidth = Math.max(1, width - this.padding.left - this.padding.right);
		const leftPadding = " ".repeat(this.padding.left);

		// First split by newlines to preserve line breaks
		const textLines = this.text.split("\n");
		const lines: string[] = [];

		// Add top padding
		for (let i = 0; i < this.padding.top; i++) {
			lines.push("");
		}

		// Process each line for word wrapping
		for (const textLine of textLines) {
			if (textLine.length === 0) {
				// Preserve empty lines with padding
				lines.push(leftPadding);
			} else {
				// Word wrapping with ANSI-aware length calculation
				const words = textLine.split(" ");
				let currentLine = "";
				let currentVisibleLength = 0;

				for (const word of words) {
					const wordVisibleLength = this.getVisibleLength(word);
					const spaceLength = currentLine ? 1 : 0;

					if (currentVisibleLength + spaceLength + wordVisibleLength <= availableWidth) {
						currentLine += (currentLine ? " " : "") + word;
						currentVisibleLength += spaceLength + wordVisibleLength;
					} else {
						if (currentLine) {
							lines.push(leftPadding + currentLine);
						}
						currentLine = word;
						currentVisibleLength = wordVisibleLength;
					}
				}

				if (currentLine) {
					lines.push(leftPadding + currentLine);
				}
			}
		}

		// Add bottom padding
		for (let i = 0; i < this.padding.bottom; i++) {
			lines.push("");
		}

		const newLines = lines.length > 0 ? lines : [""];

		// Check if content changed
		const changed = !this.arraysEqual(newLines, this.lastRenderedLines);

		// Always cache the current rendered lines
		this.lastRenderedLines = [...newLines];

		return {
			lines: newLines,
			changed,
		};
	}

	setText(text: string): void {
		this.text = text;
	}

	getText(): string {
		return this.text;
	}

	private arraysEqual(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

	private getVisibleLength(str: string): number {
		// Remove ANSI escape codes and count visible characters
		return (str || "").replace(/\x1b\[[0-9;]*m/g, "").length;
	}
}
