import type { Model } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectVibeProxy, generateVibeProxyConfig, getFallbackVibeProxyModels } from "../vibeproxy.js";

describe("VibeProxy", () => {
	beforeEach(() => {
		vi.mock("node-fetch", () => ({
			default: vi.fn(),
		}));

		global.fetch = vi.fn() as any;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("detectVibeProxy", () => {
		it("should detect VibeProxy when running on default port", async () => {
			const mockFetch = vi.mocked(fetch);

			// Mock successful response from VibeProxy
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						endpoints: ["POST /v1/chat/completions"],
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						data: [
							{ id: "claude-sonnet-4-20250514", object: "model" },
							{ id: "claude-opus-4-20250514", object: "model" },
						],
					}),
				} as Response);

			const result = await detectVibeProxy();

			expect(result.running).toBe(true);
			expect(result.port).toBe(8318);
			expect(result.models).toHaveLength(2);
			expect(result.models?.[0].id).toBe("claude-sonnet-4-20250514");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8318/", {
				method: "GET",
				signal: expect.any(AbortSignal),
			});
			expect(fetch).toHaveBeenCalledWith("http://localhost:8318/v1/models", {
				signal: expect.any(AbortSignal),
			});
		});

		it("should detect VibeProxy on port 8317", async () => {
			const mockFetch = vi.mocked(fetch);

			mockFetch
				.mockResolvedValueOnce({
					ok: false, // 8318 fails
				} as Response)
				.mockResolvedValueOnce({
					ok: true, // 8317 succeeds
					json: async () => ({
						endpoints: ["POST /v1/chat/completions"],
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						data: [{ id: "gpt-5.1-codex", object: "model" }],
					}),
				} as Response);

			const result = await detectVibeProxy();

			expect(result.running).toBe(true);
			expect(result.port).toBe(8317);
			expect(result.models).toHaveLength(1);
		});

		it("should return not running when VibeProxy is not found", async () => {
			const mockFetch = vi.mocked(fetch);

			mockFetch.mockResolvedValue({
				ok: false,
			} as Response);

			const result = await detectVibeProxy();

			expect(result.running).toBe(false);
			expect(result.port).toBe(8318);
			expect(result.models).toBeUndefined();
		});

		it("should handle network errors gracefully", async () => {
			const mockFetch = vi.mocked(fetch);

			mockFetch.mockRejectedValue(new Error("Network error"));

			const result = await detectVibeProxy();

			expect(result.running).toBe(false);
			expect(result.port).toBe(8318);
		});

		it("should timeout properly", async () => {
			const mockFetch = vi.mocked(fetch);

			mockFetch.mockImplementation(async () => {
				// Don't resolve the promise to test timeout
				await new Promise((resolve) => setTimeout(resolve, 10000));
				return { ok: true } as Response;
			});

			const result = await detectVibeProxy();

			expect(result.running).toBe(false);
		});
	});

	describe("generateVibeProxyConfig", () => {
		it("should generate models from detected VibeProxy models", () => {
			const mockModels = [
				{
					id: "claude-sonnet-4-20250514",
					object: "model",
				},
				{
					id: "claude-opus-4-20250514",
					object: "model",
				},
				{
					id: "gpt-5.1-codex",
					object: "model",
				},
			];

			const models = generateVibeProxyConfig(mockModels);

			expect(models).toHaveLength(3);

			const claudeSonnet = models.find((m: Model<any>) => m.id === "claude-sonnet-4-20250514");
			expect(claudeSonnet).toBeDefined();
			expect(claudeSonnet?.name).toBe("claude-sonnet-4-20250514 (via VibeProxy)");
			expect(claudeSonnet?.provider).toBe("vibeproxy");
			expect(claudeSonnet?.api).toBe("openai-completions");
			expect(claudeSonnet?.reasoning).toBe(false);
			expect(claudeSonnet?.maxTokens).toBe(8192);

			const claudeOpus = models.find((m: Model<any>) => m.id === "claude-opus-4-20250514");
			expect(claudeOpus?.reasoning).toBe(true);
			expect(claudeOpus?.maxTokens).toBe(4096);

			const gpt5 = models.find((m: Model<any>) => m.id === "gpt-5.1-codex");
			expect(gpt5?.reasoning).toBe(false);
			expect(gpt5?.maxTokens).toBe(8192);
		});

		it("should handle thinking models correctly", () => {
			const mockModels = [
				{
					id: "claude-opus-4-5-thinking-high",
					object: "model",
				},
			];

			const models = generateVibeProxyConfig(mockModels);

			expect(models[0].reasoning).toBe(true);
		});

		it("should return fallback models when no models provided", () => {
			const models = generateVibeProxyConfig([]);

			expect(models).toHaveLength(4);
			expect(models[0].id).toBe("claude-sonnet-4-20250514");
			expect(models[1].id).toBe("claude-opus-4-20250514");
			expect(models[2].id).toBe("claude-3-5-sonnet-20250219");
			expect(models[3].id).toBe("gpt-5.1-codex");
		});

		it("should return fallback models when models is undefined", () => {
			const models = generateVibeProxyConfig(undefined as any);

			expect(models).toHaveLength(4);
		});
	});

	describe("getFallbackVibeProxyModels", () => {
		it("should return all fallback models", () => {
			const models = getFallbackVibeProxyModels();

			expect(models).toHaveLength(4);

			// Check Claude Sonnet 4
			const sonnet4 = models.find((m) => m.id === "claude-sonnet-4-20250514");
			expect(sonnet4).toBeDefined();
			expect(sonnet4?.name).toBe("Claude Sonnet 4 (via VibeProxy)");
			expect(sonnet4?.reasoning).toBe(false);
			expect(sonnet4?.maxTokens).toBe(8192);

			// Check Claude Opus 4
			const opus4 = models.find((m) => m.id === "claude-opus-4-20250514");
			expect(opus4).toBeDefined();
			expect(opus4?.reasoning).toBe(true);
			expect(opus4?.maxTokens).toBe(4096);

			// Check Claude 3.5 Sonnet
			const sonnet35 = models.find((m) => m.id === "claude-3-5-sonnet-20250219");
			expect(sonnet35).toBeDefined();
			expect(sonnet35?.reasoning).toBe(false);
			expect(sonnet35?.maxTokens).toBe(8192);

			// Check GPT 5.1 Codex
			const gpt51 = models.find((m) => m.id === "gpt-5.1-codex");
			expect(gpt51).toBeDefined();
			expect(gpt51?.reasoning).toBe(false);
			expect(gpt51?.maxTokens).toBe(8192);

			// All models should have VibeProxy-specific configuration
			for (const model of models) {
				expect(model.provider).toBe("vibeproxy");
				expect(model.api).toBe("openai-completions");
				expect(model.baseUrl).toBe("http://localhost:8318/v1");
				expect(model.input).toEqual(["text"]);
				expect(model.cost).toEqual({
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				});
			}
		});
	});
});
