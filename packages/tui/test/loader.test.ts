import assert from "node:assert";
import { describe, it } from "node:test";
import { Loader } from "../src/components/loader.js";

describe("Loader", () => {
	it("uses default braille frames and 80ms interval by default", () => {
		const originalSetInterval = globalThis.setInterval;
		const originalClearInterval = globalThis.clearInterval;

		let intervalMs: number | undefined;
		let tick: (() => void) | undefined;
		let cleared: any;

		(globalThis as any).setInterval = (fn: () => void, ms: number) => {
			intervalMs = ms;
			tick = fn;
			return 123 as any;
		};
		(globalThis as any).clearInterval = (id: any) => {
			cleared = id;
		};

		try {
			const ui = { requestRender: () => {} } as any;
			const loader = new Loader(
				ui,
				(s) => s,
				(s) => s,
				"MSG",
			);

			// First frame should be braille spinner start (⠋)
			const first = loader.render(40)[1].trim();
			assert.ok(first.startsWith("⠋ "), `expected first frame to start with '⠋', got: ${first}`);
			assert.ok(first.includes("MSG"));
			assert.strictEqual(intervalMs, 80);

			// Simulate one tick -> should advance to next braille frame (⠙)
			assert.ok(tick);
			tick?.();
			const second = loader.render(40)[1].trim();
			assert.ok(second.startsWith("⠙ "), `expected second frame to start with '⠙', got: ${second}`);

			loader.stop();
			assert.strictEqual(cleared, 123);
		} finally {
			globalThis.setInterval = originalSetInterval;
			globalThis.clearInterval = originalClearInterval;
		}
	});

	it("supports custom frames and interval", () => {
		const originalSetInterval = globalThis.setInterval;
		(globalThis as any).setInterval = (fn: () => void, ms: number) => {
			// Capture interval and tick, but don't actually schedule.
			(globalThis as any).__ms = ms;
			(globalThis as any).__tick = fn;
			return 456 as any;
		};

		try {
			const ui = { requestRender: () => {} } as any;
			const loader = new Loader(
				ui,
				(s) => s,
				(s) => s,
				"MSG",
				{
					frames: ["A", "B"],
					intervalMs: 100,
				},
			);

			assert.strictEqual((globalThis as any).__ms, 100);
			assert.ok(loader.render(40)[1].trim().startsWith("A "));

			(globalThis as any).__tick();
			assert.ok(loader.render(40)[1].trim().startsWith("B "));
		} finally {
			globalThis.setInterval = originalSetInterval;
			delete (globalThis as any).__ms;
			delete (globalThis as any).__tick;
		}
	});
});
