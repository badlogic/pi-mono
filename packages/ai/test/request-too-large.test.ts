/**
 * Test isRequestTooLarge detection for HTTP 413 / payload size errors.
 *
 * This is separate from context overflow (token limits). Request size limits
 * are about raw HTTP payload bytes, typically caused by accumulated image data.
 */

import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.js";
import { isContextOverflow, isRequestTooLarge } from "../src/utils/overflow.js";

function makeErrorMessage(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

function makeSuccessMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "Hello" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4",
		usage: {
			input: 1000,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 1050,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("isRequestTooLarge", () => {
	it("should detect Anthropic SDK 413 with request_too_large", () => {
		const msg = makeErrorMessage(
			'413 {"type":"error","error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
		);
		expect(isRequestTooLarge(msg)).toBe(true);
	});

	it("should detect plain 413 status", () => {
		const msg = makeErrorMessage("413 Request Entity Too Large");
		expect(isRequestTooLarge(msg)).toBe(true);
	});

	it("should detect request_too_large error type", () => {
		const msg = makeErrorMessage("request_too_large: Request exceeds the maximum size");
		expect(isRequestTooLarge(msg)).toBe(true);
	});

	it("should detect generic payload too large", () => {
		const msg = makeErrorMessage("Payload too large");
		expect(isRequestTooLarge(msg)).toBe(true);
	});

	it("should detect request entity too large", () => {
		const msg = makeErrorMessage("Request entity too large");
		expect(isRequestTooLarge(msg)).toBe(true);
	});

	it("should NOT detect Cerebras 413 with no body (that is context overflow)", () => {
		const msg = makeErrorMessage("413 (no body)");
		expect(isRequestTooLarge(msg)).toBe(false);
		// Verify it IS detected as context overflow instead
		expect(isContextOverflow(msg)).toBe(true);
	});

	it("should NOT detect Cerebras 413 status code (no body)", () => {
		const msg = makeErrorMessage("413 status code (no body)");
		expect(isRequestTooLarge(msg)).toBe(false);
		expect(isContextOverflow(msg)).toBe(true);
	});

	it("should NOT detect 413 with no body even if it matches generic patterns", () => {
		const msg = makeErrorMessage("413 Request Entity Too Large (no body)");
		expect(isRequestTooLarge(msg)).toBe(false);
	});

	it("should NOT detect context overflow errors", () => {
		const msg = makeErrorMessage("prompt is too long: 213462 tokens > 200000 maximum");
		expect(isRequestTooLarge(msg)).toBe(false);
	});

	it("should NOT detect rate limit errors", () => {
		const msg = makeErrorMessage("429 Too Many Requests");
		expect(isRequestTooLarge(msg)).toBe(false);
	});

	it("should NOT detect successful messages", () => {
		const msg = makeSuccessMessage();
		expect(isRequestTooLarge(msg)).toBe(false);
	});

	it("should NOT detect non-error messages with stopReason stop", () => {
		const msg = makeSuccessMessage();
		msg.stopReason = "stop";
		expect(isRequestTooLarge(msg)).toBe(false);
	});

	it("should NOT detect error messages without errorMessage", () => {
		const msg = makeSuccessMessage();
		msg.stopReason = "error";
		msg.errorMessage = undefined;
		expect(isRequestTooLarge(msg)).toBe(false);
	});
});
