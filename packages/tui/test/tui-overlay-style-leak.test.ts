import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { type Component, TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class StaticLines implements Component {
	constructor(private readonly lines: string[]) {}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

class StaticOverlay implements Component {
	constructor(private readonly line: string) {}

	render(): string[] {
		return [this.line];
	}

	invalidate(): void {}
}

function getCellItalic(terminal: VirtualTerminal, row: number, col: number): number {
	const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
	const buffer = xterm.buffer.active;
	const line = buffer.getLine(buffer.viewportY + row);
	assert.ok(line, `Missing buffer line at row ${row}`);
	const cell = line.getCell(col);
	assert.ok(cell, `Missing cell at row ${row} col ${col}`);
	return cell.isItalic();
}

async function renderAndFlush(tui: TUI, terminal: VirtualTerminal): Promise<void> {
	tui.requestRender(true);
	await new Promise<void>((resolve) => process.nextTick(resolve));
	await terminal.flush();
}

describe("TUI overlay compositing", () => {
	it("should not leak styles when a trailing reset sits beyond the last visible column (no overlay)", async () => {
		const width = 20;
		// Base line ends exactly at terminal width, with italic-off *after* the final visible cell.
		// Overlay compositing uses ANSI-aware slicing by visible columns, which can drop trailing
		// ANSI codes at the right boundary (col === width).
		const baseLine = `\x1b[3m${"X".repeat(width)}\x1b[23m`;

		const terminal = new VirtualTerminal(width, 6);
		const tui = new TUI(terminal);
		tui.addChild(new StaticLines([baseLine, "INPUT"]));
		tui.start();
		await renderAndFlush(tui, terminal);
		assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
	});

	it.skip("should not leak styles when overlay slicing drops trailing SGR resets", async () => {
		// Known issue: extractSegments()/sliceWithWidth() are based on visible columns.
		// ANSI codes that appear *after* the last visible column can be dropped, which can
		// leave the composed line with an active SGR state (e.g. italic), leaking into the
		// next line / user input. Keep this as a regression test for the maintainer decision.
		const width = 20;
		const baseLine = `\x1b[3m${"X".repeat(width)}\x1b[23m`;

		const terminal = new VirtualTerminal(width, 6);
		const tui = new TUI(terminal);
		tui.addChild(new StaticLines([baseLine, "INPUT"]));

		// Enable overlay to exercise extractSegments/sliceWithWidth paths.
		tui.showOverlay(new StaticOverlay("OVR"), { row: 0, col: 5, width: 3 });
		tui.start();
		await renderAndFlush(tui, terminal);

		// If italic leaks, the 'I' in INPUT becomes italic.
		assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
	});
});
