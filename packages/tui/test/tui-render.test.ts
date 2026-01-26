import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { type Component, TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class TestComponent implements Component {
	lines: string[] = [];
	render(_width: number): string[] {
		return this.lines;
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

describe("TUI differential rendering", () => {
	it("tracks cursor correctly when content shrinks with unchanged remaining lines", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Initial render: 5 identical lines
		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
		tui.start();
		await terminal.flush();

		// Shrink to 3 lines, all identical to before (no content changes in remaining lines)
		component.lines = ["Line 0", "Line 1", "Line 2"];
		tui.requestRender();
		await terminal.flush();

		// cursorRow should be 2 (last line of new content)
		// Verify by doing another render with a change on line 1
		component.lines = ["Line 0", "CHANGED", "Line 2"];
		tui.requestRender();
		await terminal.flush();

		const viewport = terminal.getViewport();
		// Line 1 should show "CHANGED", proving cursor tracking was correct
		assert.ok(viewport[1]?.includes("CHANGED"), `Expected "CHANGED" on line 1, got: ${viewport[1]}`);

		tui.stop();
	});

	it("renders correctly when only a middle line changes (spinner case)", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Initial render
		component.lines = ["Header", "Working...", "Footer"];
		tui.start();
		await terminal.flush();

		// Simulate spinner animation - only middle line changes
		const spinnerFrames = ["|", "/", "-", "\\"];
		for (const frame of spinnerFrames) {
			component.lines = ["Header", `Working ${frame}`, "Footer"];
			tui.requestRender();
			await terminal.flush();

			const viewport = terminal.getViewport();
			assert.ok(viewport[0]?.includes("Header"), `Header preserved: ${viewport[0]}`);
			assert.ok(viewport[1]?.includes(`Working ${frame}`), `Spinner updated: ${viewport[1]}`);
			assert.ok(viewport[2]?.includes("Footer"), `Footer preserved: ${viewport[2]}`);
		}

		tui.stop();
	});

	it("resets styles after each rendered line", async () => {
		const terminal = new VirtualTerminal(20, 6);
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["\x1b[3mItalic", "Plain"];
		tui.start();
		await terminal.flush();

		assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
		tui.stop();
	});

	it("renders correctly when first line changes but rest stays same", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
		tui.start();
		await terminal.flush();

		// Change only first line
		component.lines = ["CHANGED", "Line 1", "Line 2", "Line 3"];
		tui.requestRender();
		await terminal.flush();

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("CHANGED"), `First line changed: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
		assert.ok(viewport[3]?.includes("Line 3"), `Line 3 preserved: ${viewport[3]}`);

		tui.stop();
	});

	it("renders correctly when last line changes but rest stays same", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
		tui.start();
		await terminal.flush();

		// Change only last line
		component.lines = ["Line 0", "Line 1", "Line 2", "CHANGED"];
		tui.requestRender();
		await terminal.flush();

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
		assert.ok(viewport[3]?.includes("CHANGED"), `Last line changed: ${viewport[3]}`);

		tui.stop();
	});

	it("renders correctly when multiple non-adjacent lines change", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
		tui.start();
		await terminal.flush();

		// Change lines 1 and 3, keep 0, 2, 4 the same
		component.lines = ["Line 0", "CHANGED 1", "Line 2", "CHANGED 3", "Line 4"];
		tui.requestRender();
		await terminal.flush();

		const viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("CHANGED 1"), `Line 1 changed: ${viewport[1]}`);
		assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
		assert.ok(viewport[3]?.includes("CHANGED 3"), `Line 3 changed: ${viewport[3]}`);
		assert.ok(viewport[4]?.includes("Line 4"), `Line 4 preserved: ${viewport[4]}`);

		tui.stop();
	});

	it("handles transition from content to empty and back to content", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Start with content
		component.lines = ["Line 0", "Line 1", "Line 2"];
		tui.start();
		await terminal.flush();

		let viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("Line 0"), "Initial content rendered");

		// Clear to empty
		component.lines = [];
		tui.requestRender();
		await terminal.flush();

		// Add content back - this should work correctly even after empty state
		component.lines = ["New Line 0", "New Line 1"];
		tui.requestRender();
		await terminal.flush();

		viewport = terminal.getViewport();
		assert.ok(viewport[0]?.includes("New Line 0"), `New content rendered: ${viewport[0]}`);
		assert.ok(viewport[1]?.includes("New Line 1"), `New content line 1: ${viewport[1]}`);

		tui.stop();
	});

	it("preserves earlier lines when appending content that exceeds viewport (viewport cursor fix)", async () => {
		// Regression test for the viewport cursor overwrite bug (fixed in a6f9c3c).
		//
		// Bug scenario: When content exceeds viewport height and new lines are appended
		// (e.g., tool output arriving after initial streaming), earlier lines could be
		// overwritten. This happened because hardwareCursorRow (a content index) was
		// used directly for CSI A/B cursor movement, but cursor movement clamps at
		// viewport boundaries — causing writes to land on wrong lines.
		//
		// This test simulates the real-world pattern: streaming content that exceeds
		// viewport, followed by tool output, followed by more streaming. All phases
		// must be preserved in the scroll buffer without overwrites.

		const terminal = new VirtualTerminal(40, 10); // Small viewport: 10 rows
		const tui = new TUI(terminal);
		const component = new TestComponent();
		tui.addChild(component);

		// Phase 1: Render "pre-tool" content that exceeds viewport (20 lines > 10 rows)
		const preLines = Array.from({ length: 20 }, (_, i) => `PRE-TOOL-${String(i + 1).padStart(2, "0")}`);
		component.lines = [...preLines];
		tui.start();
		await terminal.flush();

		// Phase 2: Simulate "tool output" — append more lines
		const toolLines = Array.from({ length: 15 }, (_, i) => `TOOL-OUT-${String(i + 1).padStart(2, "0")}`);
		component.lines = [...preLines, ...toolLines];
		tui.requestRender();
		await terminal.flush();

		// Phase 3: Simulate "post-tool streaming" — append even more lines
		const postLines = Array.from({ length: 5 }, (_, i) => `POST-TOOL-${String(i + 1).padStart(2, "0")}`);
		component.lines = [...preLines, ...toolLines, ...postLines];
		tui.requestRender();
		await terminal.flush();

		// Verify: ALL lines from all phases must be preserved in the scroll buffer.
		// The bug caused some PRE-TOOL lines to be overwritten by later content.
		const scrollBuffer = terminal.getScrollBuffer();
		const scrollText = scrollBuffer.join("\n");

		for (let i = 1; i <= 20; i++) {
			const expectedLine = `PRE-TOOL-${String(i).padStart(2, "0")}`;
			assert.ok(
				scrollText.includes(expectedLine),
				`PRE-TOOL line ${i} should be preserved in scroll buffer. Missing: ${expectedLine}`,
			);
		}

		for (let i = 1; i <= 15; i++) {
			const expectedLine = `TOOL-OUT-${String(i).padStart(2, "0")}`;
			assert.ok(
				scrollText.includes(expectedLine),
				`TOOL-OUT line ${i} should be in scroll buffer. Missing: ${expectedLine}`,
			);
		}

		for (let i = 1; i <= 5; i++) {
			const expectedLine = `POST-TOOL-${String(i).padStart(2, "0")}`;
			assert.ok(
				scrollText.includes(expectedLine),
				`POST-TOOL line ${i} should be in scroll buffer. Missing: ${expectedLine}`,
			);
		}

		// Verify line ordering: all lines should appear in correct sequence
		const expectedSequence = [...preLines, ...toolLines, ...postLines];
		let lastIndex = -1;
		for (const line of expectedSequence) {
			const idx = scrollBuffer.indexOf(line);
			assert.ok(idx > lastIndex, `Expected "${line}" to appear after the previous line in scroll buffer`);
			lastIndex = idx;
		}

		tui.stop();
	});
});
