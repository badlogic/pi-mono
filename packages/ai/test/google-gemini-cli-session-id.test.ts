import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildRequest } from "../src/providers/google-gemini-cli.js";
import type { Context, Model } from "../src/types.js";

const model: Model<"google-gemini-cli"> = {
	id: "gemini-2.5-flash",
	name: "Gemini 2.5 Flash",
	api: "google-gemini-cli",
	provider: "google-gemini-cli",
	baseUrl: "https://cloudcode-pa.googleapis.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
};

describe("buildRequest sessionId", () => {
	it("derives sessionId from the first user message", () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "First message", timestamp: Date.now() },
				{ role: "user", content: "Second message", timestamp: Date.now() },
			],
		};

		const result = buildRequest(model, context, "project-id");
		const expected = createHash("sha256").update("First message").digest("hex").slice(0, 32);

		expect(result.request.sessionId).toBe(expected);
	});

	it("omits sessionId when the first user message has no text", () => {
		const context: Context = {
			messages: [
				{
					role: "user",
					content: [{ type: "image", data: "Zm9v", mimeType: "image/png" }],
					timestamp: Date.now(),
				},
				{ role: "user", content: "Later text", timestamp: Date.now() },
			],
		};

		const result = buildRequest(model, context, "project-id");

		expect(result.request.sessionId).toBeUndefined();
	});
});
