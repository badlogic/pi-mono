import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";

/**
 * Input component - single-line text input with horizontal scrolling
 */
export class Input implements Component {
	private value: string = "";
	private cursor: number = 0; // Cursor position in the value
	public onSubmit?: (value: string) => void;

	getValue(): string {
		return this.value;
	}

	setValue(value: string): void {
		this.value = value;
		this.cursor = Math.min(this.cursor, value.length);
	}

	handleInput(data: string): void {
		// Handle special keys
		if (data === "\r" || data === "\n") {
			// Enter - submit
			if (this.onSubmit) {
				this.onSubmit(this.value);
			}
			return;
		}

		if (data === "\x7f" || data === "\x08") {
			// Backspace
			if (this.cursor > 0) {
				this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
				this.cursor--;
			}
			return;
		}

		if (data === "\x1b[D") {
			// Left arrow
			if (this.cursor > 0) {
				this.cursor--;
			}
			return;
		}

		if (data === "\x1b[C") {
			// Right arrow
			if (this.cursor < this.value.length) {
				this.cursor++;
			}
			return;
		}

		if (data === "\x1b[3~") {
			// Delete
			if (this.cursor < this.value.length) {
				this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
			}
			return;
		}

		if (data === "\x01") {
			// Ctrl+A - beginning of line
			this.cursor = 0;
			return;
		}

		if (data === "\x05") {
			// Ctrl+E - end of line
			this.cursor = this.value.length;
			return;
		}

		// Regular character input
		if (data.length === 1 && data >= " " && data <= "~") {
			this.value = this.value.slice(0, this.cursor) + data + this.value.slice(this.cursor);
			this.cursor++;
		}
	}

	render(width: number): string[] {
		// Calculate visible window
		const prompt = "> ";
		const availableWidth = width - prompt.length;

		if (availableWidth <= 0) {
			return [prompt];
		}

		let visibleText = "";
		let cursorDisplay = this.cursor;

		if (this.value.length < availableWidth) {
			// Everything fits (leave room for cursor at end)
			visibleText = this.value;
		} else {
			// Need horizontal scrolling
			// Reserve one character for cursor if it's at the end
			const scrollWidth = this.cursor === this.value.length ? availableWidth - 1 : availableWidth;
			const halfWidth = Math.floor(scrollWidth / 2);

			if (this.cursor < halfWidth) {
				// Cursor near start
				visibleText = this.value.slice(0, scrollWidth);
				cursorDisplay = this.cursor;
			} else if (this.cursor > this.value.length - halfWidth) {
				// Cursor near end
				visibleText = this.value.slice(this.value.length - scrollWidth);
				cursorDisplay = scrollWidth - (this.value.length - this.cursor);
			} else {
				// Cursor in middle
				const start = this.cursor - halfWidth;
				visibleText = this.value.slice(start, start + scrollWidth);
				cursorDisplay = halfWidth;
			}
		}

		// Build line with fake cursor
		// Insert cursor character at cursor position
		const beforeCursor = visibleText.slice(0, cursorDisplay);
		const atCursor = visibleText[cursorDisplay] || " "; // Character at cursor, or space if at end
		const afterCursor = visibleText.slice(cursorDisplay + 1);

		// Use inverse video to show cursor
		const cursorChar = `\x1b[7m${atCursor}\x1b[27m`; // ESC[7m = reverse video, ESC[27m = normal
		const textWithCursor = beforeCursor + cursorChar + afterCursor;

		// Calculate visual width
		const visualLength = visibleWidth(textWithCursor);
		const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
		const line = prompt + textWithCursor + padding;

		return [line];
	}
}
