import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stream as streamCompletions, streamSimple as streamSimpleCompletions } from "../src/api/openai-completions.ts";
import { createModels, createProvider } from "../src/models.ts";
import type { FetchFunction, Model, ProviderHeaders } from "../src/types.ts";
import {
	type ClientIdentity,
	formatUserAgent,
	getAttributionHeaders,
	getIdentityHeaders,
	mergeClientIdentity,
	withClientIdentity,
} from "../src/utils/identity.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { PI_AI_VERSION } from "../src/utils/version.ts";

const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;

function target(provider: string, baseUrl: string) {
	return { provider, baseUrl };
}

function completionsModel(provider: string, baseUrl: string, headers?: Record<string, string>) {
	return {
		id: "test-model",
		name: "Test Model",
		api: "openai-completions",
		provider,
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...(headers ? { headers } : {}),
	} satisfies Model<"openai-completions">;
}

function capturingFetch(): { fetch: FetchFunction; headers: () => Headers } {
	let captured: Headers | undefined;
	const fetch: FetchFunction = async (input, init) => {
		captured = new Request(input, init).headers;
		const chunks = [
			{ id: "chatcmpl-identity", choices: [{ delta: { content: "ok" }, finish_reason: null, index: 0 }] },
			{
				id: "chatcmpl-identity",
				choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			},
		];
		const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
	};
	return {
		fetch,
		headers: () => {
			if (!captured) throw new Error("no request was sent");
			return captured;
		},
	};
}

const context = normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] });

describe("client identity", () => {
	it("keeps the version constant in sync with package.json", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
		expect(PI_AI_VERSION).toBe(pkg.version);
	});

	it("formats user agents", () => {
		expect(formatUserAgent()).toBe(`pi/${PI_AI_VERSION} (${process.platform}; ${runtime}; ${process.arch})`);
		expect(formatUserAgent({ version: "9.9.9" })).toBe(`pi/9.9.9 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(formatUserAgent({ userAgent: "short", version: "9.9.9" })).toBe("pi");
		expect(formatUserAgent({ userAgent: { custom: "acme/1.0" } })).toBe("acme/1.0");
	});

	it("merges identities field by field", () => {
		expect(mergeClientIdentity(undefined, undefined)).toBeUndefined();
		expect(
			mergeClientIdentity({ attribution: true, userAgent: "short" }, { attribution: undefined, version: "1.0.0" }),
		).toEqual({ attribution: true, userAgent: "short", version: "1.0.0" });
		expect(mergeClientIdentity({ attribution: true }, { attribution: false })).toEqual({ attribution: false });
	});

	it("sends no attribution unless enabled", () => {
		const openRouter = target("openrouter", "https://openrouter.ai/api/v1");
		expect(getAttributionHeaders(openRouter)).toEqual({});
		expect(getAttributionHeaders(openRouter, { attribution: false })).toEqual({});
		expect(getIdentityHeaders(openRouter)).toEqual({ "User-Agent": formatUserAgent() });
	});

	it("attributes OpenRouter requests", () => {
		const openRouter = target("openrouter", "https://openrouter.ai/api/v1");
		expect(getAttributionHeaders(openRouter, { attribution: true })).toEqual({
			"HTTP-Referer": "https://pi.dev",
			"X-OpenRouter-Title": "pi",
		});
		expect(getAttributionHeaders(openRouter, { attribution: { categories: "cli-agent" } })).toEqual({
			"HTTP-Referer": "https://pi.dev",
			"X-OpenRouter-Title": "pi",
			"X-OpenRouter-Categories": "cli-agent",
		});
		expect(getAttributionHeaders(openRouter, { attribution: "acme" })).toEqual({ "X-OpenRouter-Title": "acme" });
		expect(
			getAttributionHeaders(openRouter, {
				attribution: { name: "acme", url: "https://acme.example", categories: "cloud-agent" },
			}),
		).toEqual({
			"HTTP-Referer": "https://acme.example",
			"X-OpenRouter-Title": "acme",
			"X-OpenRouter-Categories": "cloud-agent",
		});
		// Custom providers routed through OpenRouter, including legacy base URLs that are not valid URLs.
		expect(getAttributionHeaders(target("custom", "not-a-url-openrouter.ai"), { attribution: true })).toMatchObject({
			"X-OpenRouter-Title": "pi",
		});
	});

	it("attributes NVIDIA NIM and OpenCode requests with their expected spellings", () => {
		expect(getAttributionHeaders(target("nvidia", "https://example.test/v1"), { attribution: true })).toEqual({
			"X-BILLING-INVOKE-ORIGIN": "Pi",
		});
		expect(
			getAttributionHeaders(target("custom-nim", "https://integrate.api.nvidia.com/v1"), { attribution: "acme" }),
		).toEqual({ "X-BILLING-INVOKE-ORIGIN": "acme" });
		expect(getAttributionHeaders(target("opencode", "https://opencode.ai/zen/v1"), { attribution: true })).toEqual({
			"x-opencode-client": "pi",
		});
		expect(getAttributionHeaders(target("custom", "https://opencode.ai/zen/v1"), { attribution: "acme" })).toEqual({
			"x-opencode-client": "acme",
		});
	});

	it("does not attribute NVIDIA models routed through gateways to NVIDIA", () => {
		expect(
			getAttributionHeaders(target("openrouter", "https://openrouter.ai/api/v1"), { attribution: true }),
		).not.toHaveProperty("X-BILLING-INVOKE-ORIGIN");
		expect(
			getAttributionHeaders(target("vercel-ai-gateway", "https://ai-gateway.vercel.sh/v1"), { attribution: true }),
		).toEqual({});
	});
});

describe("client identity in requests", () => {
	it("applies the identity below model and request headers", async () => {
		const capture = capturingFetch();
		const model = completionsModel("openrouter", "https://openrouter.ai/api/v1", {
			"X-OpenRouter-Title": "model-title",
		});
		await streamCompletions(model, context, {
			apiKey: "key",
			fetch: capture.fetch,
			identity: { attribution: true, userAgent: "short" },
			headers: { "HTTP-Referer": null } as ProviderHeaders,
		}).result();

		const headers = capture.headers();
		expect(headers.get("user-agent")).toBe("pi");
		expect(headers.get("x-openrouter-title")).toBe("model-title");
		expect(headers.has("http-referer")).toBe(false);
	});

	it("keeps impersonating model headers over the identity User-Agent", async () => {
		const capture = capturingFetch();
		const model = completionsModel("github-copilot", "https://api.githubcopilot.com", {
			"User-Agent": "GitHubCopilotChat/0.35.0",
		});
		await streamCompletions(model, context, {
			apiKey: "key",
			fetch: capture.fetch,
			identity: { userAgent: { custom: "acme" } },
		}).result();

		expect(capture.headers().get("user-agent")).toBe("GitHubCopilotChat/0.35.0");
	});

	it("merges request identity over the Models and wrapper identities", async () => {
		const model = completionsModel("openrouter", "https://openrouter.ai/api/v1");
		const models = createModels({ identity: { attribution: "models", userAgent: "short" } });
		models.setProvider(
			createProvider({
				id: "openrouter",
				auth: { apiKey: { name: "Test", resolve: async () => ({ auth: { apiKey: "key" } }) } },
				models: [model],
				api: { stream: streamCompletions, streamSimple: streamSimpleCompletions },
			}),
		);
		const send = async (target: typeof models, identity?: ClientIdentity) => {
			const capture = capturingFetch();
			await target.streamSimple(model, context, { fetch: capture.fetch, identity }).result();
			return capture.headers();
		};

		const fromModels = await send(models);
		expect(fromModels.get("user-agent")).toBe("pi");
		expect(fromModels.get("x-openrouter-title")).toBe("models");

		const wrapped = withClientIdentity(models, { attribution: "wrapper" });
		const fromWrapper = await send(wrapped);
		expect(fromWrapper.get("user-agent")).toBe("pi");
		expect(fromWrapper.get("x-openrouter-title")).toBe("wrapper");
		expect(wrapped.getModel("openrouter", "test-model")).toBe(model);

		const fromRequest = await send(wrapped, { attribution: false });
		expect(fromRequest.has("x-openrouter-title")).toBe(false);
		expect(fromRequest.get("user-agent")).toBe("pi");
	});
});
