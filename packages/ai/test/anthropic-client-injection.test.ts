import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import type { Context } from "../src/types.js";

describe("Anthropic client injection", () => {
	const model = getModel("anthropic", "claude-sonnet-4-6");
	const context: Context = {
		systemPrompt: "Test",
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};

	it("should use injected client and set isOAuth to false", async () => {
		const { streamAnthropic } = await import("../src/providers/anthropic.js");

		let capturedPayload: any = null;
		const messagesStreamCalled = { value: false };

		// Minimal mock: just enough to verify the injected client is used
		const mockClient = {
			messages: {
				stream: () => {
					messagesStreamCalled.value = true;
					// Return async iterable that yields a stop event
					const events = [
						{ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } },
						{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} },
					];
					return {
						[Symbol.asyncIterator]: async function* () {
							yield* events;
						},
					};
				},
			},
		};

		const s = streamAnthropic(model, context, {
			client: mockClient as any,
			onPayload: (payload) => {
				capturedPayload = payload;
			},
		});

		for await (const _event of s) {
			// consume
		}

		expect(messagesStreamCalled.value).toBe(true);
		expect(capturedPayload).not.toBeNull();
		// isOAuth=false means no Claude Code system prompt identity is prepended
		expect(capturedPayload.system).toHaveLength(1);
		expect(capturedPayload.system[0].text).toBe("Test");
	});
});
