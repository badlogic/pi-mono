import { beforeEach, describe, expect, it } from "vitest";
import { getEnvApiKey } from "../src/env-api-keys.js";
import { getModel, getModels, getProviders } from "../src/models.js";
import type { Model } from "../src/types.js";

/**
 * Neuralwatt models are manually added to models.generated.ts and are NOT
 * fetched by the generation script. In CI, `npm run generate-models` overwrites
 * the file from live APIs, so neuralwatt entries disappear. The model registry
 * tests are skipped when neuralwatt isn't present in the generated file.
 */
const hasNeuralwatt = getProviders().includes("neuralwatt" as never);

describe("Neuralwatt provider configuration", () => {
	describe.skipIf(!hasNeuralwatt)("model registry", () => {
		it("should include neuralwatt in the list of providers", () => {
			const providers = getProviders();
			expect(providers).toContain("neuralwatt");
		});

		it("should have all 7 neuralwatt models", () => {
			const models = getModels("neuralwatt");
			expect(models.length).toBe(7);
			const ids = models.map((m) => m.id);
			expect(ids).toContain("mistralai/Devstral-Small-2-24B-Instruct-2512");
			expect(ids).toContain("openai/gpt-oss-20b");
			expect(ids).toContain("moonshotai/Kimi-K2.5");
			expect(ids).toContain("MiniMaxAI/MiniMax-M2.5");
			expect(ids).toContain("Qwen/Qwen3.5-397B-A17B-FP8");
			expect(ids).toContain("Qwen/Qwen3.5-35B-A3B");
			expect(ids).toContain("zai-org/GLM-5-FP8");
		});

		it("should have correct properties for Devstral model", () => {
			const model = getModel("neuralwatt", "mistralai/Devstral-Small-2-24B-Instruct-2512");
			expect(model).toBeDefined();
			expect(model.api).toBe("openai-completions");
			expect(model.provider).toBe("neuralwatt");
			expect(model.baseUrl).toBe("https://api.neuralwatt.com/v1");
			expect(model.reasoning).toBe(false);
			expect(model.input).toEqual(["text"]);
			expect(model.contextWindow).toBe(262144);
			expect(model.maxTokens).toBe(16384);
			expect(model.capabilities).toContain("tool_calling");
		});

		it("should have correct properties for GPT-OSS model", () => {
			const model = getModel("neuralwatt", "openai/gpt-oss-20b");
			expect(model).toBeDefined();
			expect(model.contextWindow).toBe(16384);
			expect(model.maxTokens).toBe(4096);
			expect(model.capabilities).toContain("tool_calling");
		});

		it("should have correct context window and pricing for Kimi K2.5", () => {
			const model = getModel("neuralwatt", "moonshotai/Kimi-K2.5");
			expect(model).toBeDefined();
			expect(model.contextWindow).toBe(262144);
			expect(model.cost.input).toBe(1.327);
			expect(model.cost.output).toBe(1.327);
		});

		it("should have free pricing for Qwen3.5-397B", () => {
			const model = getModel("neuralwatt", "Qwen/Qwen3.5-397B-A17B-FP8");
			expect(model).toBeDefined();
			expect(model.cost.input).toBe(0);
			expect(model.cost.output).toBe(0);
			expect(model.contextWindow).toBe(262144);
		});

		it("should have Kimi K2.5 as the most expensive model", () => {
			const models = getModels("neuralwatt");
			const kimi = models.find((m) => m.id === "moonshotai/Kimi-K2.5")!;
			for (const model of models) {
				if (model.id !== kimi.id) {
					expect(model.cost.output).toBeLessThanOrEqual(kimi.cost.output);
				}
			}
		});

		it("should have conservative compat settings for neuralwatt models", () => {
			const model = getModel("neuralwatt", "openai/gpt-oss-20b") as Model<"openai-completions">;
			expect(model.compat).toBeDefined();
			expect(model.compat!.supportsStore).toBe(false);
			expect(model.compat!.supportsDeveloperRole).toBe(false);
			expect(model.compat!.supportsReasoningEffort).toBe(false);
			expect(model.compat!.maxTokensField).toBe("max_tokens");
		});
	});

	describe("env-api-keys", () => {
		const originalEnv = process.env;

		beforeEach(() => {
			process.env = { ...originalEnv };
		});

		it("should return NEURALWATT_API_KEY when set", () => {
			process.env.NEURALWATT_API_KEY = "nw-test-key-123";
			const key = getEnvApiKey("neuralwatt");
			expect(key).toBe("nw-test-key-123");
		});

		it("should return undefined when NEURALWATT_API_KEY is not set", () => {
			delete process.env.NEURALWATT_API_KEY;
			const key = getEnvApiKey("neuralwatt");
			expect(key).toBeUndefined();
		});
	});

	describe.skipIf(!process.env.NEURALWATT_API_KEY || !process.env.NEURALWATT_INTEGRATION)(
		"OpenAI-compatible streaming (integration)",
		() => {
			it("should complete a chat request through Neuralwatt endpoint", { timeout: 30000 }, async () => {
				const { complete } = await import("../src/stream.js");
				const model = getModel("neuralwatt", "openai/gpt-oss-20b");
				const response = await complete(model, {
					systemPrompt: "You are a helpful assistant. Be concise.",
					messages: [
						{ role: "user", content: "Reply with exactly: 'Hello test successful'", timestamp: Date.now() },
					],
				});
				expect(response.role).toBe("assistant");
				expect(response.content.length).toBeGreaterThan(0);
				expect(response.usage.output).toBeGreaterThan(0);
			});
		},
	);
});
