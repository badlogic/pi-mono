import { describe, expect, it } from "vitest";
import { getModel, getModels, streamSimple } from "../src/compat.ts";

const XIAOMI_PROVIDERS = ["xiaomi", "xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp"] as const;
const DEPRECATED_MODEL_IDS = ["mimo-v2-flash", "mimo-v2-omni", "mimo-v2-pro"] as const;
const REPLACEMENT_MODEL_IDS = ["mimo-v2.5", "mimo-v2.5-pro"] as const;

describe("Xiaomi MiMo models", () => {
	it.each(XIAOMI_PROVIDERS)("omits deprecated models from %s", (provider) => {
		const modelIds = getModels(provider).map((model) => model.id);
		for (const modelId of DEPRECATED_MODEL_IDS) expect(modelIds).not.toContain(modelId);
	});

	it.each(XIAOMI_PROVIDERS)("keeps replacement models on %s", (provider) => {
		const modelIds = getModels(provider).map((model) => model.id);
		for (const modelId of REPLACEMENT_MODEL_IDS) expect(modelIds).toContain(modelId);
	});

	// #10818
	it.each(XIAOMI_PROVIDERS)("maps minimal thinking to low on reasoning models for %s", (provider) => {
		const reasoningModels = getModels(provider).filter((model) => model.reasoning);
		expect(reasoningModels.length).toBeGreaterThan(0);
		for (const model of reasoningModels) expect(model.thinkingLevelMap?.minimal).toBe("low");
	});

	// #10818
	it("maps minimal thinking to low in the request payload", async () => {
		const model = getModel("xiaomi", "mimo-v2.6-pro");
		let payload: Record<string, unknown> | undefined;

		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
			{
				apiKey: "test-xiaomi-key",
				reasoning: "minimal",
				onPayload: (value) => {
					payload = value as Record<string, unknown>;
					throw new Error("payload captured");
				},
			},
		).result();

		expect(payload?.reasoning_effort).toBe("low");
	});
});
