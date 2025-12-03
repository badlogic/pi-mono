import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findModelAsync, getAvailableModels, loadAndMergeModels } from "../model-config.js";
import { detectVibeProxy, generateVibeProxyConfig } from "../vibeproxy.js";

// Mock the VibeProxy module
vi.mock("../vibeproxy.js", () => ({
	detectVibeProxy: vi.fn(),
	generateVibeProxyConfig: vi.fn(),
}));

const mockDetectVibeProxy = vi.mocked(detectVibeProxy);
const mockGenerateVibeProxyConfig = vi.mocked(generateVibeProxyConfig);

describe("Model Config VibeProxy Integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("loadAndMergeModels with VibeProxy", () => {
		it("should include VibeProxy models when VibeProxy is running", async () => {
			// Mock VibeProxy detection
			mockDetectVibeProxy.mockResolvedValue({
				running: true,
				port: 8318,
				models: [
					{ id: "claude-sonnet-4-20250514", object: "model" },
					{ id: "claude-opus-4-20250514", object: "model" },
				],
			});

			mockGenerateVibeProxyConfig.mockReturnValue([
				{
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4 (via VibeProxy)",
					provider: "vibeproxy",
					api: "openai-completions",
					baseUrl: "http://localhost:8318/v1",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
				{
					id: "claude-opus-4-20250514",
					name: "Claude Opus 4 (via VibeProxy)",
					provider: "vibeproxy",
					api: "openai-completions",
					baseUrl: "http://localhost:8318/v1",
					reasoning: true,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 4096,
				},
			] as any);

			const { models, error } = await loadAndMergeModels();

			expect(error).toBeNull();
			expect(models.length).toBeGreaterThan(2); // Built-in models + VibeProxy models

			// Check that VibeProxy models are included
			const vibeproxyModels = models.filter((m) => m.provider === "vibeproxy");
			expect(vibeproxyModels).toHaveLength(2);
			expect(vibeproxyModels[0].id).toBe("claude-sonnet-4-20250514");
			expect(vibeproxyModels[1].id).toBe("claude-opus-4-20250514");

			expect(mockDetectVibeProxy).toHaveBeenCalledOnce();
			expect(mockGenerateVibeProxyConfig).toHaveBeenCalledWith([
				{ id: "claude-sonnet-4-20250514", object: "model" },
				{ id: "claude-opus-4-20250514", object: "model" },
			]);
		});

		it("should not include VibeProxy models when VibeProxy is not running", async () => {
			// Mock VibeProxy not running
			mockDetectVibeProxy.mockResolvedValue({
				running: false,
				port: 8318,
			});

			const { models, error } = await loadAndMergeModels();

			expect(error).toBeNull();

			// Should not contain any VibeProxy models
			const vibeproxyModels = models.filter((m) => m.provider === "vibeproxy");
			expect(vibeproxyModels).toHaveLength(0);

			expect(mockDetectVibeProxy).toHaveBeenCalledOnce();
			expect(mockGenerateVibeProxyConfig).not.toHaveBeenCalled();
		});

		it("should handle VibeProxy detection errors gracefully", async () => {
			// Mock VibeProxy detection error
			mockDetectVibeProxy.mockRejectedValue(new Error("Network error"));

			const { models, error } = await loadAndMergeModels();

			expect(error).toBeNull();

			// Should gracefully continue without VibeProxy models
			const vibeproxyModels = models.filter((m) => m.provider === "vibeproxy");
			expect(vibeproxyModels).toHaveLength(0);

			expect(mockDetectVibeProxy).toHaveBeenCalledOnce();
		});

		it("should use fallback models when VibeProxy returns no models", async () => {
			// Mock VibeProxy running but no models returned
			mockDetectVibeProxy.mockResolvedValue({
				running: true,
				port: 8318,
				models: [], // No models detected
			});

			// Mock fallback configuration
			mockGenerateVibeProxyConfig.mockReturnValue([
				{
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4 (via VibeProxy)",
					provider: "vibeproxy",
					api: "openai-completions",
					baseUrl: "http://localhost:8318/v1",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			] as any);

			const { models, error } = await loadAndMergeModels();

			expect(error).toBeNull();

			// Should include fallback VibeProxy models
			const vibeproxyModels = models.filter((m) => m.provider === "vibeproxy");
			expect(vibeproxyModels).toHaveLength(1);
			expect(vibeproxyModels[0].id).toBe("claude-sonnet-4-20250514");

			expect(mockGenerateVibeProxyConfig).toHaveBeenCalledWith([]);
		});
	});

	describe("findModelAsync with VibeProxy", () => {
		it("should find VibeProxy models when VibeProxy is running", async () => {
			// Mock VibeProxy with models
			mockDetectVibeProxy.mockResolvedValue({
				running: true,
				port: 8318,
				models: [{ id: "claude-sonnet-4-20250514", object: "model" }],
			});

			mockGenerateVibeProxyConfig.mockReturnValue([
				{
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4 (via VibeProxy)",
					provider: "vibeproxy",
					api: "openai-completions",
					baseUrl: "http://localhost:8318/v1",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			] as any);

			const { model, error } = await findModelAsync("vibeproxy", "claude-sonnet-4-20250514");

			expect(error).toBeNull();
			expect(model).toBeDefined();
			expect(model?.id).toBe("claude-sonnet-4-20250514");
			expect(model?.provider).toBe("vibeproxy");
		});

		it("should return null error for non-existent VibeProxy model", async () => {
			// Mock VibeProxy running but without the requested model
			mockDetectVibeProxy.mockResolvedValue({
				running: true,
				port: 8318,
				models: [{ id: "different-model", object: "model" }],
			});

			mockGenerateVibeProxyConfig.mockReturnValue([
				{
					id: "different-model",
					name: "Different Model (via VibeProxy)",
					provider: "vibeproxy",
					api: "openai-completions",
					baseUrl: "http://localhost:8318/v1",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			] as any);

			const { model, error } = await findModelAsync("vibeproxy", "claude-sonnet-4-20250514");

			expect(error).toBeNull();
			expect(model).toBeNull();
		});
	});

	describe("getAvailableModels with VibeProxy", () => {
		it("should include VibeProxy models with API availability", async () => {
			// Mock VibeProxy detection
			mockDetectVibeProxy.mockResolvedValue({
				running: true,
				port: 8318,
				models: [{ id: "claude-sonnet-4-20250514", object: "model" }],
			});

			mockGenerateVibeProxyConfig.mockReturnValue([
				{
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4 (via VibeProxy)",
					provider: "vibeproxy",
					api: "openai-completions",
					baseUrl: "http://localhost:8318/v1",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			] as any);

			const { models, error } = await getAvailableModels();

			expect(error).toBeNull();

			// Should include VibeProxy models since they have "dummy" API key
			const vibeproxyModels = models.filter((m) => m.provider === "vibeproxy");
			expect(vibeproxyModels.length).toBeGreaterThan(0);
		});
	});
});
