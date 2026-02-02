import type { Component, TUI } from "@mariozechner/pi-tui";

const EMPTY_LINE = "";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

export class ScrollLayout implements Component {
	private tui: TUI;
	private output: Component;
	private fixed: Component;
	private enabled = false;
	private scrollOffset = 0;
	private lastOutputLineCount = 0;
	private lastAvailableHeight = 0;
	private lastMaxScrollOffset = 0;

	constructor(tui: TUI, output: Component, fixed: Component) {
		this.tui = tui;
		this.output = output;
		this.fixed = fixed;
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		this.scrollOffset = 0;
		this.lastOutputLineCount = 0;
		this.lastAvailableHeight = 0;
		this.lastMaxScrollOffset = 0;
	}

	scrollBy(lines: number): void {
		if (!this.enabled || lines === 0) return;
		this.scrollOffset = clamp(this.scrollOffset + lines, 0, this.lastMaxScrollOffset);
	}

	scrollByPage(pages: number): void {
		if (!this.enabled || pages === 0) return;
		const pageSize = Math.max(1, this.lastAvailableHeight - 1);
		this.scrollBy(pages * pageSize);
	}

	scrollToBottom(): void {
		this.scrollOffset = 0;
	}

	isScrolled(): boolean {
		return this.scrollOffset > 0;
	}

	invalidate(): void {
		this.output.invalidate?.();
		this.fixed.invalidate?.();
	}

	render(width: number): string[] {
		const height = this.tui.terminal.rows;
		const outputLines = this.output.render(width);
		const fixedLines = this.fixed.render(width);

		if (!this.enabled) {
			this.lastOutputLineCount = outputLines.length;
			this.lastAvailableHeight = 0;
			this.lastMaxScrollOffset = 0;
			return [...outputLines, ...fixedLines];
		}

		if (this.scrollOffset > 0 && outputLines.length > this.lastOutputLineCount) {
			this.scrollOffset += outputLines.length - this.lastOutputLineCount;
		}
		this.lastOutputLineCount = outputLines.length;

		let visibleFixedLines = fixedLines;
		if (visibleFixedLines.length > height) {
			visibleFixedLines = visibleFixedLines.slice(visibleFixedLines.length - height);
		}

		const availableHeight = Math.max(0, height - visibleFixedLines.length);
		this.lastAvailableHeight = availableHeight;
		this.lastMaxScrollOffset = Math.max(0, outputLines.length - availableHeight);
		this.scrollOffset = clamp(this.scrollOffset, 0, this.lastMaxScrollOffset);

		const start = Math.max(0, outputLines.length - availableHeight - this.scrollOffset);
		let visibleOutputLines = availableHeight > 0 ? outputLines.slice(start, start + availableHeight) : [];

		if (visibleOutputLines.length < availableHeight) {
			visibleOutputLines = visibleOutputLines.concat(
				Array.from({ length: availableHeight - visibleOutputLines.length }, () => EMPTY_LINE),
			);
		}

		return [...visibleOutputLines, ...visibleFixedLines];
	}
}
