import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { streamSimpleAnthropic } from "../src/providers/anthropic.js";
import type { Context } from "../src/types.js";

interface CapturedAnthropicPayload {
	thinking?: {
		type?: string;
		budget_tokens?: number;
	};
}

describe("Anthropic simple reasoning off", () => {
	const context: Context = {
		messages: [{ role: "user", content: "Say hi", timestamp: Date.now() }],
	};

	it("omits thinking payload when reasoning is off", async () => {
		const base = getModel("anthropic", "claude-3-7-sonnet-20250219");
		const model = { ...base, baseUrl: "http://127.0.0.1:9" };
		let capturedPayload: CapturedAnthropicPayload | null = null;

		const s = streamSimpleAnthropic(model, context, {
			apiKey: "fake-key",
			reasoning: "off" as never,
			onPayload: (payload) => {
				capturedPayload = payload as CapturedAnthropicPayload;
			},
		});

		for await (const event of s) {
			if (event.type === "error") break;
		}

		expect(capturedPayload).toBeTruthy();
		if (!capturedPayload) {
			throw new Error("Expected Anthropic payload to be captured");
		}
		const payload = capturedPayload as CapturedAnthropicPayload;
		expect(payload.thinking).toBeUndefined();
	});

	it("enables thinking payload for non-off reasoning levels", async () => {
		const base = getModel("anthropic", "claude-3-7-sonnet-20250219");
		const model = { ...base, baseUrl: "http://127.0.0.1:9" };
		let capturedPayload: CapturedAnthropicPayload | null = null;

		const s = streamSimpleAnthropic(model, context, {
			apiKey: "fake-key",
			reasoning: "medium",
			onPayload: (payload) => {
				capturedPayload = payload as CapturedAnthropicPayload;
			},
		});

		for await (const event of s) {
			if (event.type === "error") break;
		}

		expect(capturedPayload).toBeTruthy();
		if (!capturedPayload) {
			throw new Error("Expected Anthropic payload to be captured");
		}
		const payload = capturedPayload as CapturedAnthropicPayload;
		expect(payload.thinking?.type).toBe("enabled");
		expect(payload.thinking?.budget_tokens).toBeGreaterThan(0);
	});
});
