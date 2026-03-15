import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.js";
import type { Component } from "../src/tui.js";
import { TUI } from "../src/tui.js";
import { defaultEditorTheme } from "./test-themes.js";
import { VirtualTerminal } from "./virtual-terminal.js";

function createMountedEditor(
	cols = 40,
	rows = 12,
): {
	tui: TUI;
	terminal: VirtualTerminal;
	editor: Editor;
} {
	const terminal = new VirtualTerminal(cols, rows);
	const tui = new TUI(terminal);
	const editor = new Editor(tui, defaultEditorTheme);
	tui.addChild(editor);
	tui.setFocus(editor);
	tui.start();
	return { tui, terminal, editor };
}

class StaticLines implements Component {
	constructor(private readonly lines: string[]) {}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

class MutableLines implements Component {
	constructor(public lines: string[]) {}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

describe("Editor mouse click events", () => {
	it("moves the cursor within a single line from click_events mouse input", async () => {
		const { tui, terminal, editor } = createMountedEditor();
		try {
			editor.setText("hello");
			tui.requestRender();
			await terminal.flush();

			terminal.sendInput("\x1b[<0;3;2M");
			await terminal.flush();

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });
		} finally {
			tui.stop();
		}
	});

	it("moves the cursor to another logical line from click_events mouse input", async () => {
		const { tui, terminal, editor } = createMountedEditor();
		try {
			editor.setText("hello\nworld");
			tui.requestRender();
			await terminal.flush();

			terminal.sendInput("\x1b[<0;2;3M");
			await terminal.flush();

			assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 1 });
		} finally {
			tui.stop();
		}
	});

	it("accepts prompt click coordinates reported in absolute scrollback rows", async () => {
		const terminal = new VirtualTerminal(40, 12);
		const tui = new TUI(terminal);
		const spacer = new StaticLines(Array.from({ length: 30 }, () => "spacer"));
		const editor = new Editor(tui, defaultEditorTheme);
		tui.addChild(spacer);
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		try {
			editor.setText("hello\nworld");
			tui.requestRender();
			await terminal.flush();

			terminal.sendInput("\x1b[<0;2;33M");
			await terminal.flush();

			assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 1 });
		} finally {
			tui.stop();
		}
	});

	it("uses the working-area viewport when older content keeps maxLinesRendered larger", async () => {
		const terminal = new VirtualTerminal(40, 12);
		const tui = new TUI(terminal);
		const spacer = new MutableLines(Array.from({ length: 30 }, () => "spacer"));
		const editor = new Editor(tui, defaultEditorTheme);
		tui.addChild(spacer);
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		try {
			editor.setText("hello\nworld");
			tui.requestRender();
			await terminal.flush();

			spacer.lines = [];
			tui.requestRender();
			await terminal.flush();

			terminal.sendInput("\x1b[<0;2;3M");
			await terminal.flush();

			assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 1 });
		} finally {
			tui.stop();
		}
	});
});
