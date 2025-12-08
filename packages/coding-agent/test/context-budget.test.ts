import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
	estimateToolResultTokens,
	getLastAssistantUsageFromMessages,
	shouldTriggerCompactionAfterTurn,
} from "../src/context-budget.js";

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

describe("context-budget: estimateToolResultTokens", () => {
	it("counts plain string results", () => {
		const text = "abcd".repeat(10); // 40 chars
		const tokens = estimateToolResultTokens(text);
		expect(tokens).toBe(10); // ceil(40/4)
	});

	it("counts text blocks in content arrays and ignores images", () => {
		const result = {
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", data: "xxx", mimeType: "image/png" },
				{ type: "text", text: "world" },
			],
			details: { diff: "ignored" },
		};

		const totalChars = "hello".length + "world".length;
		const tokens = estimateToolResultTokens(result);
		expect(tokens).toBe(Math.ceil(totalChars / 4));
	});

	it("returns zero for empty or non-text results", () => {
		expect(estimateToolResultTokens(undefined)).toBe(0);
		expect(estimateToolResultTokens({})).toBe(0);
	});
});

describe("context-budget: getLastAssistantUsageFromMessages", () => {
	it("returns usage from last non-aborted assistant", () => {
		const now = Date.now();
		const messages: AppMessage[] = [
			{ role: "user", content: "hi", timestamp: now },
			{
				role: "assistant",
				content: [{ type: "text", text: "first" }],
				usage: createUsage(100),
				stopReason: "stop",
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude",
				timestamp: now,
			} as AssistantMessage,
			{
				role: "assistant",
				content: [{ type: "text", text: "second" }],
				usage: createUsage(200),
				stopReason: "aborted",
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude",
				timestamp: now,
			} as AssistantMessage,
		];

		const usage = getLastAssistantUsageFromMessages(messages);
		expect(usage).not.toBeNull();
		expect(usage!.totalTokens).toBe(100);
	});

	it("returns null when no assistant messages", () => {
		const messages: AppMessage[] = [{ role: "user", content: "only user", timestamp: Date.now() }];
		expect(getLastAssistantUsageFromMessages(messages)).toBeNull();
	});
});

describe("context-budget: shouldTriggerCompactionAfterTurn", () => {
	it("returns true when projected usage exceeds threshold", () => {
		const usage = createUsage(90_000);
		const result = shouldTriggerCompactionAfterTurn({
			lastUsage: usage,
			estimatedAddedTokens: 15_000,
			contextWindow: 100_000,
			reserveTokens: 10_000,
			enabled: true,
		});
		// threshold = 90k, projected = 105k
		expect(result).toBe(true);
	});

	it("returns false when under threshold or disabled", () => {
		const usage = createUsage(50_000);
		const baseParams = {
			lastUsage: usage,
			estimatedAddedTokens: 10_000,
			contextWindow: 100_000,
			reserveTokens: 10_000,
			enabled: true,
		} as const;

		// 50k + 10k = 60k, threshold = 90k
		expect(shouldTriggerCompactionAfterTurn(baseParams)).toBe(false);

		// Disabled
		expect(
			shouldTriggerCompactionAfterTurn({
				...baseParams,
				enabled: false,
			}),
		).toBe(false);

		// No last usage
		expect(
			shouldTriggerCompactionAfterTurn({
				...baseParams,
				lastUsage: null,
			}),
		).toBe(false);
	});
});
