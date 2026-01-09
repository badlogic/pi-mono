/**
 * Minimal TUI implementation with differential rendering
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CURSOR_MARKER } from "./cursor.js";
import { isKeyRelease, matchesKey } from "./keys.js";
import type { Terminal } from "./terminal.js";
import { getCapabilities, setCellDimensions } from "./terminal-image.js";
import { extractSegments, sliceByColumn, sliceWithWidth, visibleWidth } from "./utils.js";

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
	 * If true, component receives key release events (Kitty protocol).
	 * Default is false - release events are filtered out.
	 */
	wantsKeyRelease?: boolean;

	/**
	 * Invalidate any cached rendering state.
	 * Called when theme changes or when component needs to re-render from scratch.
	 */
	invalidate(): void;
}

export { visibleWidth };

interface ComponentRange {
	startRow: number;
	endRow: number; // Exclusive
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
	private lastRenderRanges: WeakMap<Component, ComponentRange> = new WeakMap();

	/** Global callback for debug key (Shift+Ctrl+D). Called before input is forwarded to focused component. */
	public onDebug?: () => void;
	private renderRequested = false;
	private cursorRow = 0; // Track where cursor is (0-indexed, relative to our first line)
	private viewportBottomRow = 0; // Track where viewport bottom is (0-indexed, relative to our first line)
	private inputBuffer = ""; // Buffer for parsing terminal responses
	private cellSizeQueryPending = false;
	private cursorPositionQueryPending = false;
	private cursorPositionQueryTimeout: NodeJS.Timeout | null = null;
	private pendingCursorSync: { row1: number; col1: number; seq: number } | null = null;
	private cursorSyncSeq = 0;

	// Overlay stack for modal components rendered on top of base content
	private overlayStack: {
		component: Component;
		options?: { row?: number; col?: number; width?: number };
		preFocus: Component | null;
	}[] = [];

	constructor(terminal: Terminal) {
		super();
		this.terminal = terminal;
	}

	setFocus(component: Component | null): void {
		this.focusedComponent = component;
		this.pendingCursorSync = null;
	}

	/** Show an overlay component centered (or at specified position). */
	showOverlay(component: Component, options?: { row?: number; col?: number; width?: number }): void {
		this.overlayStack.push({ component, options, preFocus: this.focusedComponent });
		this.setFocus(component);
		this.terminal.hideCursor();
		this.requestRender();
	}

	/** Hide the topmost overlay and restore previous focus. */
	hideOverlay(): void {
		const overlay = this.overlayStack.pop();
		if (!overlay) return;
		this.setFocus(overlay.preFocus);
		if (this.overlayStack.length === 0) this.terminal.hideCursor();
		this.requestRender();
	}

	hasOverlay(): boolean {
		return this.overlayStack.length > 0;
	}

	override invalidate(): void {
		super.invalidate();
		for (const overlay of this.overlayStack) overlay.component.invalidate?.();
	}

	start(): void {
		this.terminal.start(
			(data) => this.handleTerminalInput(data),
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
		this.cursorPositionQueryPending = false;
		this.pendingCursorSync = null;
		if (this.cursorPositionQueryTimeout) {
			clearTimeout(this.cursorPositionQueryTimeout);
			this.cursorPositionQueryTimeout = null;
		}
	}

	requestRender(force = false): void {
		if (force) {
			this.previousLines = [];
			this.previousWidth = 0;
			this.cursorRow = 0;
			this.viewportBottomRow = 0;
			this.cursorPositionQueryPending = false;
			this.pendingCursorSync = null;
			if (this.cursorPositionQueryTimeout) {
				clearTimeout(this.cursorPositionQueryTimeout);
				this.cursorPositionQueryTimeout = null;
			}
		}
		if (this.renderRequested) return;
		this.renderRequested = true;
		process.nextTick(() => {
			this.renderRequested = false;
			this.doRender();
		});
	}

	private handleTerminalInput(data: string): void {
		// If we're waiting for terminal query responses, buffer input and parse
		if (this.cellSizeQueryPending || this.cursorPositionQueryPending) {
			this.inputBuffer += data;
			const filtered = this.parsePendingTerminalResponses();
			if (filtered.length === 0) return;
			data = filtered;
		}

		// Global debug key handler (Shift+Ctrl+D)
		if (matchesKey(data, "shift+ctrl+d") && this.onDebug) {
			this.onDebug();
			return;
		}

		// Pass input to focused component (including Ctrl+C)
		// The focused component can decide how to handle Ctrl+C
		if (this.focusedComponent?.handleInput) {
			// Filter out key release events unless component opts in
			if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) {
				return;
			}
			this.focusedComponent.handleInput(data);
			this.requestRender();
		}
	}

	private startCursorSync(target: { row1: number; col1: number }): void {
		// Don't interfere with cell size query - it uses the same input buffer.
		if (this.cellSizeQueryPending) {
			return;
		}

		this.cursorSyncSeq += 1;
		const seq = this.cursorSyncSeq;

		this.pendingCursorSync = { row1: target.row1, col1: target.col1, seq };
		this.cursorPositionQueryPending = true;

		if (this.cursorPositionQueryTimeout) {
			clearTimeout(this.cursorPositionQueryTimeout);
		}
		this.cursorPositionQueryTimeout = setTimeout(() => {
			if (!this.cursorPositionQueryPending) return;
			if (this.pendingCursorSync?.seq !== seq) return;
			this.cursorPositionQueryPending = false;
			this.pendingCursorSync = null;
			this.cursorPositionQueryTimeout = null;
		}, 250);

		// DSR (Device Status Report): request cursor position.
		// Response: ESC [ row ; col R
		this.terminal.write("\x1b[6n");
	}

	private consumeCellSizeResponse(): boolean {
		// Response format: ESC [ 6 ; height ; width t
		const responsePattern = /\x1b\[6;(\d+);(\d+)t/;
		const match = this.inputBuffer.match(responsePattern);
		if (!match) {
			return false;
		}

		const heightPx = parseInt(match[1], 10);
		const widthPx = parseInt(match[2], 10);

		if (heightPx > 0 && widthPx > 0) {
			setCellDimensions({ widthPx, heightPx });
			// Invalidate all components so images re-render with correct dimensions
			this.invalidate();
			this.requestRender();
		}

		this.inputBuffer = this.inputBuffer.replace(responsePattern, "");
		this.cellSizeQueryPending = false;
		return true;
	}

	private consumeCursorPositionResponse(): boolean {
		const responsePattern = /\x1b\[(\d+);(\d+)R/;
		const match = this.inputBuffer.match(responsePattern);
		if (!match) {
			return false;
		}

		this.inputBuffer = this.inputBuffer.replace(responsePattern, "");
		this.cursorPositionQueryPending = false;

		if (this.cursorPositionQueryTimeout) {
			clearTimeout(this.cursorPositionQueryTimeout);
			this.cursorPositionQueryTimeout = null;
		}

		const pending = this.pendingCursorSync;
		if (pending) {
			// Move to absolute screen position (1-indexed).
			this.terminal.write(`\x1b[${pending.row1};${pending.col1}H`);
			this.pendingCursorSync = null;
		}

		return true;
	}

	private hasPartialCsiAtEnd(buffer: string): boolean {
		if (buffer.length === 0) {
			return false;
		}

		const partialPattern = /\x1b\[[0-9;]*$/;
		if (!partialPattern.test(buffer)) {
			return false;
		}

		const lastChar = buffer[buffer.length - 1];
		return !/[a-zA-Z~]/.test(lastChar);
	}

	private parsePendingTerminalResponses(): string {
		let changed = true;
		while (changed) {
			changed = false;
			if (this.cellSizeQueryPending) {
				changed = this.consumeCellSizeResponse() || changed;
			}
			if (this.cursorPositionQueryPending) {
				changed = this.consumeCursorPositionResponse() || changed;
			}
		}

		if ((this.cellSizeQueryPending || this.cursorPositionQueryPending) && this.hasPartialCsiAtEnd(this.inputBuffer)) {
			return "";
		}

		const result = this.inputBuffer;
		this.inputBuffer = "";

		// If we were waiting for cell size, but got unrelated input, give up.
		if (this.cellSizeQueryPending) {
			this.cellSizeQueryPending = false;
		}

		return result;
	}

	private containsImage(line: string): boolean {
		return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
	}

	/** Composite all overlays into content lines (in stack order, later = on top). */
	private compositeOverlays(
		lines: string[],
		termWidth: number,
		termHeight: number,
		ranges: WeakMap<Component, ComponentRange>,
	): string[] {
		if (this.overlayStack.length === 0) return lines;
		const result = [...lines];
		const viewportStart = Math.max(0, result.length - termHeight);

		for (const { component, options } of this.overlayStack) {
			const w =
				options?.width !== undefined
					? Math.max(1, Math.min(options.width, termWidth - 4))
					: Math.max(1, Math.min(80, termWidth - 4));
			const overlayLines = component.render(w);
			const h = overlayLines.length;

			const row = Math.max(0, Math.min(options?.row ?? Math.floor((termHeight - h) / 2), termHeight - h));
			const col = Math.max(0, Math.min(options?.col ?? Math.floor((termWidth - w) / 2), termWidth - w));
			const startRow = viewportStart + row;
			const endRow = Math.min(result.length, startRow + h);
			ranges.set(component, { startRow, endRow });

			for (let i = 0; i < h; i++) {
				const idx = viewportStart + row + i;
				if (idx >= 0 && idx < result.length) {
					result[idx] = this.compositeLineAt(result[idx], overlayLines[i], col, w, termWidth);
				}
			}
		}
		return result;
	}

	private static readonly SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

	/** Splice overlay content into a base line at a specific column. Single-pass optimized. */
	private compositeLineAt(
		baseLine: string,
		overlayLine: string,
		startCol: number,
		overlayWidth: number,
		totalWidth: number,
	): string {
		if (this.containsImage(baseLine)) return baseLine;

		// Single pass through baseLine extracts both before and after segments
		const afterStart = startCol + overlayWidth;
		const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);

		// Extract overlay with width tracking
		const overlay = sliceWithWidth(overlayLine, 0, overlayWidth);

		// Pad segments to target widths
		const beforePad = Math.max(0, startCol - base.beforeWidth);
		const overlayPad = Math.max(0, overlayWidth - overlay.width);
		const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
		const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
		const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
		const afterPad = Math.max(0, afterTarget - base.afterWidth);

		// Compose result - widths are tracked so no final visibleWidth check needed
		const r = TUI.SEGMENT_RESET;
		const result =
			base.before +
			" ".repeat(beforePad) +
			r +
			overlay.text +
			" ".repeat(overlayPad) +
			r +
			base.after +
			" ".repeat(afterPad);

		// Only truncate if wide char at after boundary caused overflow (rare)
		const resultWidth = actualBeforeWidth + actualOverlayWidth + Math.max(afterTarget, base.afterWidth);
		return resultWidth <= totalWidth ? result : sliceByColumn(result, 0, totalWidth, true);
	}

	private renderWithRanges(width: number): { lines: string[]; ranges: WeakMap<Component, ComponentRange> } {
		const ranges = new WeakMap<Component, ComponentRange>();
		const lines = this.renderComponentWithRanges(this, width, ranges, 0);
		return { lines, ranges };
	}

	private renderComponentWithRanges(
		component: Component,
		width: number,
		ranges: WeakMap<Component, ComponentRange>,
		startRow: number,
	): string[] {
		if (component instanceof Container && component.render === Container.prototype.render) {
			const lines: string[] = [];
			let row = startRow;

			for (const child of component.children) {
				const childLines = this.renderComponentWithRanges(child, width, ranges, row);
				lines.push(...childLines);
				row += childLines.length;
			}

			ranges.set(component, { startRow, endRow: row });
			return lines;
		}

		const lines = component.render(width);
		ranges.set(component, { startRow, endRow: startRow + lines.length });
		return lines;
	}

	private findFocusedCursor(lines: string[], width: number): { row: number; col: number } | null {
		const focused = this.focusedComponent;
		if (!focused) {
			return null;
		}

		const range = this.lastRenderRanges.get(focused);
		if (!range) {
			return null;
		}

		return this.findCursorMarkerInRange(lines, width, range);
	}

	private findCursorMarkerInRange(
		lines: string[],
		width: number,
		range: ComponentRange,
	): { row: number; col: number } | null {
		const start = Math.max(0, range.startRow);
		const end = Math.min(lines.length, range.endRow);

		for (let row = end - 1; row >= start; row--) {
			const line = lines[row];
			if (!line) continue;

			const idx = line.lastIndexOf(CURSOR_MARKER);
			if (idx === -1) continue;

			let col = visibleWidth(line.slice(0, idx));
			if (width > 0) {
				col = Math.max(0, Math.min(width - 1, col));
			} else {
				col = Math.max(0, col);
			}

			return { row, col };
		}

		return null;
	}

	private finalizeCursorAfterRender(
		buffer: string,
		newLines: string[],
		width: number,
		height: number,
	): { buffer: string; cursorSyncTarget: { row1: number; col1: number } | null } {
		const newViewportBottomRow = newLines.length - 1;
		this.viewportBottomRow = newViewportBottomRow;

		const cursor = this.findFocusedCursor(newLines, width);
		if (!cursor) {
			this.cursorRow = newViewportBottomRow;
			return { buffer, cursorSyncTarget: null };
		}

		buffer = this.appendMoveCursor(buffer, newViewportBottomRow, cursor);
		this.cursorRow = cursor.row;

		const viewportTop = Math.max(0, newViewportBottomRow - height + 1);
		const cursorSyncTarget = {
			row1: Math.max(1, Math.min(height, cursor.row - viewportTop + 1)),
			col1: Math.max(1, Math.min(width, cursor.col + 1)),
		};

		return { buffer, cursorSyncTarget };
	}

	private appendMoveCursor(buffer: string, fromRow: number, target: { row: number; col: number }): string {
		const rowDiff = target.row - fromRow;
		if (rowDiff > 0) {
			buffer += `\x1b[${rowDiff}B`;
		} else if (rowDiff < 0) {
			buffer += `\x1b[${-rowDiff}A`;
		}

		buffer += "\r";
		if (target.col > 0) {
			buffer += `\x1b[${target.col}C`;
		}

		return buffer;
	}

	private doRender(): void {
		const width = this.terminal.columns;
		const height = this.terminal.rows;

		const previousViewportBottomRow = this.viewportBottomRow;

		// Render all components to get new lines and component ranges
		const { lines: baseLines, ranges } = this.renderWithRanges(width);
		let newLines = baseLines;

		// Composite overlays into the rendered lines (before differential compare)
		if (this.overlayStack.length > 0) {
			newLines = this.compositeOverlays(newLines, width, height, ranges);
		}
		this.lastRenderRanges = ranges;

		// Width changed - need full re-render
		const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;

		// First render - just output everything without clearing
		if (this.previousLines.length === 0) {
			let buffer = "\x1b[?2026h"; // Begin synchronized output
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) buffer += "\r\n";
				buffer += newLines[i];
			}

			const cursorResult = this.finalizeCursorAfterRender(buffer, newLines, width, height);
			buffer = cursorResult.buffer;

			buffer += "\x1b[?2026l"; // End synchronized output
			this.terminal.write(buffer);
			if (cursorResult.cursorSyncTarget && newLines.length > height) {
				this.startCursorSync(cursorResult.cursorSyncTarget);
			}
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

			const cursorResult = this.finalizeCursorAfterRender(buffer, newLines, width, height);
			buffer = cursorResult.buffer;

			buffer += "\x1b[?2026l"; // End synchronized output
			this.terminal.write(buffer);
			if (cursorResult.cursorSyncTarget && newLines.length > height) {
				this.startCursorSync(cursorResult.cursorSyncTarget);
			}
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

		// Check if firstChanged is outside the viewport
		// viewportBottomRow is the line where the viewport ends (0-indexed)
		// Viewport shows lines from (viewportBottomRow - height + 1) to viewportBottomRow
		// If firstChanged < viewportTop, we need full re-render
		const viewportTop = previousViewportBottomRow - height + 1;
		if (firstChanged < viewportTop) {
			// First change is above viewport - need full re-render
			let buffer = "\x1b[?2026h"; // Begin synchronized output
			buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) buffer += "\r\n";
				buffer += newLines[i];
			}

			const cursorResult = this.finalizeCursorAfterRender(buffer, newLines, width, height);
			buffer = cursorResult.buffer;

			buffer += "\x1b[?2026l"; // End synchronized output
			this.terminal.write(buffer);
			if (cursorResult.cursorSyncTarget && newLines.length > height) {
				this.startCursorSync(cursorResult.cursorSyncTarget);
			}
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

				// Clean up terminal state before throwing
				this.stop();

				const errorMsg = [
					`Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}).`,
					"",
					"This is likely caused by a custom TUI component not truncating its output.",
					"Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
					"",
					`Debug log written to: ${crashLogPath}`,
				].join("\n");
				throw new Error(errorMsg);
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

		const cursorResult = this.finalizeCursorAfterRender(buffer, newLines, width, height);
		buffer = cursorResult.buffer;

		buffer += "\x1b[?2026l"; // End synchronized output

		// Write entire buffer at once
		this.terminal.write(buffer);
		if (cursorResult.cursorSyncTarget && newLines.length - firstChanged > height) {
			this.startCursorSync(cursorResult.cursorSyncTarget);
		}

		this.previousLines = newLines;
		this.previousWidth = width;
	}
}
