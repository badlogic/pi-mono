import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal } from "../src/terminal.js";
import { type Component, TUI } from "../src/tui.js";

class RecordingTerminal implements Terminal {
	public writes: string[] = [];
	public columns: number;
	public rows: number;
	public kittyProtocolActive = true;

	constructor(columns = 40, rows = 10) {
		this.columns = columns;
		this.rows = rows;
	}

	start(_onInput: (data: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
}

class Lines implements Component {
	constructor(public lines: string[]) {}
	render(): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

const nextTick = async (): Promise<void> => new Promise((resolve) => process.nextTick(resolve));

describe("TUI scrollback clearing", () => {
	it("does not emit clear-scrollback (CSI 3 J) during routine full re-renders", async () => {
		const terminal = new RecordingTerminal(20, 6);
		const tui = new TUI(terminal);
		tui.addChild(new Lines(["one", "two", "three", "four", "five", "six"]));

		tui.start();
		await nextTick();
		terminal.writes.length = 0;

		// Force widthChanged => fullRender(true)
		terminal.columns = 25;
		tui.requestRender();
		await nextTick();

		const out = terminal.writes.join("");
		assert.ok(out.length > 0, "expected terminal output");
		assert.ok(!out.includes("\x1b[3J"), "should not clear scrollback (\\x1b[3J) on routine re-renders");
	});
});
