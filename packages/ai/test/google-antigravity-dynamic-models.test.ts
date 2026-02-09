import { afterEach, describe, expect, it, vi } from "vitest";
import { getAntigravityHeaders } from "../src/utils/antigravity-headers.js";
import { createAntigravityModel, fetchAvailableModels } from "../src/utils/oauth/google-antigravity.js";

const originalFetch = global.fetch;
const originalAntigravityVersion = process.env.PI_AI_ANTIGRAVITY_VERSION;

afterEach(() => {
	global.fetch = originalFetch;
	if (originalAntigravityVersion === undefined) {
		delete process.env.PI_AI_ANTIGRAVITY_VERSION;
	} else {
		process.env.PI_AI_ANTIGRAVITY_VERSION = originalAntigravityVersion;
	}
	vi.restoreAllMocks();
});

describe("antigravity headers", () => {
	it("uses env override for antigravity version", () => {
		process.env.PI_AI_ANTIGRAVITY_VERSION = "9.9.9";
		const headers = getAntigravityHeaders();
		expect(headers["User-Agent"]).toBe("antigravity/9.9.9 darwin/arm64");
		expect(headers["X-Goog-Api-Client"]).toBe("google-cloud-sdk vscode_cloudshelleditor/0.1");
		expect(headers["Client-Metadata"]).toContain("pluginType");
	});
});

describe("fetchAvailableModels", () => {
	it("sends required headers and parses model payload", async () => {
		process.env.PI_AI_ANTIGRAVITY_VERSION = "2.0.0";
		const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer access-token");
			expect(headers.get("Content-Type")).toBe("application/json");
			expect(headers.get("User-Agent")).toBe("antigravity/2.0.0 darwin/arm64");
			expect(headers.get("X-Goog-Api-Client")).toBe("google-cloud-sdk vscode_cloudshelleditor/0.1");
			return new Response(
				JSON.stringify({
					models: [
						{
							id: "models/gemini-3-flash",
							displayName: "Gemini 3 Flash",
							supportsThinking: true,
							supportsImages: true,
							maxTokens: 1000,
							maxOutputTokens: 200,
						},
						{
							modelId: "claude-sonnet-4-5",
							name: "Claude Sonnet 4.5",
							provider: "anthropic",
							supportsThinking: true,
						},
						{
							model: "gpt-oss-120b-medium",
							provider: "openai",
						},
						{
							id: "models/gemini-3-flash",
							displayName: "Gemini 3 Flash Duplicate",
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		global.fetch = fetchMock as typeof fetch;

		const models = await fetchAvailableModels("access-token");
		expect(models.map((m) => m.id)).toEqual(["gemini-3-flash", "claude-sonnet-4-5", "gpt-oss-120b-medium"]);
		expect(models[0]?.displayName).toBe("Gemini 3 Flash Duplicate");
		expect(models[0]?.supportsImages).toBe(false);
		expect(models[1]?.provider).toBe("anthropic");
	});

	it("throws a clear error when fetchAvailableModels fails", async () => {
		const fetchMock = vi.fn(async () => new Response("denied", { status: 403 }));
		global.fetch = fetchMock as typeof fetch;

		await expect(fetchAvailableModels("access-token")).rejects.toThrow(
			"Failed to fetch Antigravity models (403): denied",
		);
	});
});

describe("createAntigravityModel", () => {
	it("maps provider-specific model properties", () => {
		const model = createAntigravityModel({
			id: "claude-sonnet-4-5",
			displayName: "Claude Sonnet 4.5",
			provider: "anthropic",
			supportsThinking: true,
			supportsImages: false,
			maxTokens: 555,
			maxOutputTokens: 111,
		});

		expect(model.provider).toBe("google-antigravity");
		expect(model.api).toBe("google-gemini-cli");
		expect(model.input).toEqual(["text"]);
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(555);
		expect(model.maxTokens).toBe(111);
		expect(model.cost.input).toBe(3);
		expect(model.cost.output).toBe(15);
	});
});
