/**
 * Minimal TUI implementation with differential rendering
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Terminal } from "./terminal.js";
import { getCapabilities, setCellDimensions } from "./terminal-image.js";
import { visibleWidth } from "./utils.js";

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

	/**
	 * Invalidate any cached rendering state.
	 * Called when theme changes or when component needs to re-render from scratch.
	 */
	invalidate(): void;
}

export { visibleWidth };

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

	invalidate(): void {
		for (const child of this.children) {
			child.invalidate?.();
		}
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
 * TUI - Main class for managing terminal UI with differential rendering
 */
export class TUI extends Container {
	public terminal: Terminal;
	private previousLines: string[] = [];
	private previousWidth = 0;
	private focusedComponent: Component | null = null;
	private renderRequested = false;
	private cursorRow = 0; // Track where cursor is (0-indexed, relative to our first line)
	private inputBuffer = ""; // Buffer for parsing terminal responses
	private cellSizeQueryPending = false;

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
		this.queryCellSize();
		this.requestRender();
	}

	private queryCellSize(): void {
		// Only query if terminal supports images (cell size is only used for image rendering)
		if (!getCapabilities().images) {
			return;
		}
		// Query terminal for cell size in pixels: CSI 16 t
		// Response format: CSI 6 ; height ; width t
		this.cellSizeQueryPending = true;
		this.terminal.write("\x1b[16t");
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
		// If we're waiting for cell size response, buffer input and parse
		if (this.cellSizeQueryPending) {
			this.inputBuffer += data;
			const filtered = this.parseCellSizeResponse();
			if (filtered.length === 0) return;
			data = filtered;
		}

		// Pass input to focused component (including Ctrl+C)
		// The focused component can decide how to handle Ctrl+C
		if (this.focusedComponent?.handleInput) {
			this.focusedComponent.handleInput(data);
			this.requestRender();
		}
	}

	private parseCellSizeResponse(): string {
		// Response format: ESC [ 6 ; height ; width t
		// Match the response pattern
		const responsePattern = /\x1b\[6;(\d+);(\d+)t/;
		const match = this.inputBuffer.match(responsePattern);

		if (match) {
			const heightPx = parseInt(match[1], 10);
			const widthPx = parseInt(match[2], 10);

			if (heightPx > 0 && widthPx > 0) {
				setCellDimensions({ widthPx, heightPx });
				// Invalidate all components so images re-render with correct dimensions
				this.invalidate();
				this.requestRender();
			}

			// Remove the response from buffer
			this.inputBuffer = this.inputBuffer.replace(responsePattern, "");
			this.cellSizeQueryPending = false;
		}

		// Check if we have a partial response starting (wait for more data)
		// ESC [ 6 ; ... could be incomplete
		const partialPattern = /\x1b\[6;[\d;]*$/;
		if (partialPattern.test(this.inputBuffer)) {
			return ""; // Wait for more data
		}

		// Check for any ESC that might be start of response
		const escIndex = this.inputBuffer.lastIndexOf("\x1b");
		if (escIndex !== -1 && escIndex > this.inputBuffer.length - 10) {
			// Might be incomplete escape sequence, wait a bit
			// But return any data before it
			const before = this.inputBuffer.substring(0, escIndex);
			this.inputBuffer = this.inputBuffer.substring(escIndex);
			return before;
		}

		// No response found, return buffered data as user input
		const result = this.inputBuffer;
		this.inputBuffer = "";
		this.cellSizeQueryPending = false; // Give up waiting
		return result;
	}

	private containsImage(line: string): boolean {
		return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
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
			buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
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
		const maxLines = Math.max(newLines.length, this.previousLines.length);
		for (let i = 0; i < maxLines; i++) {
			const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
			const newLine = i < newLines.length ? newLines[i] : "";

			if (oldLine !== newLine) {
				if (firstChanged === -1) {
					firstChanged = i;
				}
			}
		}

		// No changes
		if (firstChanged === -1) {
			return;
		}

		// Check if image lines changed - they require special handling to avoid duplication
		// Only force full re-render if image content actually changed, not just because images exist
		const imageLineChanged = (() => {
			for (let i = firstChanged; i < Math.max(newLines.length, this.previousLines.length); i++) {
				const prevLine = this.previousLines[i] || "";
				const newLine = newLines[i] || "";
				if (this.containsImage(prevLine) || this.containsImage(newLine)) {
					if (prevLine !== newLine) return true;
				}
			}
			return false;
		})();

		if (imageLineChanged) {
			let buffer = "\x1b[?2026h"; // Begin synchronized output
			// For Kitty protocol, delete all images before re-render
			if (getCapabilities().images === "kitty") {
				buffer += "\x1b_Ga=d\x1b\\";
			}
			buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
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

		// Check if firstChanged is outside the viewport
		// cursorRow is the line where cursor is (0-indexed)
		// Viewport shows lines from (cursorRow - height + 1) to cursorRow
		// If firstChanged < viewportTop, we need full re-render
		const viewportTop = this.cursorRow - height + 1;
		if (firstChanged < viewportTop) {
			// First change is above viewport - need full re-render
			let buffer = "\x1b[?2026h"; // Begin synchronized output
			buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
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

		// Render from first changed line to end, clearing each line before writing
		// This avoids the \x1b[J clear-to-end which can cause flicker in xterm.js
		for (let i = firstChanged; i < newLines.length; i++) {
			if (i > firstChanged) buffer += "\r\n";
			buffer += "\x1b[2K"; // Clear current line
			const line = newLines[i];
			const isImageLine = this.containsImage(line);
			if (!isImageLine && visibleWidth(line) > width) {
				// Log all lines to crash file for debugging
				const crashLogPath = path.join(os.homedir(), ".pi", "agent", "pi-crash.log");
				const crashData = [
					`Crash at ${new Date().toISOString()}`,
					`Terminal width: ${width}`,
					`Line ${i} visible width: ${visibleWidth(line)}`,
					"",
					"=== All rendered lines ===",
					...newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
					"",
				].join("\n");
				fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
				fs.writeFileSync(crashLogPath, crashData);
				throw new Error(`Rendered line ${i} exceeds terminal width. Debug log written to ${crashLogPath}`);
			}
			buffer += line;
		}

		// If we had more lines before, clear them and move cursor back
		if (this.previousLines.length > newLines.length) {
			const extraLines = this.previousLines.length - newLines.length;
			for (let i = newLines.length; i < this.previousLines.length; i++) {
				buffer += "\r\n\x1b[2K";
			}
			// Move cursor back to end of new content
			buffer += `\x1b[${extraLines}A`;
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
