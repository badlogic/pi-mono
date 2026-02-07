import type { AssistantMessage } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../src/core/compaction/index.js";
import { createTestSession, userMsg } from "./utilities.js";

function createAssistantMessage(totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "assistant" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

describe("AgentSession.getContextUsage", () => {
	let cleanup: (() => void) | undefined;

	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
	});

	it("estimates from current context when no assistant exists after latest compaction", () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const olderUser = userMsg("before compaction");
		olderUser.timestamp = 1;
		const olderAssistant = createAssistantMessage(96000, 2);

		const firstKeptEntryId = sessionManager.appendMessage(olderUser);
		sessionManager.appendMessage(olderAssistant);
		sessionManager.appendCompaction("summary", firstKeptEntryId, 120000);

		const context = sessionManager.buildSessionContext();
		session.agent.replaceMessages(context.messages);

		const usage = session.getContextUsage();
		expect(usage).toBeDefined();

		const expectedTokens = context.messages.reduce((sum, message) => sum + estimateTokens(message), 0);
		expect(usage?.tokens).toBe(expectedTokens);
		expect(usage?.usageTokens).toBe(0);
		expect(usage?.trailingTokens).toBe(expectedTokens);
		expect(usage?.lastUsageIndex).toBeNull();
	});

	it("uses assistant usage from entries after latest compaction", () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const olderUser = userMsg("before compaction");
		olderUser.timestamp = 1;
		const olderAssistant = createAssistantMessage(96000, 2);
		const firstKeptEntryId = sessionManager.appendMessage(olderUser);
		sessionManager.appendMessage(olderAssistant);
		sessionManager.appendCompaction("summary", firstKeptEntryId, 120000);

		const postCompactionUser = userMsg("after compaction");
		postCompactionUser.timestamp = 3;
		sessionManager.appendMessage(postCompactionUser);
		const postCompactionAssistant = createAssistantMessage(12500, 4);
		sessionManager.appendMessage(postCompactionAssistant);
		const trailingUser = userMsg("trailing user message");
		trailingUser.timestamp = 5;
		sessionManager.appendMessage(trailingUser);

		const context = sessionManager.buildSessionContext();
		session.agent.replaceMessages(context.messages);

		const usage = session.getContextUsage();
		expect(usage).toBeDefined();

		const trailingTokens = estimateTokens(trailingUser);
		expect(usage?.usageTokens).toBe(12500);
		expect(usage?.trailingTokens).toBe(trailingTokens);
		expect(usage?.tokens).toBe(12500 + trailingTokens);
		expect(usage?.lastUsageIndex).not.toBeNull();

		if (usage?.lastUsageIndex !== null && usage?.lastUsageIndex !== undefined) {
			const lastUsageMessage = context.messages[usage.lastUsageIndex];
			expect(lastUsageMessage.role).toBe("assistant");
			expect((lastUsageMessage as AssistantMessage).timestamp).toBe(postCompactionAssistant.timestamp);
		}
	});
});
