import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";

describe("ModelRegistry Bedrock models", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-models-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("accepts anthropic-bedrock models without API keys", async () => {
		const modelsJsonPath = join(tempDir, "models.json");
		writeFileSync(
			modelsJsonPath,
			JSON.stringify(
				{
					providers: {
						bedrock: {
							baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
							apiKey: "bedrock",
							api: "anthropic-bedrock",
							models: [
								{
									id: "anthropic.claude-3-5-sonnet-20240620-v1:0",
									name: "Claude Sonnet (Bedrock)",
									reasoning: true,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 200000,
									maxTokens: 8192,
								},
							],
						},
					},
				},
				null,
				2,
			),
			"utf-8",
		);

		const authStorage = new AuthStorage(join(tempDir, "auth.json"));
		const registry = new ModelRegistry(authStorage, modelsJsonPath);
		const available = await registry.getAvailable();

		expect(available).toHaveLength(1);
		expect(available[0]?.api).toBe("anthropic-bedrock");
		expect(await registry.getApiKey(available[0]!)).toBe("bedrock");
	});
});
