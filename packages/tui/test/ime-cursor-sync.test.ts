import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component } from "../src/tui.js";
import { TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class CursorSyncComponent implements Component {
	public wantsImeCursor = true;
	public inputs: string[] = [];

	constructor(private lines: string[]) {}

	render(_width: number): string[] {
		return this.lines;
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
		lines.push("abc\x1b[7mD\x1b[0m");

		const component = new CursorSyncComponent(lines);
		tui.addChild(component);
		tui.setFocus(component);

		tui.requestRender(true);
		await flushRender(terminal);

		// Move cursor away (simulate drift / stale cursor position).
		terminal.write("\x1b[1;1H");
		await terminal.flush();

		// Simulate the terminal responding to the DSR cursor-position request.
		// We call the TUI input handler directly since the virtual terminal only forwards
		// input after tui.start() (which we avoid in tests).
		(tui as unknown as { handleInput: (data: string) => void }).handleInput("\x1b[1;1R");
		await terminal.flush();

		const pos = terminal.getCursorPosition();
		assert.deepStrictEqual(pos, { x: 3, y: 4 });

		// The cursor-position response must not reach the focused component.
		assert.deepStrictEqual(component.inputs, []);
	});
});
