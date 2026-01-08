import assert from "node:assert";
import { describe, it } from "node:test";
import { CURSOR_MARKER } from "../src/cursor.js";
import type { Component } from "../src/tui.js";
import { TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class CursorMarkerComponent implements Component {
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

describe("TUI cursor marker positioning", () => {
	it("moves the real terminal cursor to the focused component's cursor marker", async () => {
		const terminal = new VirtualTerminal(20, 10);
		const tui = new TUI(terminal);

		const component = new CursorMarkerComponent(["line0", `A日本${CURSOR_MARKER}語\x1b[0mZ`, "line2"]);
		tui.addChild(component);
		tui.setFocus(component);

		tui.requestRender(true);
		await flushRender(terminal);

		const pos1 = terminal.getCursorPosition();
		assert.deepStrictEqual(pos1, { x: 5, y: 1 });

		component.setLines([`X${CURSOR_MARKER}Y\x1b[0m`, "line1", "line2"]);
		tui.requestRender();
		await flushRender(terminal);

		const pos2 = terminal.getCursorPosition();
		assert.deepStrictEqual(pos2, { x: 1, y: 0 });
	});

	it("uses the lowest cursor marker within the focused component when multiple are present", async () => {
		const terminal = new VirtualTerminal(20, 10);
		const tui = new TUI(terminal);

		const component = new CursorMarkerComponent([
			`${CURSOR_MARKER}A\x1b[0m`,
			`B${CURSOR_MARKER}C\x1b[0m`,
			`DDD${CURSOR_MARKER}E\x1b[0m`,
		]);
		tui.addChild(component);
		tui.setFocus(component);

		tui.requestRender(true);
		await flushRender(terminal);

		const pos = terminal.getCursorPosition();
		assert.deepStrictEqual(pos, { x: 3, y: 2 });
	});

	it("ignores cursor markers outside the focused component", async () => {
		const terminal = new VirtualTerminal(20, 10);
		const tui = new TUI(terminal);

		const focused = new CursorMarkerComponent([`A${CURSOR_MARKER}B\x1b[0m`]);
		const other = new CursorMarkerComponent(["x", `C${CURSOR_MARKER}D\x1b[0m`]);

		tui.addChild(focused);
		tui.addChild(other);
		tui.setFocus(focused);

		tui.requestRender(true);
		await flushRender(terminal);

		const pos = terminal.getCursorPosition();
		assert.deepStrictEqual(pos, { x: 1, y: 0 });
	});
});
