import { describe, expect, it } from "vitest";
import { createProvider } from "../src/models.ts";
import { fauxAssistantMessage } from "../src/providers/faux.ts";
import type { Model, ProviderStreams, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { isOpenCodeEndpoint, withOpenCodeSessionHeader } from "../src/utils/headers.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] });

function testModel(baseUrl: string): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "Test model",
		api: "openai-completions",
		provider: "custom",
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

function completedStream(): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message = fauxAssistantMessage("ok");
	stream.push({ type: "start", partial: message });
	stream.push({ type: "done", reason: "stop", message });
	stream.end(message);
	return stream;
}

function capturingProvider(capture: (options: StreamOptions | undefined) => void) {
	const streams: ProviderStreams = {
		stream: (_model, _context, options) => {
			capture(options);
			return completedStream();
		},
		streamSimple: (_model, _context, options) => {
			capture(options);
			return completedStream();
		},
	};
	return createProvider<"openai-completions">({
		id: "custom",
		auth: { apiKey: { name: "Test", resolve: async () => ({ auth: {} }) } },
		models: [],
		api: { "openai-completions": streams },
	});
}

describe("isOpenCodeEndpoint", () => {
	it.each([
		["https://opencode.ai/zen/v1", true],
		["https://opencode.ai/zen/go/v1", true],
		["https://api.openai.com/v1", false],
		["https://notopencode.ai/v1", false],
		["not a url", false],
		[undefined, false],
	] as const)("classifies %s", (baseUrl, expected) => {
		expect(isOpenCodeEndpoint(baseUrl)).toBe(expected);
	});
});

describe("withOpenCodeSessionHeader", () => {
	it("adds the session header when absent", () => {
		expect(withOpenCodeSessionHeader(undefined, "conversation-1")).toEqual({
			"x-opencode-session": "conversation-1",
		});
	});

	it.each([
		{ headers: { "X-OpenCode-Session": "caller-value" }, expected: { "X-OpenCode-Session": "caller-value" } },
		{ headers: { "X-OpenCode-Session": null }, expected: { "X-OpenCode-Session": null } },
	] as const)("preserves a case-insensitive caller override", ({ headers, expected }) => {
		expect(withOpenCodeSessionHeader(headers, "generated-value")).toEqual(expected);
	});

	it("does not fabricate a session header when sessionId is absent", () => {
		expect(withOpenCodeSessionHeader({ "x-custom": "value" }, undefined)).toEqual({ "x-custom": "value" });
	});
});

describe("OpenCode session header injection", () => {
	// Regression test for https://github.com/earendil-works/pi/issues/9326
	// The header is keyed off the endpoint, not the provider id, so a custom
	// route pointed at OpenCode gets it too.
	it("injects the header for stream requests to an OpenCode endpoint", () => {
		let captured: StreamOptions | undefined;
		const provider = capturingProvider((options) => {
			captured = options;
		});

		provider.stream(testModel("https://opencode.ai/zen/go/v1"), context, {
			sessionId: "conversation-1",
			cacheRetention: "none",
		});

		expect(captured?.headers).toEqual({ "x-opencode-session": "conversation-1" });
	});

	it("injects the header for streamSimple requests even without cache retention", () => {
		let captured: StreamOptions | undefined;
		const provider = capturingProvider((options) => {
			captured = options;
		});

		provider.streamSimple(testModel("https://opencode.ai/zen/go/v1"), context, {
			sessionId: "conversation-1",
			cacheRetention: "none",
		});

		expect(captured?.headers).toEqual({ "x-opencode-session": "conversation-1" });
	});

	it("leaves requests to other endpoints untouched", () => {
		let captured: StreamOptions | undefined;
		const provider = capturingProvider((options) => {
			captured = options;
		});

		provider.streamSimple(testModel("https://api.example.com/v1"), context, { sessionId: "conversation-1" });

		expect(captured?.headers).toBeUndefined();
	});

	it("keeps a caller-provided session header", () => {
		let captured: StreamOptions | undefined;
		const provider = capturingProvider((options) => {
			captured = options;
		});

		provider.streamSimple(testModel("https://opencode.ai/zen/v1"), context, {
			sessionId: "generated-value",
			headers: { "X-OpenCode-Session": "caller-value" },
		});

		expect(captured?.headers).toEqual({ "X-OpenCode-Session": "caller-value" });
	});
});
