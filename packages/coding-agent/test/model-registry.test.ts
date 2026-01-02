import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";

describe("ModelRegistry", () => {
	let tempDir: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-model-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		authStorage = new AuthStorage(join(tempDir, "auth.json"));
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	describe("provider override", () => {
		test("custom provider with same name as built-in replaces built-in models", () => {
			const modelsJsonPath = join(tempDir, "models.json");
			writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						anthropic: {
							baseUrl: "https://my-proxy.example.com/v1",
							apiKey: "TEST_API_KEY",
							api: "anthropic-messages",
							models: [
								{
									id: "claude-custom",
									name: "Claude Custom",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100000,
									maxTokens: 8000,
								},
							],
						},
					},
				}),
			);

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const allModels = registry.getAll();

			// Should have only the custom anthropic model, not built-in ones
			const anthropicModels = allModels.filter((m) => m.provider === "anthropic");
			expect(anthropicModels).toHaveLength(1);
			expect(anthropicModels[0].id).toBe("claude-custom");
			expect(anthropicModels[0].baseUrl).toBe("https://my-proxy.example.com/v1");
		});

		test("custom provider with same name as built-in does not affect other built-in providers", () => {
			const modelsJsonPath = join(tempDir, "models.json");
			writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						anthropic: {
							baseUrl: "https://my-proxy.example.com/v1",
							apiKey: "TEST_API_KEY",
							api: "anthropic-messages",
							models: [
								{
									id: "claude-custom",
									name: "Claude Custom",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100000,
									maxTokens: 8000,
								},
							],
						},
					},
				}),
			);

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const allModels = registry.getAll();

			// Other built-in providers should still have their models
			const googleModels = allModels.filter((m) => m.provider === "google");
			const openaiModels = allModels.filter((m) => m.provider === "openai");

			expect(googleModels.length).toBeGreaterThan(0);
			expect(openaiModels.length).toBeGreaterThan(0);
		});

		test("multiple built-in providers can be overridden", () => {
			const modelsJsonPath = join(tempDir, "models.json");
			writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						anthropic: {
							baseUrl: "https://anthropic-proxy.example.com/v1",
							apiKey: "ANTHROPIC_KEY",
							api: "anthropic-messages",
							models: [
								{
									id: "claude-proxy",
									name: "Claude Proxy",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100000,
									maxTokens: 8000,
								},
							],
						},
						google: {
							baseUrl: "https://google-proxy.example.com/v1",
							apiKey: "GOOGLE_KEY",
							api: "google-generative-ai",
							models: [
								{
									id: "gemini-proxy",
									name: "Gemini Proxy",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100000,
									maxTokens: 8000,
								},
							],
						},
					},
				}),
			);

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const allModels = registry.getAll();

			const anthropicModels = allModels.filter((m) => m.provider === "anthropic");
			const googleModels = allModels.filter((m) => m.provider === "google");

			expect(anthropicModels).toHaveLength(1);
			expect(anthropicModels[0].id).toBe("claude-proxy");
			expect(anthropicModels[0].baseUrl).toBe("https://anthropic-proxy.example.com/v1");

			expect(googleModels).toHaveLength(1);
			expect(googleModels[0].id).toBe("gemini-proxy");
			expect(googleModels[0].baseUrl).toBe("https://google-proxy.example.com/v1");
		});

		test("refresh() reloads overrides from disk", () => {
			const modelsJsonPath = join(tempDir, "models.json");
			writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						anthropic: {
							baseUrl: "https://first-proxy.example.com/v1",
							apiKey: "TEST_KEY",
							api: "anthropic-messages",
							models: [
								{
									id: "claude-first",
									name: "Claude First",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100000,
									maxTokens: 8000,
								},
							],
						},
					},
				}),
			);

			const registry = new ModelRegistry(authStorage, modelsJsonPath);

			// Verify initial state
			let anthropicModels = registry.getAll().filter((m) => m.provider === "anthropic");
			expect(anthropicModels[0].id).toBe("claude-first");

			// Update models.json
			writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						anthropic: {
							baseUrl: "https://second-proxy.example.com/v1",
							apiKey: "TEST_KEY",
							api: "anthropic-messages",
							models: [
								{
									id: "claude-second",
									name: "Claude Second",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100000,
									maxTokens: 8000,
								},
							],
						},
					},
				}),
			);

			// Refresh and verify
			registry.refresh();
			anthropicModels = registry.getAll().filter((m) => m.provider === "anthropic");
			expect(anthropicModels[0].id).toBe("claude-second");
			expect(anthropicModels[0].baseUrl).toBe("https://second-proxy.example.com/v1");
		});

		test("removing override from models.json restores built-in provider", () => {
			const modelsJsonPath = join(tempDir, "models.json");
			writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						anthropic: {
							baseUrl: "https://proxy.example.com/v1",
							apiKey: "TEST_KEY",
							api: "anthropic-messages",
							models: [
								{
									id: "claude-custom",
									name: "Claude Custom",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100000,
									maxTokens: 8000,
								},
							],
						},
					},
				}),
			);

			const registry = new ModelRegistry(authStorage, modelsJsonPath);

			// Verify override is active
			let anthropicModels = registry.getAll().filter((m) => m.provider === "anthropic");
			expect(anthropicModels).toHaveLength(1);
			expect(anthropicModels[0].id).toBe("claude-custom");

			// Remove override (empty providers)
			writeFileSync(modelsJsonPath, JSON.stringify({ providers: {} }));

			// Refresh and verify built-in models are restored
			registry.refresh();
			anthropicModels = registry.getAll().filter((m) => m.provider === "anthropic");
			expect(anthropicModels.length).toBeGreaterThan(1); // Built-in has multiple models
			expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
		});
	});
});
