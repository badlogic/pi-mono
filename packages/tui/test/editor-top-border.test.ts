import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.js";
import { TUI } from "../src/tui.js";
import { defaultEditorTheme } from "./test-themes.js";
import { VirtualTerminal } from "./virtual-terminal.js";

function createTestTUI(cols = 80, rows = 24): TUI {
	return new TUI(new VirtualTerminal(cols, rows));
}

describe("Editor top border", () => {
	it("renders custom top border content ahead of the default border fill", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setTopBorder({ content: "STATUS", width: 6 });

		const lines = editor.render(20).map((line) => stripVTControlCharacters(line));

		assert.strictEqual(lines[0], `STATUS${"─".repeat(14)}`);
	});

	it("reports the terminal width as available top border width", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);

		assert.strictEqual(editor.getTopBorderAvailableWidth(57), 57);
	});
});
