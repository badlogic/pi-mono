import { afterEach, describe, expect, it } from "vitest";
import { getModel, streamSimple } from "../src/compat.ts";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";

const originalScalewayApiKey = process.env.SCW_API_KEY;

afterEach(() => {
	if (originalScalewayApiKey === undefined) {
		delete process.env.SCW_API_KEY;
	} else {
		process.env.SCW_API_KEY = originalScalewayApiKey;
	}
});

describe("Scaleway models", () => {
	it("exposes the DeepSeek V4.1 Flash reasoning efforts from Scaleway's docs", () => {
		const model = getModel("scaleway", "deepseek-v4.1-flash");

		expect(model.thinkingLevelMap).toEqual({
			off: "none",
			minimal: null,
			low: "low",
			medium: null,
			high: "high",
			xhigh: null,
			max: "max",
		});
		expect(getSupportedThinkingLevels(model)).toEqual(["off", "low", "high", "max"]);
		expect(model.compat).toMatchObject({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsStrictMode: false,
			supportsReasoningEffort: true,
			thinkingFormat: "openai",
			supportsUsageInStreaming: true,
			maxTokensField: "max_completion_tokens",
		});
	});

	it("sends reasoning_effort for Scaleway reasoning models", async () => {
		const model = getModel("scaleway", "deepseek-v4.1-flash");
		let payload: Record<string, unknown> | undefined;

		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
			{
				apiKey: "test-scaleway-key",
				reasoning: "max",
				onPayload: (value) => {
					payload = value as Record<string, unknown>;
					throw new Error("payload captured");
				},
			},
		).result();

		expect(payload?.reasoning_effort).toBe("max");
		expect(payload?.max_completion_tokens).toBeDefined();
		expect(payload?.max_tokens).toBeUndefined();
		expect(payload?.store).toBeUndefined();
		expect(payload?.messages).toEqual([{ role: "user", content: "test" }]);
	});

	it("sends reasoning_effort none when thinking is off on models that support it", async () => {
		const model = getModel("scaleway", "glm-5.2");
		let payload: Record<string, unknown> | undefined;

		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
			{
				apiKey: "test-scaleway-key",
				onPayload: (value) => {
					payload = value as Record<string, unknown>;
					throw new Error("payload captured");
				},
			},
		).result();

		expect(payload?.reasoning_effort).toBe("none");
	});

	it("keeps the system role on Scaleway and omits reasoning for non-reasoning models", async () => {
		const model = getModel("scaleway", "llama-3.3-70b-instruct");
		let payload: Record<string, unknown> | undefined;

		await streamSimple(
			model,
			{
				systemPrompt: "Follow instructions.",
				messages: [{ role: "user", content: "test", timestamp: 0 }],
			},
			{
				apiKey: "test-scaleway-key",
				onPayload: (value) => {
					payload = value as Record<string, unknown>;
					throw new Error("payload captured");
				},
			},
		).result();

		const messages = payload?.messages as { role: string }[];
		expect(messages[0]?.role).toBe("system");
		expect(payload?.reasoning_effort).toBeUndefined();
	});

	it("resolves SCW_API_KEY from the environment", () => {
		process.env.SCW_API_KEY = "test-scaleway-key";

		expect(findEnvKeys("scaleway")).toEqual(["SCW_API_KEY"]);
		expect(getEnvApiKey("scaleway")).toBe("test-scaleway-key");
	});
});
