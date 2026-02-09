import type { Model } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { listModels } from "../src/cli/list-models.js";

const dynamicAntigravityModels: Model<"google-gemini-cli">[] = [
	{
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		api: "google-gemini-cli",
		provider: "google-antigravity",
		baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "gemini-3-flash",
		name: "Gemini 3 Flash",
		api: "google-gemini-cli",
		provider: "google-antigravity",
		baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.25, output: 5, cacheRead: 0.125, cacheWrite: 1.25 },
		contextWindow: 1000000,
		maxTokens: 65536,
	},
];

afterEach(() => {
	vi.restoreAllMocks();
});

describe("listModels", () => {
	test("prints dynamic antigravity models", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const registry = {
			getAvailable: () => dynamicAntigravityModels,
		} as unknown as Parameters<typeof listModels>[0];

		await listModels(registry);

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("provider");
		expect(output).toContain("google-antigravity");
		expect(output).toContain("claude-sonnet-4-5");
		expect(output).toContain("gemini-3-flash");
	});

	test("filters dynamic antigravity models by search pattern", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const registry = {
			getAvailable: () => dynamicAntigravityModels,
		} as unknown as Parameters<typeof listModels>[0];

		await listModels(registry, "claude-sonnet");

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("claude-sonnet-4-5");
		expect(output).not.toContain("gemini-3-flash");
	});

	test("prints empty message when no models are available", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const registry = {
			getAvailable: () => [],
		} as unknown as Parameters<typeof listModels>[0];

		await listModels(registry);

		expect(logSpy).toHaveBeenCalledWith("No models available. Set API keys in environment variables.");
	});
});
