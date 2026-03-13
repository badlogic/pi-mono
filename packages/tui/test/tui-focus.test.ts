import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component, Focusable } from "../src/tui.js";
import { TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class FocusTarget implements Component, Focusable {
	focused = false;

	render(_width: number): string[] {
		return ["focus-target"];
	}

	invalidate(): void {}
}

describe("TUI focus state", () => {
	it("tracks focus target changes", () => {
		const tui = new TUI(new VirtualTerminal(80, 24));
		const first = new FocusTarget();
		const second = new FocusTarget();
		const seen: Array<Component | null> = [];
		const unsubscribe = tui.onFocusTargetChange((component) => {
			seen.push(component);
		});

		try {
			tui.setFocus(first);
			tui.setFocus(second);
			tui.setFocus(null);

			assert.strictEqual(tui.getFocusedComponent(), null);
			assert.deepStrictEqual(seen, [first, second, null]);
			assert.strictEqual(first.focused, false);
			assert.strictEqual(second.focused, false);
		} finally {
			unsubscribe();
		}
	});

	it("tracks window focus from terminal focus reporting sequences", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		const focusChanges: boolean[] = [];
		const unsubscribe = tui.onWindowFocusChange((focused) => {
			focusChanges.push(focused);
		});

		tui.start();
		try {
			assert.strictEqual(tui.isWindowFocused(), true);

			terminal.sendInput("\x1b[O");
			await new Promise<void>((resolve) => process.nextTick(resolve));
			assert.strictEqual(tui.isWindowFocused(), false);

			terminal.sendInput("\x1b[I");
			await new Promise<void>((resolve) => process.nextTick(resolve));
			assert.strictEqual(tui.isWindowFocused(), true);

			assert.deepStrictEqual(focusChanges, [false, true]);
		} finally {
			unsubscribe();
			tui.stop();
		}
	});
});
