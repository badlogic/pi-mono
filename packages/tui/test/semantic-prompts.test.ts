import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.js";
import { TUI } from "../src/tui.js";
import { visibleWidth } from "../src/utils.js";
import { defaultEditorTheme } from "./test-themes.js";
import { VirtualTerminal } from "./virtual-terminal.js";

const OSC133_INPUT_START = "\x1b]133;A;click_events=1\x07\x1b]133;I\x07";
const OSC133_CONTINUATION_INPUT = "\x1b]133;P;k=c\x07\x1b]133;I\x07";
const OSC133_INPUT_END = "\x1b]133;D\x07";

function createTestTUI(cols = 80, rows = 24): TUI {
	return new TUI(new VirtualTerminal(cols, rows));
}

function _escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("OSC 133 semantic prompts", () => {
	it("marks the focused editor input area with click-enabled semantic prompt markers", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.focused = true;
		editor.setText("hello");

		const lines = editor.render(20);
		assert.match(lines[1] ?? "", /^\x1b\]133;A;click_events=1\x07\x1b\]133;I\x07/);
		assert.match(lines[1] ?? "", /\x1b\]133;D\x07/);
	});

	it("emits continuation input markers for explicit multi-line editor input", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.focused = true;
		editor.setText("first line\nsecond line");

		const lines = editor.render(20);
		assert.match(lines[1] ?? "", /^\x1b\]133;A;click_events=1\x07\x1b\]133;I\x07/);
		assert.match(lines[2] ?? "", new RegExp(`^${_escapeRegExp(OSC133_CONTINUATION_INPUT)}`));
		assert.match(lines[2] ?? "", /\x1b\]133;D\x07/);
	});

	it("does not emit continuation markers for soft-wrapped lines within the same logical input line", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.focused = true;
		editor.setText("this is a long line that wraps");

		const lines = editor.render(15);
		assert.match(lines[1] ?? "", /^\x1b\]133;A;click_events=1\x07\x1b\]133;I\x07/);
		assert.doesNotMatch(lines[2] ?? "", /^\x1b\]133;P;k=c\x07\x1b\]133;I\x07/);
		assert.match(lines[lines.length - 2] ?? "", /\x1b\]133;D\x07/);
	});

	it("does not emit semantic prompt markers when the editor is not focused", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.focused = false;
		editor.setText("hello");

		const lines = editor.render(20);
		assert.doesNotMatch(lines[1] ?? "", /\x1b\]133;/);
	});

	it("preserves visible line width when semantic prompt markers are present", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.focused = true;
		editor.setText("hello");

		const lines = editor.render(20);
		const visibleLine = (lines[1] ?? "").replace(OSC133_INPUT_START, "").replace(OSC133_INPUT_END, "");
		assert.strictEqual(visibleWidth(visibleLine), 20);
	});
});
