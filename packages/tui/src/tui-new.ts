/**
 * Minimal TUI implementation with differential rendering
 */

import { stripVTControlCharacters } from "node:util";
import type { Terminal } from "./terminal.js";

/**
 * Component interface - all components must implement this
 */
export interface Component {
	/**
	 * Render the component to lines for the given viewport width
	 * @param width - Current viewport width
	 * @returns Array of strings, each representing a line
	 */
	render(width: number): string[];

	/**
	 * Optional handler for keyboard input when component has focus
	 */
	handleInput?(data: string): void;
}

/**
 * Container - a component that contains other components
 */
export class Container implements Component {
	children: Component[] = [];

	addChild(component: Component): void {
		this.children.push(component);
	}

	removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1) {
			this.children.splice(index, 1);
		}
	}

	clear(): void {
		this.children = [];
	}

	render(width: number): string[] {
		const lines: string[] = [];
		for (const child of this.children) {
			lines.push(...child.render(width));
		}
		return lines;
	}
}

/**
 * Text component - displays multi-line text with word wrapping
 */
export class Text implements Component {
	constructor(private text: string = "") {}

	setText(text: string): void {
		this.text = text;
	}

	render(width: number): string[] {
		if (!this.text) {
			return [""];
		}

		const lines: string[] = [];
		const textLines = this.text.split("\n");

		for (const line of textLines) {
			if (line.length <= width) {
				lines.push(line);
			} else {
				// Word wrap
				const words = line.split(" ");
				let currentLine = "";

				for (const word of words) {
					if (currentLine.length === 0) {
						currentLine = word;
					} else if (currentLine.length + 1 + word.length <= width) {
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

		return lines.length > 0 ? lines : [""];
	}
}

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

		// Calculate visual width (strip ANSI codes to measure actual displayed characters)
		const visualLength = stripVTControlCharacters(textWithCursor).length;
		const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
		const line = prompt + textWithCursor + padding;

		return [line];
	}
}

/**
 * TUI - Main class for managing terminal UI with differential rendering
 */
export class TUI extends Container {
	private terminal: Terminal;
	private previousLines: string[] = [];
	private previousWidth = 0;
	private focusedComponent: Component | null = null;
	private renderRequested = false;
	private cursorRow = 0; // Track where cursor is (0-indexed, relative to our first line)

	constructor(terminal: Terminal) {
		super();
		this.terminal = terminal;
	}

	setFocus(component: Component | null): void {
		this.focusedComponent = component;
	}

	start(): void {
		this.terminal.start(
			(data) => this.handleInput(data),
			() => this.requestRender(),
		);
		this.terminal.hideCursor();
		this.requestRender();
	}

	stop(): void {
		this.terminal.showCursor();
		this.terminal.stop();
	}

	requestRender(): void {
		if (this.renderRequested) return;
		this.renderRequested = true;
		process.nextTick(() => {
			this.renderRequested = false;
			this.doRender();
		});
	}

	private handleInput(data: string): void {
		// Exit on Ctrl+C
		if (data === "\x03") {
			this.stop();
			process.exit(0);
		}

		// Pass input to focused component
		if (this.focusedComponent?.handleInput) {
			this.focusedComponent.handleInput(data);
			this.requestRender();
		}
	}

	private doRender(): void {
		const width = this.terminal.columns;
		const height = this.terminal.rows;

		// Render all components to get new lines
		const newLines = this.render(width);

		// Width changed - need full re-render
		const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;

		// First render - just output everything without clearing
		if (this.previousLines.length === 0) {
			let buffer = "\x1b[?2026h"; // Begin synchronized output
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) buffer += "\r\n";
				buffer += newLines[i];
			}
			buffer += "\x1b[?2026l"; // End synchronized output
			this.terminal.write(buffer);
			// After rendering N lines, cursor is at end of last line (line N-1)
			this.cursorRow = newLines.length - 1;
			this.previousLines = newLines;
			this.previousWidth = width;
			return;
		}

		// Width changed - full re-render
		if (widthChanged) {
			let buffer = "\x1b[?2026h"; // Begin synchronized output
			buffer += "\x1b[2J\x1b[H"; // Clear screen and home
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) buffer += "\r\n";
				buffer += newLines[i];
			}
			buffer += "\x1b[?2026l"; // End synchronized output
			this.terminal.write(buffer);
			this.cursorRow = newLines.length - 1;
			this.previousLines = newLines;
			this.previousWidth = width;
			return;
		}

		// Find first and last changed lines
		let firstChanged = -1;
		let lastChanged = -1;

		const maxLines = Math.max(newLines.length, this.previousLines.length);
		for (let i = 0; i < maxLines; i++) {
			const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
			const newLine = i < newLines.length ? newLines[i] : "";

			if (oldLine !== newLine) {
				if (firstChanged === -1) {
					firstChanged = i;
				}
				lastChanged = i;
			}
		}

		// No changes
		if (firstChanged === -1) {
			return;
		}

		// Check if firstChanged is outside the viewport
		// cursorRow is the line where cursor is (0-indexed)
		// Viewport shows lines from (cursorRow - height + 1) to cursorRow
		// If firstChanged < viewportTop, we need full re-render
		const viewportTop = this.cursorRow - height + 1;
		if (firstChanged < viewportTop) {
			// First change is above viewport - need full re-render
			let buffer = "\x1b[?2026h"; // Begin synchronized output
			buffer += "\x1b[2J\x1b[H"; // Clear screen and home
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) buffer += "\r\n";
				buffer += newLines[i];
			}
			buffer += "\x1b[?2026l"; // End synchronized output
			this.terminal.write(buffer);
			this.cursorRow = newLines.length - 1;
			this.previousLines = newLines;
			this.previousWidth = width;
			return;
		}

		// Render from first changed line to end
		// Build buffer with all updates wrapped in synchronized output
		let buffer = "\x1b[?2026h"; // Begin synchronized output

		// Move cursor to first changed line
		const lineDiff = firstChanged - this.cursorRow;
		if (lineDiff > 0) {
			buffer += `\x1b[${lineDiff}B`; // Move down
		} else if (lineDiff < 0) {
			buffer += `\x1b[${-lineDiff}A`; // Move up
		}

		buffer += "\r"; // Move to column 0
		buffer += "\x1b[J"; // Clear from cursor to end of screen

		// Render from first changed line to end
		for (let i = firstChanged; i < newLines.length; i++) {
			if (i > firstChanged) buffer += "\r\n";
			buffer += newLines[i];
		}

		buffer += "\x1b[?2026l"; // End synchronized output

		// Write entire buffer at once
		this.terminal.write(buffer);

		// Cursor is now at end of last line
		this.cursorRow = newLines.length - 1;

		this.previousLines = newLines;
		this.previousWidth = width;
	}
}
