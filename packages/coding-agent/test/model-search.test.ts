import { fuzzyFilter } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { getModelSelectorSearchText } from "../src/modes/interactive/model-search.ts";

describe("model selector search ranking", () => {
	// #11220
	it("ranks models containing the query above scattered matches", () => {
		const models = [
			{ provider: "openrouter", id: "openai/gpt-oss-120b", name: "OpenAI: gpt-oss-120b" },
			{ provider: "openrouter", id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5" },
			{ provider: "openrouter", id: "anthropic/claude-opus-4.1", name: "Anthropic: Claude Opus 4.1" },
			{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
			{ provider: "anthropic", id: "claude-opus-4-1", name: "Claude Opus 4.1" },
		];

		const result = fuzzyFilter(models, "opus", getModelSelectorSearchText).map((m) => m.id);

		expect(result.slice(0, 2).sort()).toEqual(["anthropic/claude-opus-4.1", "claude-opus-4-1"]);
	});

	// #10065
	it("ranks the typed model above models sharing a long provider prefix", () => {
		const models = [
			{ provider: "fireworks", id: "accounts/fireworks/models/deepseek-v4-flash-0731" },
			{ provider: "fireworks", id: "accounts/fireworks/models/kimi-k3" },
			{ provider: "fireworks", id: "accounts/fireworks/routers/firerouter", name: "FireRouter" },
		];

		const result = fuzzyFilter(models, "firerouter", getModelSelectorSearchText);

		expect(result[0]?.id).toBe("accounts/fireworks/routers/firerouter");
	});
});
