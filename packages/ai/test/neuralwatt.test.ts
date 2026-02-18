import { beforeEach, describe, expect, it } from "vitest";
import { getEnvApiKey } from "../src/env-api-keys.js";
import { getModel, getModels, getProviders } from "../src/models.js";
import type { Model } from "../src/types.js";

describe("Neuralwatt provider configuration", () => {
	describe("model registry", () => {
		it("should include neuralwatt in the list of providers", () => {
			const providers = getProviders();
			expect(providers).toContain("neuralwatt");
		});

		it("should have neuralwatt-large model", () => {
			const model = getModel("neuralwatt", "neuralwatt-large");
			expect(model).toBeDefined();
			expect(model.id).toBe("neuralwatt-large");
			expect(model.api).toBe("openai-completions");
			expect(model.provider).toBe("neuralwatt");
			expect(model.baseUrl).toBe("https://api.neuralwatt.com/v1");
			expect(model.reasoning).toBe(true);
			expect(model.input).toContain("text");
			expect(model.input).toContain("image");
			expect(model.contextWindow).toBe(128000);
			expect(model.maxTokens).toBe(16384);
		});

		it("should have neuralwatt-small model", () => {
			const model = getModel("neuralwatt", "neuralwatt-small");
			expect(model).toBeDefined();
			expect(model.id).toBe("neuralwatt-small");
			expect(model.api).toBe("openai-completions");
			expect(model.provider).toBe("neuralwatt");
			expect(model.baseUrl).toBe("https://api.neuralwatt.com/v1");
			expect(model.reasoning).toBe(false);
			expect(model.input).toEqual(["text"]);
			expect(model.contextWindow).toBe(128000);
			expect(model.maxTokens).toBe(8192);
		});

		it("should have neuralwatt-small cost lower than neuralwatt-large", () => {
			const large = getModel("neuralwatt", "neuralwatt-large");
			const small = getModel("neuralwatt", "neuralwatt-small");
			expect(small.cost.output).toBeLessThan(large.cost.output);
			expect(small.cost.input).toBeLessThan(large.cost.input);
		});

		it("should return all neuralwatt models via getModels", () => {
			const models = getModels("neuralwatt");
			expect(models.length).toBe(2);
			const ids = models.map((m: Model<"openai-completions">) => m.id);
			expect(ids).toContain("neuralwatt-large");
			expect(ids).toContain("neuralwatt-small");
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
				const model = getModel("neuralwatt", "neuralwatt-large");
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

	describe("model compat settings", () => {
		it("should have conservative compat settings for neuralwatt models", () => {
			const large = getModel("neuralwatt", "neuralwatt-large");
			expect(large.compat).toBeDefined();
			expect(large.compat!.supportsStore).toBe(false);
			expect(large.compat!.supportsDeveloperRole).toBe(false);
			expect(large.compat!.supportsReasoningEffort).toBe(false);
			expect(large.compat!.maxTokensField).toBe("max_tokens");
		});
	});
});
