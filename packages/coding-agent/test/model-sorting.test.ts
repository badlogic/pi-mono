import { describe, expect, test } from "vitest";
import { compareModelIds, normalizeModelSearchText } from "../src/utils/model-sorting.js";

describe("normalizeModelSearchText", () => {
	test("treats dots and dashes as separators", () => {
		expect(normalizeModelSearchText("gpt-5.2-codex")).toBe("gpt 5 2 codex");
		expect(normalizeModelSearchText("claude-opus-4-5")).toBe("claude opus 4 5");
	});
});

describe("compareModelIds", () => {
	test("orders higher minor versions before lower ones", () => {
		expect(compareModelIds("gpt-5.2-codex", "gpt-5-codex")).toBeLessThan(0);
	});

	test("orders 4.5 before 4", () => {
		expect(compareModelIds("claude-sonnet-4.5", "claude-sonnet-4")).toBeLessThan(0);
	});

	test("orders higher patch numbers before lower ones", () => {
		expect(compareModelIds("claude-opus-4-5", "claude-opus-4-1")).toBeLessThan(0);
	});

	test("orders shorter ids before dated suffixes", () => {
		expect(compareModelIds("claude-opus-4-5", "claude-opus-4-5-20251101")).toBeLessThan(0);
	});

	test("orders newer dates before older ones", () => {
		expect(compareModelIds("claude-opus-4-5-20251101", "claude-opus-4-5-20250805")).toBeLessThan(0);
	});

	test("puts non-versioned ids after versioned ids", () => {
		expect(compareModelIds("codex-mini-latest", "gpt-5-codex")).toBeGreaterThan(0);
	});
});
