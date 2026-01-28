import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { Tool } from "../src/types.js";

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

describe("openai-completions tool_choice", () => {
	it("forwards toolChoice from simple options to payload", async () => {
		const { streamSimple } = await import("../src/stream.js");
		const { getModel } = await import("../src/models.js");
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
		const model = { ...baseModel, api: "openai-completions" } as const;
		const tools: Tool[] = [
			{
				name: "ping",
				description: "Ping tool",
				parameters: Type.Object({
					ok: Type.Boolean(),
				}),
			},
		];
		let payload: unknown;

		await streamSimple(
			model,
			{
				messages: [
					{
						role: "user",
						content: "Call ping with ok=true",
						timestamp: Date.now(),
					},
				],
				tools,
			},
			{
				apiKey: "test",
				toolChoice: "required",
				onPayload: (params: unknown) => {
					payload = params;
				},
			} as unknown as Parameters<typeof streamSimple>[2],
		).result();

		const params = (payload ?? lastParams) as { tool_choice?: string; tools?: unknown[] };
		expect(params.tool_choice).toBe("required");
		expect(Array.isArray(params.tools)).toBe(true);
		expect(params.tools?.length ?? 0).toBeGreaterThan(0);
	});
});
