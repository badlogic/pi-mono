import { describe, expect, it, vi } from "vitest";
import type { Model } from "../src/types.js";

let lastParams: unknown;

class FakeOpenAI {
	chat = {
		completions: {
			create: async (params: unknown) => {
				lastParams = params;
				return {
					async *[Symbol.asyncIterator]() {
						yield {
							choices: [{ delta: {}, finish_reason: "stop" }],
							usage: {
								prompt_tokens: 1,
								completion_tokens: 1,
								prompt_tokens_details: { cached_tokens: 0 },
								completion_tokens_details: { reasoning_tokens: 0 },
							},
						};
					},
				};
			},
		},
	};
}

vi.mock("openai", () => ({ default: FakeOpenAI }));

describe("openai-completions compat detection", () => {
	it("handles undefined baseUrl without throwing", async () => {
		const { streamSimple } = await import("../src/stream.js");
		const { getModel } = await import("../src/models.js");
		const baseModel = getModel("openai", "gpt-4o-mini");
		if (!baseModel) {
			throw new Error("Missing model fixture: openai/gpt-4o-mini");
		}

		const model = {
			...baseModel,
			api: "openai-completions",
			baseUrl: undefined,
		} as unknown as Model<"openai-completions">;

		let payload: unknown;

		await streamSimple(
			model,
			{
				messages: [
					{
						role: "user",
						content: "hello",
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: "test",
				onPayload: (params: unknown) => {
					payload = params;
				},
			},
		).result();

		const params = (payload ?? lastParams) as { store?: boolean };
		expect(params.store).toBe(false);
	});
});
