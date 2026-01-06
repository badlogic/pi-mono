import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component } from "../src/tui.js";
import { TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class FakeCursorComponent implements Component {
	private lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	setLines(lines: string[]): void {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

async function flushRender(terminal: VirtualTerminal): Promise<void> {
	await new Promise<void>((resolve) => process.nextTick(resolve));
	await terminal.flush();
}

describe("TUI IME cursor positioning", () => {
	it("moves the real terminal cursor to the fake cursor position", async () => {
		const terminal = new VirtualTerminal(20, 10);
		const tui = new TUI(terminal);

		const component = new FakeCursorComponent(["line0", "A日本\x1b[7m語\x1b[0mZ", "line2"]);
		tui.addChild(component);

		tui.requestRender(true);
		await flushRender(terminal);

		const pos1 = terminal.getCursorPosition();
		assert.deepStrictEqual(pos1, { x: 5, y: 1 });

		component.setLines(["X\x1b[7mY\x1b[0m", "line1", "line2"]);
		tui.requestRender();
		await flushRender(terminal);

		const pos2 = terminal.getCursorPosition();
		assert.deepStrictEqual(pos2, { x: 1, y: 0 });
	});

	it("uses the lowest fake cursor when multiple are present", async () => {
		const terminal = new VirtualTerminal(20, 10);
		const tui = new TUI(terminal);

		const component = new FakeCursorComponent(["\x1b[7mA\x1b[0m", "B\x1b[7mC\x1b[0m", "DDD\x1b[7mE\x1b[0m"]);
		tui.addChild(component);

		tui.requestRender(true);
		await flushRender(terminal);

		const pos = terminal.getCursorPosition();
		assert.deepStrictEqual(pos, { x: 3, y: 2 });
	});
});
