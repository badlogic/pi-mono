import { describe, expect, test } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy.js";

describe("fuzzyMatch", () => {
	test("empty query matches everything with score 0", () => {
		const result = fuzzyMatch("", "anything");
		expect(result.matches).toBe(true);
		expect(result.score).toBe(0);
	});

	test("query longer than text does not match", () => {
		const result = fuzzyMatch("longquery", "short");
		expect(result.matches).toBe(false);
	});

	test("exact match has good score", () => {
		const result = fuzzyMatch("test", "test");
		expect(result.matches).toBe(true);
		expect(result.score).toBeLessThan(0); // Should be negative due to consecutive bonuses
	});

	test("characters must appear in order", () => {
		const matchInOrder = fuzzyMatch("abc", "aXbXc");
		expect(matchInOrder.matches).toBe(true);

		const matchOutOfOrder = fuzzyMatch("abc", "cba");
		expect(matchOutOfOrder.matches).toBe(false);
	});

	test("case insensitive matching", () => {
		const result = fuzzyMatch("ABC", "abc");
		expect(result.matches).toBe(true);

		const result2 = fuzzyMatch("abc", "ABC");
		expect(result2.matches).toBe(true);
	});

	test("consecutive matches score better than scattered matches", () => {
		const consecutive = fuzzyMatch("foo", "foobar");
		const scattered = fuzzyMatch("foo", "f_o_o_bar");

		expect(consecutive.matches).toBe(true);
		expect(scattered.matches).toBe(true);
		expect(consecutive.score).toBeLessThan(scattered.score);
	});

	test("word boundary matches score better", () => {
		const atBoundary = fuzzyMatch("fb", "foo-bar");
		const notAtBoundary = fuzzyMatch("fb", "afbx");

		expect(atBoundary.matches).toBe(true);
		expect(notAtBoundary.matches).toBe(true);
		expect(atBoundary.score).toBeLessThan(notAtBoundary.score);
	});
});

describe("fuzzyFilter", () => {
	test("empty query returns all items unchanged", () => {
		const items = ["apple", "banana", "cherry"];
		const result = fuzzyFilter(items, "", (x) => x);
		expect(result).toEqual(items);
	});

	test("filters out non-matching items", () => {
		const items = ["apple", "banana", "cherry"];
		const result = fuzzyFilter(items, "an", (x) => x);
		expect(result).toContain("banana");
		expect(result).not.toContain("apple");
		expect(result).not.toContain("cherry");
	});

	test("sorts results by match quality", () => {
		const items = ["a_p_p", "app", "application"];
		const result = fuzzyFilter(items, "app", (x) => x);

		// "app" should be first (exact consecutive match at start)
		expect(result[0]).toBe("app");
	});

	test("works with custom getText function", () => {
		const items = [
			{ name: "foo", id: 1 },
			{ name: "bar", id: 2 },
			{ name: "foobar", id: 3 },
		];
		const result = fuzzyFilter(items, "foo", (item) => item.name);

		expect(result.length).toBe(2);
		expect(result.map((r) => r.name)).toContain("foo");
		expect(result.map((r) => r.name)).toContain("foobar");
	});
});
