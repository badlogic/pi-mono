import assert from "node:assert";
import { describe, it } from "node:test";
import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy.js";

describe("fuzzyMatch", () => {
	it("empty query matches everything with score 0", () => {
		const result = fuzzyMatch("", "anything");
		assert.strictEqual(result.matches, true);
		assert.strictEqual(result.score, 0);
	});

	it("query longer than text does not match", () => {
		const result = fuzzyMatch("longquery", "short");
		assert.strictEqual(result.matches, false);
	});

	it("exact match has good score", () => {
		const result = fuzzyMatch("test", "test");
		assert.strictEqual(result.matches, true);
		assert.ok(result.score < 0); // Should be negative due to consecutive bonuses
	});

	it("characters must appear in order", () => {
		const matchInOrder = fuzzyMatch("abc", "aXbXc");
		assert.strictEqual(matchInOrder.matches, true);

		const matchOutOfOrder = fuzzyMatch("abc", "cba");
		assert.strictEqual(matchOutOfOrder.matches, false);
	});

	it("case insensitive matching", () => {
		const result = fuzzyMatch("ABC", "abc");
		assert.strictEqual(result.matches, true);

		const result2 = fuzzyMatch("abc", "ABC");
		assert.strictEqual(result2.matches, true);
	});

	it("consecutive matches score better than scattered matches", () => {
		const consecutive = fuzzyMatch("foo", "foobar");
		const scattered = fuzzyMatch("foo", "f_o_o_bar");

		assert.strictEqual(consecutive.matches, true);
		assert.strictEqual(scattered.matches, true);
		assert.ok(consecutive.score < scattered.score);
	});

	it("word boundary matches score better", () => {
		const atBoundary = fuzzyMatch("fb", "foo-bar");
		const notAtBoundary = fuzzyMatch("fb", "afbx");

		assert.strictEqual(atBoundary.matches, true);
		assert.strictEqual(notAtBoundary.matches, true);
		assert.ok(atBoundary.score < notAtBoundary.score);
	});

	it("matches swapped alpha numeric tokens", () => {
		const result = fuzzyMatch("codex52", "gpt-5.2-codex");
		assert.strictEqual(result.matches, true);
	});

	it("handles non-string text without throwing", () => {
		// Extensions/plugins may pass non-string values via getText callbacks at runtime
		const unsafeFuzzyMatch = fuzzyMatch as any;
		const result = unsafeFuzzyMatch("test", undefined);
		assert.strictEqual(result.matches, false);
	});

	it("handles non-string query without throwing", () => {
		const unsafeFuzzyMatch = fuzzyMatch as any;
		const result = unsafeFuzzyMatch(undefined, "test");
		assert.strictEqual(result.matches, true);
		assert.strictEqual(result.score, 0);
	});

	it("handles null inputs without throwing", () => {
		const unsafeFuzzyMatch = fuzzyMatch as any;
		const result = unsafeFuzzyMatch(null, null);
		assert.strictEqual(result.matches, true); // both coerce to ""
	});

	it("coerces numeric inputs to strings", () => {
		const unsafeFuzzyMatch = fuzzyMatch as any;
		const result = unsafeFuzzyMatch("12", 123);
		assert.strictEqual(result.matches, true);
	});
});

describe("fuzzyFilter", () => {
	it("empty query returns all items unchanged", () => {
		const items = ["apple", "banana", "cherry"];
		const result = fuzzyFilter(items, "", (x: string) => x);
		assert.deepStrictEqual(result, items);
	});

	it("filters out non-matching items", () => {
		const items = ["apple", "banana", "cherry"];
		const result = fuzzyFilter(items, "an", (x: string) => x);
		assert.ok(result.includes("banana"));
		assert.ok(!result.includes("apple"));
		assert.ok(!result.includes("cherry"));
	});

	it("sorts results by match quality", () => {
		const items = ["a_p_p", "app", "application"];
		const result = fuzzyFilter(items, "app", (x: string) => x);

		// "app" should be first (exact consecutive match at start)
		assert.strictEqual(result[0], "app");
	});

	it("works with custom getText function", () => {
		const items = [
			{ name: "foo", id: 1 },
			{ name: "bar", id: 2 },
			{ name: "foobar", id: 3 },
		];
		const result = fuzzyFilter(items, "foo", (item: { name: string; id: number }) => item.name);

		assert.strictEqual(result.length, 2);
		assert.ok(result.map((r) => r.name).includes("foo"));
		assert.ok(result.map((r) => r.name).includes("foobar"));
	});

	it("skips items where getText returns null or undefined", () => {
		const items = [{ name: "foo" }, { name: undefined }, { name: null }, { name: "bar" }];
		const result = fuzzyFilter(items, "foo", (item: any) => item.name);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0]!.name, "foo");
	});

	it("coerces non-string getText return values", () => {
		const items = [{ name: 123 }, { name: "test456" }];
		const result = fuzzyFilter(items, "12", (item: any) => item.name);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0]!.name, 123);
	});
});
