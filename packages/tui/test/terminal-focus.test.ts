import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.js";
import { TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

const TEST_THEME = {
	borderColor: (str: string) => str,
	selectList: {
		selectedPrefix: (text: string) => text,
		selectedText: (text: string) => text,
		description: (text: string) => text,
		scrollInfo: (text: string) => text,
		noMatch: (text: string) => text,
	},
};

describe("terminal focus handling", () => {
	it("updates editor caret rendering when terminal focus changes", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal, true);
		const editor = new Editor(tui, TEST_THEME);
		editor.setText("hello");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		await terminal.flush();

		const focusedRender = editor.render(20).join("\n");
		assert.match(focusedRender, /\x1b_pi:c\x07/, "focused editor should emit hardware cursor marker");
		assert.match(focusedRender, /\x1b\[7m/, "focused editor should render inverse caret");

		terminal.setFocused(false);
		await terminal.flush();

		const blurredRender = editor.render(20).join("\n");
		assert.ok(!blurredRender.includes("\x1b_pi:c\x07"), "blurred editor must not emit hardware cursor marker");
		assert.match(blurredRender, /\x1b\[2m\x1b\[4m/, "blurred editor should render subdued underlined caret");
		assert.strictEqual(tui.isTerminalFocused(), false);

		terminal.setFocused(true);
		await terminal.flush();
		assert.strictEqual(tui.isTerminalFocused(), true);
		assert.match(editor.render(20).join("\n"), /\x1b_pi:c\x07/, "caret marker should return after focus");

		tui.stop();
	});

	it("emits terminal focus change notifications with previous state", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui = new TUI(terminal);
		const changes: Array<{ focused: boolean; previousFocused: boolean }> = [];
		const unsubscribe = tui.onTerminalFocusChange((focused, previousFocused) => {
			changes.push({ focused, previousFocused });
		});

		tui.start();
		await terminal.flush();

		terminal.setFocused(false);
		terminal.setFocused(true);
		await terminal.flush();

		assert.deepStrictEqual(changes, [
			{ focused: false, previousFocused: true },
			{ focused: true, previousFocused: false },
		]);

		unsubscribe();
		tui.stop();
	});
});
