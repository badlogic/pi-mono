import assert from "node:assert";
import { describe, it } from "node:test";
import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy.ts";

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

	it("prefers whole-string matches over prefixes and prefixes over embedded substrings", () => {
		const exact = fuzzyMatch("app", "app");
		const prefix = fuzzyMatch("app", "application");
		const embedded = fuzzyMatch("app", "my-application");
		assert.strictEqual(exact.matches, true);
		assert.ok(exact.score < 0);
		assert.ok(exact.score < prefix.score);
		assert.ok(prefix.score < embedded.score);
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

	it("word boundary matches score better for scattered matches", () => {
		const atBoundary = fuzzyMatch("fb", "foo-bar");
		const notAtBoundary = fuzzyMatch("fb", "afxby");

		assert.strictEqual(atBoundary.matches, true);
		assert.strictEqual(notAtBoundary.matches, true);
		assert.ok(atBoundary.score < notAtBoundary.score);
	});

	it("rewards embedded substrings over earlier scattered matches", () => {
		const substring = fuzzyMatch("opus", "anthropic/claude-opus-5");
		const scattered = fuzzyMatch("opus", "anthropic/claude-sonnet-5");
		assert.strictEqual(substring.matches, true);
		assert.strictEqual(scattered.matches, true);
		assert.ok(substring.score < scattered.score);
	});

	it("retains position penalties for substring matches by default", () => {
		assert.ok(fuzzyMatch("sol", "gpt-6-sol").score < fuzzyMatch("sol", "gpt-6.1-sol").score);
		assert.ok(
			fuzzyMatch("mode", "Output mode").score < fuzzyMatch("mode", "A long description mentioning mode").score,
		);
	});

	it("retains actual word boundaries for substring matches", () => {
		assert.ok(fuzzyMatch("cache", "prompt-cache").score < fuzzyMatch("cache", "mycache").score);
	});

	it("can ignore position while retaining word boundaries and gap penalties", () => {
		const options = { ignorePosition: true };
		assert.strictEqual(
			fuzzyMatch("sol", "gpt-6.1-sol", options).score,
			fuzzyMatch("SOL", "gpt-6-sol", options).score,
		);
		assert.ok(fuzzyMatch("cache", "prompt-cache", options).score < fuzzyMatch("cache", "mycache", options).score);
		assert.ok(fuzzyMatch("app", "a_p_p", options).score < fuzzyMatch("app", "a___p___p", options).score);
	});

	it("matches swapped alpha numeric tokens", () => {
		const result = fuzzyMatch("codex52", "gpt-5.2-codex");
		assert.strictEqual(result.matches, true);
	});
});

describe("fuzzyFilter", () => {
	it("empty queries return all items unchanged", () => {
		const items = ["banana", "apple", "cherry"];
		for (const query of ["", "  ", "/"]) {
			assert.deepStrictEqual(
				fuzzyFilter(items, query, (item) => item),
				items,
			);
		}
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

	it("preserves input order for equally scoring substring matches", () => {
		const items = ["a___p___p", "banana", "my-application", "a_p_p", "my-app"];
		const result = fuzzyFilter(items, "APP", (item) => item);

		assert.deepStrictEqual(result, ["my-application", "my-app", "a_p_p", "a___p___p"]);
		assert.deepStrictEqual(items, ["a___p___p", "banana", "my-application", "a_p_p", "my-app"]);
	});

	it("uses input order for equal scores when position penalties are disabled", () => {
		const items = ["openai s_o_l", "gpt-6.1-sol openai", "gpt-6-sol other", "gpt-6-sol openai"];
		for (const query of ["openai sol", "openai/sol", "SOL OPENAI"]) {
			assert.deepStrictEqual(
				fuzzyFilter(items, query, (item) => item),
				[items[3], items[1], items[0]],
			);
			assert.deepStrictEqual(
				fuzzyFilter(items, query, (item) => item, { ignorePosition: true }),
				[items[1], items[3], items[0]],
			);
		}
	});

	it("prioritizes exact matches over longer prefix matches", () => {
		const items = ["clone", "cl"];
		const result = fuzzyFilter(items, "cl", (x: string) => x);

		assert.deepStrictEqual(result, ["cl", "clone"]);
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

	it("retains swapped alpha numeric matches after contiguous matches", () => {
		const items = ["gpt-5.2-codex", "codex52"];
		assert.deepStrictEqual(
			fuzzyFilter(items, "codex52", (item) => item),
			[items[1], items[0]],
		);
	});

	it("matches slash-separated provider/model queries against reordered text", () => {
		const item = { id: "gpt-5.5", provider: "openai-codex" };
		const result = fuzzyFilter([item], "openai-codex/gpt-5.5", (model) => `${model.id} ${model.provider}`);

		assert.deepStrictEqual(result, [item]);
	});
});
