import { describe, expect, it } from "vitest";
import { shouldReparsePartial } from "../src/utils/json-parse.ts";

describe("shouldReparsePartial (streaming parse throttle)", () => {
	it("zero-length buffer never parses", () => {
		expect(shouldReparsePartial(0, 0)).toBe(false);
	});

	it("first delta always parses", () => {
		expect(shouldReparsePartial(1, 0)).toBe(true);
		expect(shouldReparsePartial(4096, 0)).toBe(true);
	});

	it("small growth below threshold skips re-parse", () => {
		// 4096 parsed; +1 char growth is below max(4096, len/4)
		expect(shouldReparsePartial(4097, 4096)).toBe(false);
		// 100k parsed; +10k growth is below max(4096, 25000)
		expect(shouldReparsePartial(110000, 100000)).toBe(false);
	});

	it("growth past max(4096, len/4) triggers re-parse", () => {
		// +4096 growth on a tiny buffer
		expect(shouldReparsePartial(8192, 4096)).toBe(true);
		// geometric: 1MB parsed, +428k growth (>= 25% of 1.41MB)
		expect(shouldReparsePartial(1476 * 1024, 1024 * 1024)).toBe(true);
	});

	it("large buffers are bounded to O(log) parses per block", () => {
		// simulate 8MB stream in 1KB deltas with the throttle loop
		let last = 0;
		let parses = 0;
		for (let len = 1024; len <= 8 * 1024 * 1024; len += 1024) {
			if (shouldReparsePartial(len, last)) {
				parses++;
				last = len;
			}
		}
		// unthrottled would be 8192 parses; geometric stepping must stay tiny
		expect(parses).toBeLessThan(40);
	});
});
