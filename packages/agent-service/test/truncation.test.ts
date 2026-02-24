import { truncateTail } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

describe("tool truncation behavior", () => {
	it("truncates oversized output and reports metadata", () => {
		const lines = Array.from({ length: 4000 }, (_, index) => `line-${index}`).join("\n");
		const result = truncateTail(lines, { maxLines: 100, maxBytes: 8 * 1024 });
		expect(result.truncated).toBe(true);
		expect(result.outputLines).toBeLessThanOrEqual(100);
		expect(result.outputBytes).toBeLessThanOrEqual(8 * 1024);
	});
});
