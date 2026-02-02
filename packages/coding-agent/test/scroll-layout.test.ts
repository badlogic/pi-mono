import { type Component, type Terminal, TUI } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import { ScrollLayout } from "../src/modes/interactive/components/scroll-layout.js";

class MockTerminal implements Terminal {
	private _columns: number;
	private _rows: number;

	constructor(columns = 80, rows = 24) {
		this._columns = columns;
		this._rows = rows;
	}

	start(_onInput: (data: string) => void, _onResize: () => void): void {}

	stop(): void {}

	write(_data: string): void {}

	get columns(): number {
		return this._columns;
	}

	get rows(): number {
		return this._rows;
	}

	get kittyProtocolActive(): boolean {
		return false;
	}

	moveBy(_lines: number): void {}

	hideCursor(): void {}

	showCursor(): void {}

	clearLine(): void {}

	clearFromCursor(): void {}

	clearScreen(): void {}

	setTitle(_title: string): void {}
}

class StaticComponent implements Component {
	private lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	setLines(lines: string[]): void {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return [...this.lines];
	}

	invalidate(): void {}
}

describe("ScrollLayout", () => {
	it("renders full content when disabled", () => {
		const terminal = new MockTerminal(20, 5);
		const tui = new TUI(terminal);
		const output = new StaticComponent(["out-1", "out-2", "out-3"]);
		const fixed = new StaticComponent(["input", "footer"]);
		const layout = new ScrollLayout(tui, output, fixed);

		layout.setEnabled(false);

		expect(layout.render(20)).toEqual(["out-1", "out-2", "out-3", "input", "footer"]);
	});

	it("keeps fixed section anchored and allows scrolling output", () => {
		const terminal = new MockTerminal(20, 5);
		const tui = new TUI(terminal);
		const output = new StaticComponent(["out-1", "out-2", "out-3", "out-4", "out-5"]);
		const fixed = new StaticComponent(["input", "footer"]);
		const layout = new ScrollLayout(tui, output, fixed);

		layout.setEnabled(true);

		expect(layout.render(20)).toEqual(["out-3", "out-4", "out-5", "input", "footer"]);

		layout.scrollBy(1);
		expect(layout.render(20)).toEqual(["out-2", "out-3", "out-4", "input", "footer"]);

		layout.scrollByPage(1);
		expect(layout.render(20)).toEqual(["out-1", "out-2", "out-3", "input", "footer"]);
	});

	it("keeps the viewport stable when new output arrives while scrolled", () => {
		const terminal = new MockTerminal(20, 5);
		const tui = new TUI(terminal);
		const output = new StaticComponent(["out-1", "out-2", "out-3", "out-4", "out-5"]);
		const fixed = new StaticComponent(["input", "footer"]);
		const layout = new ScrollLayout(tui, output, fixed);

		layout.setEnabled(true);
		layout.render(20);
		layout.scrollBy(1);

		expect(layout.render(20)).toEqual(["out-2", "out-3", "out-4", "input", "footer"]);

		output.setLines(["out-1", "out-2", "out-3", "out-4", "out-5", "out-6"]);
		expect(layout.render(20)).toEqual(["out-2", "out-3", "out-4", "input", "footer"]);
	});
});
