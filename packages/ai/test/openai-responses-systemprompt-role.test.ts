import { describe, expect, it } from "vitest";
import { convertResponsesMessages } from "../src/providers/openai-responses-shared.js";
import type { Model } from "../src/types.js";

describe("openai-responses systemPrompt role", () => {
	const baseModel: Model<"openai-responses"> = {
		id: "test",
		name: "test",
		api: "openai-responses",
		provider: "test",
		baseUrl: "http://localhost:11434/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	};

	it("defaults to developer when reasoning=true", () => {
		const input = convertResponsesMessages(baseModel, { systemPrompt: "SP", messages: [] }, new Set());
		expect(input[0]).toMatchObject({ role: "developer" });
	});

	it("uses system when compat.supportsDeveloperRole=false", () => {
		const input = convertResponsesMessages(
			{ ...baseModel, compat: { supportsDeveloperRole: false } as any },
			{ systemPrompt: "SP", messages: [] },
			new Set(),
		);
		expect(input[0]).toMatchObject({ role: "system" });
	});
});
