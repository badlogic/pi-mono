import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal } from "../src/terminal.js";
import { type Component, TUI } from "../src/tui.js";

class RecordingTerminal implements Terminal {
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
	write(_data: string): void {}
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

describe("TUI followOutput", () => {
	it("followOutput=false preserves viewportTop across renders", async () => {
		const terminal = new RecordingTerminal(20, 5);
		const tui = new TUI(terminal);
		const buffer = new Lines(Array.from({ length: 20 }, (_, i) => `L${i}`));
		tui.addChild(buffer);

		tui.start();
		await nextTick();

		// Simulate user scrolling up and disabling follow.
		tui.setFollowOutput(false);
		tui.setViewportTop(0);

		buffer.lines.push("L20", "L21", "L22");
		tui.requestRender();
		await nextTick();

		assert.strictEqual(tui.getFollowOutput(), false);
		assert.strictEqual(tui.getViewportTop(), 0);
	});
});
