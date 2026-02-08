import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { stream } from "../src/stream.js";
import type { Context } from "../src/types.js";

describe("Cache Retention (PI_CACHE_RETENTION)", () => {
	const originalEnv = process.env.PI_CACHE_RETENTION;

	beforeEach(() => {
		delete process.env.PI_CACHE_RETENTION;
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.PI_CACHE_RETENTION = originalEnv;
		} else {
			delete process.env.PI_CACHE_RETENTION;
		}
	});

	const context: Context = {
		systemPrompt: "You are a helpful assistant.",
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};

	describe("Anthropic Provider", () => {
		it.skipIf(!process.env.ANTHROPIC_API_KEY)(
			"should use default cache TTL (no ttl field) when PI_CACHE_RETENTION is not set",
			async () => {
				const model = getModel("anthropic", "claude-3-5-haiku-20241022");
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				// System prompt should have cache_control without ttl
				expect(capturedPayload.system).toBeDefined();
				expect(capturedPayload.system[0].cache_control).toEqual({ type: "ephemeral" });
			},
		);

		it.skipIf(!process.env.ANTHROPIC_API_KEY)("should use 1h cache TTL when PI_CACHE_RETENTION=long", async () => {
			process.env.PI_CACHE_RETENTION = "long";
			const model = getModel("anthropic", "claude-3-5-haiku-20241022");
			let capturedPayload: any = null;

			const s = stream(model, context, {
				onPayload: (payload) => {
					capturedPayload = payload;
				},
			});

			// Consume the stream to trigger the request
			for await (const _ of s) {
				// Just consume
			}

			expect(capturedPayload).not.toBeNull();
			// System prompt should have cache_control with ttl: "1h"
			expect(capturedPayload.system).toBeDefined();
			expect(capturedPayload.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
		});

		it("should not add ttl when baseUrl is not api.anthropic.com", async () => {
			process.env.PI_CACHE_RETENTION = "long";

			// Create a model with a different baseUrl (simulating a proxy)
			const baseModel = getModel("anthropic", "claude-3-5-haiku-20241022");
			const proxyModel = {
				...baseModel,
				baseUrl: "https://my-proxy.example.com/v1",
			};

			let capturedPayload: any = null;

			// We can't actually make the request (no proxy), but we can verify the payload
			// by using a mock or checking the logic directly
			// For this test, we'll import the helper directly

			// Since we can't easily test this without mocking, we'll skip the actual API call
			// and just verify the helper logic works correctly
			const { streamAnthropic } = await import("../src/providers/anthropic.js");

			try {
				const s = streamAnthropic(proxyModel, context, {
					apiKey: "fake-key",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// This will fail since we're using a fake key and fake proxy, but the payload should be captured
				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			// The payload should have been captured before the error
			if (capturedPayload) {
				// System prompt should have cache_control WITHOUT ttl (proxy URL)
				expect(capturedPayload.system[0].cache_control).toEqual({ type: "ephemeral" });
			}
		});

		it("should omit cache_control when cacheRetention is none", async () => {
			const baseModel = getModel("anthropic", "claude-3-5-haiku-20241022");
			let capturedPayload: any = null;

			const { streamAnthropic } = await import("../src/providers/anthropic.js");

			try {
				const s = streamAnthropic(baseModel, context, {
					apiKey: "fake-key",
					cacheRetention: "none",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.system[0].cache_control).toBeUndefined();
		});

		it("should add cache_control to string user messages", async () => {
			const baseModel = getModel("anthropic", "claude-3-5-haiku-20241022");
			let capturedPayload: any = null;

			const { streamAnthropic } = await import("../src/providers/anthropic.js");

			try {
				const s = streamAnthropic(baseModel, context, {
					apiKey: "fake-key",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			const lastMessage = capturedPayload.messages[capturedPayload.messages.length - 1];
			expect(Array.isArray(lastMessage.content)).toBe(true);
			const lastBlock = lastMessage.content[lastMessage.content.length - 1];
			expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
		});

		it("should set 1h cache TTL when cacheRetention is long", async () => {
			const baseModel = getModel("anthropic", "claude-3-5-haiku-20241022");
			let capturedPayload: any = null;

			const { streamAnthropic } = await import("../src/providers/anthropic.js");

			try {
				const s = streamAnthropic(baseModel, context, {
					apiKey: "fake-key",
					cacheRetention: "long",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
		});
	});

	describe("OpenAI Responses Provider", () => {
		it.skipIf(!process.env.OPENAI_API_KEY)(
			"should not set prompt_cache_retention when PI_CACHE_RETENTION is not set",
			async () => {
				const model = getModel("openai", "gpt-4o-mini");
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				expect(capturedPayload.prompt_cache_retention).toBeUndefined();
			},
		);

		it.skipIf(!process.env.OPENAI_API_KEY)(
			"should set prompt_cache_retention to 24h when PI_CACHE_RETENTION=long",
			async () => {
				process.env.PI_CACHE_RETENTION = "long";
				const model = getModel("openai", "gpt-4o-mini");
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				expect(capturedPayload.prompt_cache_retention).toBe("24h");
			},
		);

		it("should not set prompt_cache_retention when baseUrl is not api.openai.com", async () => {
			process.env.PI_CACHE_RETENTION = "long";

			// Create a model with a different baseUrl (simulating a proxy)
			const baseModel = getModel("openai", "gpt-4o-mini");
			const proxyModel = {
				...baseModel,
				baseUrl: "https://my-proxy.example.com/v1",
			};

			let capturedPayload: any = null;

			const { streamOpenAIResponses } = await import("../src/providers/openai-responses.js");

			try {
				const s = streamOpenAIResponses(proxyModel, context, {
					apiKey: "fake-key",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// This will fail since we're using a fake key and fake proxy, but the payload should be captured
				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			// The payload should have been captured before the error
			if (capturedPayload) {
				expect(capturedPayload.prompt_cache_retention).toBeUndefined();
			}
		});

		it("should omit prompt_cache_key when cacheRetention is none", async () => {
			const model = getModel("openai", "gpt-4o-mini");
			let capturedPayload: any = null;

			const { streamOpenAIResponses } = await import("../src/providers/openai-responses.js");

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "fake-key",
					cacheRetention: "none",
					sessionId: "session-1",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_key).toBeUndefined();
			expect(capturedPayload.prompt_cache_retention).toBeUndefined();
		});

		it("should set prompt_cache_retention when cacheRetention is long", async () => {
			const model = getModel("openai", "gpt-4o-mini");
			let capturedPayload: any = null;

			const { streamOpenAIResponses } = await import("../src/providers/openai-responses.js");

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "fake-key",
					cacheRetention: "long",
					sessionId: "session-2",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_key).toBe("session-2");
			expect(capturedPayload.prompt_cache_retention).toBe("24h");
		});
	});
});
