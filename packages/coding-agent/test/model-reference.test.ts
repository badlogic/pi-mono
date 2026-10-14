import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { type ModelReferenceRequest, resolveModelReference } from "../src/core/model-reference.ts";

function model(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	};
}

const catalog = [
	model("anthropic", "claude-sonnet-4-5"),
	model("anthropic", "claude-sonnet-4-5-20250929"),
	model("anthropic", "claude-opus-4-8"),
	model("anthropic", "exact"),
	// Fuzzy-matches "shared"; an ambiguous exact "shared" must not fall through to it.
	model("anthropic", "shared-pro"),
	model("openai", "gpt-4o"),
	model("openrouter", "qwen/qwen3-coder:exacto"),
	model("openrouter", "openai/gpt-4o:extended"),
	model("gw-a", "shared"),
	model("gw-a", "anthropic/future"),
	model("gw-a", "anthropic/exact"),
	model("gw-a", "anthropic/claude-opus-4.8"),
	model("gw-a", "anthropic/claude-opus"),
	model("gw-b", "shared"),
	model("gw-b", "anthropic/future"),
	model("gw-b", "claude-opus-4-8"),
	model("gw-b", "gw-b/free"),
	model("gw-b", "zz:free"),
];

type Expected =
	| { model: string; thinkingLevel?: string; warning?: string }
	| { ambiguous: string[]; usableCount: number }
	| "not-found";

interface Case {
	name: string;
	text: string;
	expected: Expected;
	usable?: string[];
	provider?: string;
	thinkingSuffix?: ModelReferenceRequest["thinkingSuffix"];
	fuzzy?: boolean;
}

const cases: Case[] = [
	// Reference syntax
	{ name: "exact id", text: "claude-sonnet-4-5", expected: { model: "anthropic/claude-sonnet-4-5" } },
	{ name: "exact id is case-insensitive", text: "GPT-4O", expected: { model: "openai/gpt-4o" } },
	{ name: "fuzzy prefers aliases over dated ids", text: "sonnet", expected: { model: "anthropic/claude-sonnet-4-5" } },
	{
		name: "thinking suffix",
		text: "sonnet:high",
		expected: { model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" },
	},
	{
		name: "colon in a literal id is not a thinking suffix",
		text: "qwen/qwen3-coder:exacto",
		expected: { model: "openrouter/qwen/qwen3-coder:exacto" },
	},
	{
		name: "provider prefix, colon id, and thinking suffix",
		text: "openrouter/qwen/qwen3-coder:exacto:high",
		expected: { model: "openrouter/qwen/qwen3-coder:exacto", thinkingLevel: "high" },
	},
	{
		name: "raw id wins when the provider prefix names no matching model",
		text: "openai/gpt-4o:extended",
		expected: { model: "openrouter/openai/gpt-4o:extended" },
	},
	{
		name: "fuzzy searches the prefixed provider first",
		text: "openrouter/qwen",
		expected: { model: "openrouter/qwen/qwen3-coder:exacto" },
	},
	{ name: "strict keeps an invalid suffix in the id", text: "gpt-4o:random", expected: "not-found" },
	{
		name: "lenient drops an invalid suffix with a warning",
		text: "gpt-4o:random",
		thinkingSuffix: "lenient",
		expected: { model: "openai/gpt-4o", warning: 'Invalid thinking level "random"' },
	},
	{
		name: "lenient invalid outer suffix discards the inner thinking level",
		text: "qwen/qwen3-coder:exacto:high:random",
		thinkingSuffix: "lenient",
		expected: { model: "openrouter/qwen/qwen3-coder:exacto", warning: 'Invalid thinking level "random"' },
	},
	{ name: "none keeps the suffix in the id", text: "gpt-4o:high", thinkingSuffix: "none", expected: "not-found" },
	{ name: "exact-only skips fuzzy matches", text: "sonnet", fuzzy: false, expected: "not-found" },
	{ name: "empty text", text: "  ", expected: "not-found" },

	// Exact matches across providers
	// #7327
	{ name: "sole usable provider wins", text: "shared", usable: ["gw-b"], expected: { model: "gw-b/shared" } },
	{
		name: "no usable provider is ambiguous instead of falling through to fuzzy",
		text: "shared",
		expected: { ambiguous: ["gw-a/shared", "gw-b/shared"], usableCount: 0 },
	},
	{
		name: "several usable providers are ambiguous",
		text: "shared",
		usable: ["gw-a", "gw-b"],
		expected: { ambiguous: ["gw-a/shared", "gw-b/shared"], usableCount: 2 },
	},
	{
		name: "thinking suffix does not change provider selection",
		text: "shared:high",
		usable: ["gw-b"],
		expected: { model: "gw-b/shared", thinkingLevel: "high" },
	},
	{
		name: "thinking suffix does not bypass ambiguity",
		text: "shared:high",
		usable: ["gw-a", "gw-b"],
		expected: { ambiguous: ["gw-a/shared", "gw-b/shared"], usableCount: 2 },
	},
	{
		// #10160
		name: "provider prefix without a direct model selects the usable raw id",
		text: "anthropic/future",
		usable: ["gw-b"],
		expected: { model: "gw-b/anthropic/future" },
	},
	{
		// #5823
		name: "usable qualified match beats a usable raw id",
		text: "anthropic/exact",
		usable: ["anthropic", "gw-a"],
		expected: { model: "anthropic/exact" },
	},
	{
		// #5643
		name: "usable raw id beats an unusable qualified match",
		text: "anthropic/exact",
		usable: ["gw-a"],
		expected: { model: "gw-a/anthropic/exact" },
	},
	{
		name: "unusable qualified match is kept when nothing is usable",
		text: "anthropic/exact",
		expected: { model: "anthropic/exact" },
	},

	{
		// Like `mistral/codestral` -> mistral/codestral-latest despite gateway id `mistral/codestral`
		name: "named provider's usable fuzzy match beats a raw id elsewhere",
		text: "anthropic/claude-opus",
		usable: ["anthropic"],
		expected: { model: "anthropic/claude-opus-4-8" },
	},
	{
		name: "usable raw id beats the named provider's unusable fuzzy match",
		text: "anthropic/claude-opus",
		usable: ["gw-a"],
		expected: { model: "gw-a/anthropic/claude-opus" },
	},
	{
		name: "named provider's fuzzy match is kept when nothing is usable",
		text: "anthropic/claude-opus",
		expected: { model: "anthropic/claude-opus-4-8" },
	},
	{
		name: "named provider's literal id beats its fuzzy matches",
		text: "gw-b/free",
		expected: { model: "gw-b/gw-b/free" },
	},

	// Fuzzy matches across providers
	{
		name: "fuzzy prefers usable providers",
		text: "opus",
		usable: ["gw-a"],
		expected: { model: "gw-a/anthropic/claude-opus-4.8" },
	},
	{
		name: "fuzzy id tie across usable providers is ambiguous",
		text: "opus",
		usable: ["anthropic", "gw-a", "gw-b"],
		expected: { ambiguous: ["anthropic/claude-opus-4-8", "gw-b/claude-opus-4-8"], usableCount: 2 },
	},
	{
		name: "fuzzy id tie resolves to the sole usable provider",
		text: "opus",
		usable: ["anthropic"],
		expected: { model: "anthropic/claude-opus-4-8" },
	},

	// Explicit provider constraint
	{
		name: "explicit provider ignores usable providers elsewhere",
		text: "shared",
		provider: "gw-a",
		usable: ["gw-b"],
		expected: { model: "gw-a/shared" },
	},
	{
		name: "explicit provider accepts its own prefix",
		text: "GW-B/shared",
		provider: "gw-b",
		expected: { model: "gw-b/shared" },
	},
	{
		name: "explicit provider allows fuzzy matches",
		text: "4o",
		provider: "openai",
		expected: { model: "openai/gpt-4o" },
	},
	{ name: "explicit provider never leaves the provider", text: "gpt-4o", provider: "gw-a", expected: "not-found" },
];

function ref(m: Model<Api>): string {
	return `${m.provider}/${m.id}`;
}

describe("resolveModelReference", () => {
	test.each(cases)("$name", (testCase) => {
		const usable = new Set(testCase.usable);
		const request: ModelReferenceRequest = {
			text: testCase.text,
			provider: testCase.provider,
			thinkingSuffix: testCase.thinkingSuffix ?? "strict",
			fuzzy: testCase.fuzzy ?? true,
		};
		// Catalog order must never decide the result.
		for (const models of [catalog, [...catalog].reverse()]) {
			const result = resolveModelReference(request, models, (provider) => usable.has(provider));
			const expected = testCase.expected;
			if (expected === "not-found") {
				expect(result.status).toBe("not-found");
			} else if ("ambiguous" in expected) {
				expect(result.status).toBe("ambiguous");
				if (result.status !== "ambiguous") continue;
				expect(result.candidates.map(ref).sort()).toEqual(expected.ambiguous);
				expect(result.usableCount).toBe(expected.usableCount);
			} else {
				expect(result.status).toBe("resolved");
				if (result.status !== "resolved") continue;
				expect(ref(result.model)).toBe(expected.model);
				expect(result.thinkingLevel).toBe(expected.thinkingLevel);
				if (expected.warning) expect(result.warning).toContain(expected.warning);
				else expect(result.warning).toBeUndefined();
			}
		}
	});
});
