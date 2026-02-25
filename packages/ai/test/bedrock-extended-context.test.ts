import { describe, expect, it } from "vitest";
import { getModels } from "../src/models.js";
import { streamBedrock } from "../src/providers/amazon-bedrock.js";
import type { Context, Model } from "../src/types.js";

describe("Bedrock [1m] Extended Context Models", () => {
	const bedrockModels = getModels("amazon-bedrock");

	const extendedContextFamilies = ["opus-4-6", "sonnet-4-6", "sonnet-4-5"];

	function findModel(id: string): Model<"bedrock-converse-stream"> {
		const model = bedrockModels.find((m) => m.id === id);
		expect(model, `Expected model ${id} to exist`).toBeDefined();
		return model as Model<"bedrock-converse-stream">;
	}

	describe("Model generation", () => {
		it("should generate [1m] variants for all supported model families and regions", () => {
			const extendedModels = bedrockModels.filter((m) => m.id.endsWith("[1m]"));
			expect(extendedModels.length).toBeGreaterThan(0);

			for (const family of extendedContextFamilies) {
				const familyModels = extendedModels.filter((m) => m.id.includes(family));
				expect(familyModels.length).toBeGreaterThan(0);
			}
		});

		it("should generate [1m] variants for Sonnet 4", () => {
			const extendedModels = bedrockModels.filter((m) => m.id.endsWith("[1m]"));
			const sonnet4Models = extendedModels.filter(
				(m) => m.id.includes("sonnet-4") && !m.id.includes("sonnet-4-5") && !m.id.includes("sonnet-4-6"),
			);
			expect(sonnet4Models.length).toBeGreaterThan(0);
		});

		it("should not generate [1m] variants for Haiku 4.5", () => {
			const haikuModels = bedrockModels.filter((m) => m.id.includes("haiku-4-5") && m.id.endsWith("[1m]"));
			expect(haikuModels).toHaveLength(0);
		});

		it("should set contextWindow to 1000000 for [1m] variants", () => {
			const extendedModels = bedrockModels.filter((m) => m.id.endsWith("[1m]"));
			for (const model of extendedModels) {
				expect(model.contextWindow).toBe(1000000);
			}
		});

		it("should preserve the base model with its original contextWindow", () => {
			const extendedModels = bedrockModels.filter((m) => m.id.endsWith("[1m]"));
			for (const extModel of extendedModels) {
				const baseId = extModel.id.slice(0, -4);
				const baseModel = findModel(baseId);
				expect(baseModel.contextWindow).toBeLessThan(1000000);
			}
		});

		it("should have [1M] in the display name", () => {
			const extendedModels = bedrockModels.filter((m) => m.id.endsWith("[1m]"));
			for (const model of extendedModels) {
				expect(model.name).toContain("[1M]");
			}
		});

		it("should only generate [1m] variants for inference profile IDs, not bare model IDs", () => {
			const extendedModels = bedrockModels.filter((m) => m.id.endsWith("[1m]"));
			for (const model of extendedModels) {
				const hasPrefix =
					model.id.startsWith("us.") || model.id.startsWith("eu.") || model.id.startsWith("global.");
				expect(hasPrefix, `${model.id} should have an inference profile prefix`).toBe(true);
			}
		});

		it("should copy all other properties from the base model", () => {
			const extendedModels = bedrockModels.filter((m) => m.id.endsWith("[1m]"));
			for (const extModel of extendedModels) {
				const baseId = extModel.id.slice(0, -4);
				const baseModel = findModel(baseId);

				expect(extModel.provider).toBe(baseModel.provider);
				expect(extModel.api).toBe(baseModel.api);
				expect(extModel.cost).toEqual(baseModel.cost);
				expect(extModel.reasoning).toBe(baseModel.reasoning);
				expect(extModel.input).toEqual(baseModel.input);
				expect(extModel.maxTokens).toBe(baseModel.maxTokens);
			}
		});
	});

	describe("Provider behavior", () => {
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
		};

		interface CapturedPayload {
			modelId: string;
			additionalModelRequestFields?: {
				anthropic_beta?: string[];
				thinking?: Record<string, unknown>;
			};
		}

		async function capturePayload(
			model: Model<"bedrock-converse-stream">,
			options: Record<string, unknown> = {},
		): Promise<CapturedPayload> {
			let payload: CapturedPayload | null = null;
			const abortController = new AbortController();
			abortController.abort();

			const s = streamBedrock(model, context, {
				maxTokens: 50,
				...options,
				signal: abortController.signal,
				onPayload: (p: unknown) => {
					payload = p as CapturedPayload;
				},
			});
			for await (const event of s) {
				if (event.type === "error") break;
			}

			expect(payload, "onPayload should have been called").not.toBeNull();
			return payload!;
		}

		it("should strip [1m] from modelId in the API payload", async () => {
			const model = findModel("us.anthropic.claude-sonnet-4-6[1m]");
			const payload = await capturePayload(model);

			expect(payload.modelId).toBe("us.anthropic.claude-sonnet-4-6");
		});

		it("should add context-1m beta header for [1m] models without reasoning", async () => {
			const model = findModel("us.anthropic.claude-sonnet-4-6[1m]");
			const payload = await capturePayload(model);

			expect(payload.additionalModelRequestFields).toBeDefined();
			expect(payload.additionalModelRequestFields!.anthropic_beta).toContain("context-1m-2025-08-07");
		});

		it("should add context-1m beta header alongside interleaved-thinking for [1m] models with reasoning", async () => {
			const model = findModel("us.anthropic.claude-sonnet-4-6[1m]");
			const payload = await capturePayload(model, { reasoning: "high" });

			expect(payload.additionalModelRequestFields).toBeDefined();
			const beta = payload.additionalModelRequestFields!.anthropic_beta;
			expect(beta).toContain("context-1m-2025-08-07");
			expect(beta).toContain("interleaved-thinking-2025-05-14");
		});

		it("should not add context-1m beta header for non-[1m] models", async () => {
			const model = findModel("us.anthropic.claude-sonnet-4-6");
			const payload = await capturePayload(model);

			expect(payload.additionalModelRequestFields).toBeUndefined();
		});

		it("should use adaptive thinking with context-1m beta for opus [1m]", async () => {
			const model = findModel("us.anthropic.claude-opus-4-6-v1[1m]");
			const payload = await capturePayload(model, { reasoning: "high" });

			expect(payload.modelId).toBe("us.anthropic.claude-opus-4-6-v1");
			expect(payload.additionalModelRequestFields).toBeDefined();
			expect(payload.additionalModelRequestFields!.anthropic_beta).toContain("context-1m-2025-08-07");
			expect(payload.additionalModelRequestFields!.thinking).toEqual({ type: "adaptive" });
		});
	});
});
