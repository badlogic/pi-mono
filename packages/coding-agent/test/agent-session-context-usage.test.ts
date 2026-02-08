import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../src/core/compaction/index.js";
import { createTestSession, userMsg } from "./utilities.js";

interface AssistantMessageOptions {
	api?: AssistantMessage["api"];
	provider?: AssistantMessage["provider"];
	model?: AssistantMessage["model"];
	stopReason?: AssistantMessage["stopReason"];
	errorMessage?: AssistantMessage["errorMessage"];
	usage?: Usage;
	text?: string;
}

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

function createAssistantMessage(
	totalTokens: number,
	timestamp: number,
	options: AssistantMessageOptions = {},
): AssistantMessage {
	const stopReason = options.stopReason ?? "stop";

	return {
		role: "assistant",
		content: [{ type: "text", text: options.text ?? "assistant" }],
		api: options.api ?? "anthropic-messages",
		provider: options.provider ?? "anthropic",
		model: options.model ?? "claude-sonnet-4-5",
		usage: options.usage ?? createUsage(totalTokens),
		stopReason,
		errorMessage: options.errorMessage ?? (stopReason === "error" ? "error" : undefined),
		timestamp,
	};
}

function estimateAll(messages: AgentMessage[]): number {
	return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function cloneMessages(messages: AgentMessage[]): AgentMessage[] {
	return JSON.parse(JSON.stringify(messages)) as AgentMessage[];
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

		const expectedTokens = estimateAll(context.messages);
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
	});

	it("falls back to heuristic when post-compaction assistant usage is zero", () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const beforeUser = userMsg("before compaction");
		beforeUser.timestamp = 1;
		const beforeAssistant = createAssistantMessage(96000, 2);
		const firstKeptEntryId = sessionManager.appendMessage(beforeUser);
		sessionManager.appendMessage(beforeAssistant);
		sessionManager.appendCompaction("summary", firstKeptEntryId, 120000);

		const afterUser = userMsg("after compaction");
		afterUser.timestamp = 3;
		sessionManager.appendMessage(afterUser);
		const zeroUsageAssistant = createAssistantMessage(0, 4, { usage: createUsage(0) });
		sessionManager.appendMessage(zeroUsageAssistant);

		const context = sessionManager.buildSessionContext();
		session.agent.replaceMessages(context.messages);

		const usage = session.getContextUsage();
		expect(usage).toBeDefined();

		const expectedTokens = estimateAll(context.messages);
		expect(usage?.tokens).toBe(expectedTokens);
		expect(usage?.usageTokens).toBe(0);
		expect(usage?.trailingTokens).toBe(expectedTokens);
		expect(usage?.lastUsageIndex).toBeNull();
	});

	it("falls back to heuristic when post-compaction assistant model differs from active model", () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const beforeUser = userMsg("before compaction");
		beforeUser.timestamp = 1;
		const beforeAssistant = createAssistantMessage(96000, 2);
		const firstKeptEntryId = sessionManager.appendMessage(beforeUser);
		sessionManager.appendMessage(beforeAssistant);
		sessionManager.appendCompaction("summary", firstKeptEntryId, 120000);

		const switchedAssistant = createAssistantMessage(14000, 3, {
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5",
		});
		sessionManager.appendMessage(switchedAssistant);

		const context = sessionManager.buildSessionContext();
		session.agent.replaceMessages(context.messages);

		const usage = session.getContextUsage();
		expect(usage).toBeDefined();

		const expectedTokens = estimateAll(context.messages);
		expect(usage?.tokens).toBe(expectedTokens);
		expect(usage?.usageTokens).toBe(0);
		expect(usage?.trailingTokens).toBe(expectedTokens);
		expect(usage?.lastUsageIndex).toBeNull();
	});

	it("falls back to heuristic when only aborted/error assistants exist after compaction", () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const beforeUser = userMsg("before compaction");
		beforeUser.timestamp = 1;
		const beforeAssistant = createAssistantMessage(96000, 2);
		const firstKeptEntryId = sessionManager.appendMessage(beforeUser);
		sessionManager.appendMessage(beforeAssistant);
		sessionManager.appendCompaction("summary", firstKeptEntryId, 120000);

		const abortedAssistant = createAssistantMessage(9000, 3, { stopReason: "aborted" });
		sessionManager.appendMessage(abortedAssistant);
		const errorAssistant = createAssistantMessage(10000, 4, {
			stopReason: "error",
			errorMessage: "prompt is too long: 100000 tokens > 200000 maximum",
		});
		sessionManager.appendMessage(errorAssistant);

		const context = sessionManager.buildSessionContext();
		session.agent.replaceMessages(context.messages);

		const usage = session.getContextUsage();
		expect(usage).toBeDefined();

		const expectedTokens = estimateAll(context.messages);
		expect(usage?.tokens).toBe(expectedTokens);
		expect(usage?.usageTokens).toBe(0);
		expect(usage?.trailingTokens).toBe(expectedTokens);
		expect(usage?.lastUsageIndex).toBeNull();
	});

	it("uses latest compaction boundary when multiple compactions exist", () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const beforeUser = userMsg("before first compaction");
		beforeUser.timestamp = 1;
		const beforeAssistant = createAssistantMessage(96000, 2);
		const firstKeptEntryId = sessionManager.appendMessage(beforeUser);
		sessionManager.appendMessage(beforeAssistant);
		sessionManager.appendCompaction("first summary", firstKeptEntryId, 120000);

		const betweenUser = userMsg("between compactions");
		betweenUser.timestamp = 3;
		sessionManager.appendMessage(betweenUser);
		const betweenAssistant = createAssistantMessage(12500, 4);
		const betweenAssistantEntryId = sessionManager.appendMessage(betweenAssistant);

		sessionManager.appendCompaction("second summary", betweenAssistantEntryId, 50000);

		const trailingUser = userMsg("after latest compaction");
		trailingUser.timestamp = 5;
		sessionManager.appendMessage(trailingUser);

		const context = sessionManager.buildSessionContext();
		session.agent.replaceMessages(context.messages);

		const usage = session.getContextUsage();
		expect(usage).toBeDefined();

		const expectedTokens = estimateAll(context.messages);
		expect(usage?.tokens).toBe(expectedTokens);
		expect(usage?.usageTokens).toBe(0);
		expect(usage?.trailingTokens).toBe(expectedTokens);
		expect(usage?.lastUsageIndex).toBeNull();
	});

	it("uses robust assistant matching when identity differs", () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const beforeUser = userMsg("before compaction");
		beforeUser.timestamp = 1;
		const beforeAssistant = createAssistantMessage(96000, 2);
		const firstKeptEntryId = sessionManager.appendMessage(beforeUser);
		sessionManager.appendMessage(beforeAssistant);
		sessionManager.appendCompaction("summary", firstKeptEntryId, 120000);

		const postCompactionUser = userMsg("after compaction");
		postCompactionUser.timestamp = 3;
		sessionManager.appendMessage(postCompactionUser);
		const trustedAssistant = createAssistantMessage(8000, 4, { text: "trusted assistant" });
		sessionManager.appendMessage(trustedAssistant);
		const trailingUser = userMsg("trailing user message");
		trailingUser.timestamp = 5;
		sessionManager.appendMessage(trailingUser);

		const context = sessionManager.buildSessionContext();
		const clonedMessages = cloneMessages(context.messages);
		const syntheticAssistant = createAssistantMessage(50, 4, {
			api: "openai-responses",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			text: "synthetic assistant",
		});
		clonedMessages.push(syntheticAssistant);
		session.agent.replaceMessages(clonedMessages);

		const usage = session.getContextUsage();
		expect(usage).toBeDefined();

		const trailingTokens = estimateTokens(trailingUser) + estimateTokens(syntheticAssistant);
		expect(usage?.usageTokens).toBe(8000);
		expect(usage?.trailingTokens).toBe(trailingTokens);
		expect(usage?.tokens).toBe(8000 + trailingTokens);

		expect(usage?.lastUsageIndex).not.toBeNull();
		if (usage?.lastUsageIndex !== null && usage?.lastUsageIndex !== undefined) {
			const matchedMessage = session.messages[usage.lastUsageIndex];
			expect(matchedMessage.role).toBe("assistant");
			if (matchedMessage.role === "assistant") {
				expect(matchedMessage.api).toBe("anthropic-messages");
				expect(matchedMessage.usage.input).toBe(8000);
			}
		}
	});
});
