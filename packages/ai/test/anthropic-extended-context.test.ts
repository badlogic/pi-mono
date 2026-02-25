import { describe, expect, it, vi } from "vitest";
import { getModels } from "../src/models.js";
import { streamAnthropic } from "../src/providers/anthropic.js";
import type { Context } from "../src/types.js";

const mockState = vi.hoisted(() => ({
	constructorOpts: undefined as Record<string, unknown> | undefined,
	streamParams: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@anthropic-ai/sdk", () => {
	const fakeStream = {
		async *[Symbol.asyncIterator]() {
			yield {
				type: "message_start",
				message: {
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			};
			yield {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 5 },
			};
		},
		finalMessage: async () => ({
			usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
		}),
	};

	class FakeAnthropic {
		constructor(opts: Record<string, unknown>) {
			mockState.constructorOpts = opts;
		}
		messages = {
			stream: (params: Record<string, unknown>) => {
				mockState.streamParams = params;
				return fakeStream;
			},
		};
	}

	return { default: FakeAnthropic };
});

const context: Context = {
	systemPrompt: "You are a helpful assistant.",
	messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
};

async function captureRequest(
	modelId: string,
	apiKey: string,
	interleavedThinking: boolean,
): Promise<{ headers: Record<string, string>; params: Record<string, unknown> }> {
	mockState.constructorOpts = undefined;
	mockState.streamParams = undefined;

	const model = getModels("anthropic").find((candidate) => candidate.id === modelId);
	if (!model) {
		throw new Error(`Model not found: ${modelId}`);
	}
	const s = streamAnthropic(model, context, { apiKey, interleavedThinking });
	for await (const event of s) {
		if (event.type === "error") break;
	}

	const constructorOpts = mockState.constructorOpts as { defaultHeaders?: Record<string, string> } | undefined;
	const streamParams = mockState.streamParams as Record<string, unknown> | undefined;
	expect(constructorOpts).toBeDefined();
	expect(streamParams).toBeDefined();
	if (!constructorOpts || !streamParams) {
		throw new Error("Mock state was not captured");
	}

	const headers = constructorOpts.defaultHeaders ?? {};
	const params = streamParams;
	return { headers, params };
}

describe("Anthropic [1m] extended context", () => {
	it("generates [1m] aliases for supported families and excludes Haiku 4.5", () => {
		const anthropicModels = getModels("anthropic");
		const extendedModels = anthropicModels.filter((m) => m.id.endsWith("[1m]"));
		expect(extendedModels.length).toBeGreaterThan(0);

		expect(extendedModels.some((m) => m.id.includes("opus-4-6"))).toBe(true);
		expect(extendedModels.some((m) => m.id.includes("sonnet-4-6"))).toBe(true);
		expect(extendedModels.some((m) => m.id.includes("sonnet-4-5"))).toBe(true);
		expect(extendedModels.some((m) => m.id.includes("haiku-4-5"))).toBe(false);

		const sonnet4Models = extendedModels.filter(
			(m) => m.id.includes("sonnet-4") && !m.id.includes("sonnet-4-5") && !m.id.includes("sonnet-4-6"),
		);
		expect(sonnet4Models.length).toBeGreaterThan(0);
	});

	it("strips [1m] from payload model and adds context beta for API key auth", async () => {
		const { headers, params } = await captureRequest("claude-sonnet-4-6[1m]", "sk-ant-test", false);
		expect(params.model).toBe("claude-sonnet-4-6");

		const beta = headers["anthropic-beta"] ?? "";
		expect(beta).toContain("fine-grained-tool-streaming-2025-05-14");
		expect(beta).toContain("context-1m-2025-08-07");
		expect(beta).not.toContain("interleaved-thinking-2025-05-14");
	});

	it("combines context beta with oauth and interleaved betas", async () => {
		const { headers, params } = await captureRequest("claude-sonnet-4-6[1m]", "sk-ant-oat-test-token", true);
		expect(params.model).toBe("claude-sonnet-4-6");

		const beta = headers["anthropic-beta"] ?? "";
		expect(beta).toContain("claude-code-20250219");
		expect(beta).toContain("oauth-2025-04-20");
		expect(beta).toContain("fine-grained-tool-streaming-2025-05-14");
		expect(beta).toContain("interleaved-thinking-2025-05-14");
		expect(beta).toContain("context-1m-2025-08-07");
	});

	it("does not add context beta for non-[1m] models", async () => {
		const { headers, params } = await captureRequest("claude-sonnet-4-6", "sk-ant-test", false);
		expect(params.model).toBe("claude-sonnet-4-6");
		expect(headers["anthropic-beta"] ?? "").not.toContain("context-1m-2025-08-07");
	});
});
