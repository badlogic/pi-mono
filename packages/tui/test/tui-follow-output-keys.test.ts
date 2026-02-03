import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class Lines implements Component {
	constructor(public lines: string[]) {}
	render(): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

describe("TUI followOutput key controls", () => {
	it("Shift+PageUp disables followOutput and scrolls viewportTop up", async () => {
		const terminal = new VirtualTerminal(20, 5);
		const tui = new TUI(terminal);
		tui.addChild(new Lines(Array.from({ length: 30 }, (_, i) => `L${i}`)));

		tui.start();
		await terminal.flush();

		const beforeTop = tui.getViewportTop();
		assert.ok(beforeTop > 0, `expected bottom viewportTop > 0, got ${beforeTop}`);
		assert.strictEqual(tui.getFollowOutput(), true);

		// Shift+PageUp (legacy escape sequence)
		terminal.sendInput("\x1b[5$");
		await terminal.flush();

		assert.strictEqual(tui.getFollowOutput(), false);
		assert.ok(tui.getViewportTop() < beforeTop, "expected viewportTop to move up");
	});
});
