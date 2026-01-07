import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component } from "../src/tui.js";
import { TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class LinesComponent implements Component {
	constructor(private lines: string[]) {}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

class InputCaptureComponent implements Component {
	public wantsImeCursor = true;
	public inputs: string[] = [];

	render(_width: number): string[] {
		return [];
	}

	handleInput(data: string): void {
		this.inputs.push(data);
	}

	invalidate(): void {}
}

async function flushRender(terminal: VirtualTerminal): Promise<void> {
	await new Promise<void>((resolve) => process.nextTick(resolve));
	await terminal.flush();
}

describe("TUI cursor sync", () => {
	it("re-applies cursor positioning after a DSR cursor-position response", async () => {
		const terminal = new VirtualTerminal(20, 5);
		const tui = new TUI(terminal);

		const lines: string[] = [];
		for (let i = 0; i < 30; i++) {
			lines.push(`line${i}`);
		}
		// Fake cursor on the last line, after 3 visible characters.
		lines.push(`abc\x1b[7mD\x1b[0m`);

		const content = new LinesComponent(lines);
		const capture = new InputCaptureComponent();
		tui.addChild(content);
		tui.addChild(capture);
		tui.setFocus(capture);

		tui.requestRender(true);
		await flushRender(terminal);

		// Move cursor away (simulate drift / stale cursor position).
		terminal.write("\x1b[1;1H");
		await terminal.flush();

		// Simulate the terminal responding to the DSR cursor-position request.
		terminal.sendInput("\x1b[1;1R");
		await terminal.flush();

		// Cursor should be moved back to the fake cursor position in the viewport.
		const pos = terminal.getCursorPosition();
		assert.deepStrictEqual(pos, { x: 3, y: 4 });

		// The cursor-position response must not reach the focused component.
		assert.deepStrictEqual(capture.inputs, []);
	});
});
