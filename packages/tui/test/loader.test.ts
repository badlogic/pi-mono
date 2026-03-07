import assert from "node:assert";
import { afterEach, describe, it, mock } from "node:test";
import { Loader } from "../src/components/loader.js";
import type { TUI } from "../src/tui.js";

describe("Loader", () => {
	afterEach(() => {
		mock.timers.reset();
	});

	it("requests low-priority renders for spinner updates", () => {
		mock.timers.enable({ apis: ["setInterval"] });

		const ui = {
			requestRender: mock.fn(() => {}),
		} satisfies Pick<TUI, "requestRender">;

		const loader = new Loader(
			ui as unknown as TUI,
			(text) => text,
			(text) => text,
			"Working...",
		);

		assert.strictEqual(ui.requestRender.mock.calls.length, 1);
		assert.deepStrictEqual(ui.requestRender.mock.calls[0]?.arguments, [false, "low"]);

		mock.timers.tick(80);

		assert.strictEqual(ui.requestRender.mock.calls.length, 2);
		assert.deepStrictEqual(ui.requestRender.mock.calls[1]?.arguments, [false, "low"]);

		loader.stop();
	});
});
