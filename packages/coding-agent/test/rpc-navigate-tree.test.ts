/**
 * Unit tests for AgentSession.navigateTree().
 *
 * Tests basic navigation without summarization (no API key needed).
 * Uses createTestSession with in-memory SessionManager.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assistantMsg, createTestSession, type TestSessionContext, userMsg } from "./utilities.js";

/** Sync agent state with session manager so navigateTree sees the full tree. */
function syncAgentState(ctx: TestSessionContext): void {
	const context = ctx.sessionManager.buildSessionContext();
	ctx.session.agent.replaceMessages(context.messages);
}

describe("navigate_tree", () => {
	let ctx: TestSessionContext;

	beforeEach(() => {
		ctx = createTestSession({ inMemory: true });
	});

	afterEach(() => {
		ctx.cleanup();
	});

	test("navigating to user message returns editorText and changes leaf", async () => {
		const { session, sessionManager } = ctx;

		// Build: u1 -> a1 -> u2 -> a2
		sessionManager.appendMessage(userMsg("First message"));
		sessionManager.appendMessage(assistantMsg("Response 1"));
		const u2Id = sessionManager.appendMessage(userMsg("Second message"));
		sessionManager.appendMessage(assistantMsg("Response 2"));
		syncAgentState(ctx);

		const leafBefore = sessionManager.getLeafId();
		const result = await session.navigateTree(u2Id, { summarize: false });

		expect(result.cancelled).toBe(false);
		expect(result.editorText).toBe("Second message");
		// Leaf moved to parent of user message (a1)
		expect(sessionManager.getLeafId()).not.toBe(leafBefore);
	});

	test("navigating to root user message sets leaf to null", async () => {
		const { session, sessionManager } = ctx;

		const u1Id = sessionManager.appendMessage(userMsg("Root message"));
		sessionManager.appendMessage(assistantMsg("Response"));
		syncAgentState(ctx);

		const result = await session.navigateTree(u1Id, { summarize: false });

		expect(result.cancelled).toBe(false);
		expect(result.editorText).toBe("Root message");
		expect(sessionManager.getLeafId()).toBeNull();
	});

	test("navigating to assistant message returns no editorText", async () => {
		const { session, sessionManager } = ctx;

		sessionManager.appendMessage(userMsg("Hello"));
		const a1Id = sessionManager.appendMessage(assistantMsg("Hi back"));
		sessionManager.appendMessage(userMsg("Follow up"));
		syncAgentState(ctx);

		const result = await session.navigateTree(a1Id, { summarize: false });

		expect(result.cancelled).toBe(false);
		expect(result.editorText).toBeUndefined();
		expect(sessionManager.getLeafId()).toBe(a1Id);
	});

	test("navigating to current leaf is a no-op", async () => {
		const { session, sessionManager } = ctx;

		sessionManager.appendMessage(userMsg("Hello"));
		const a1Id = sessionManager.appendMessage(assistantMsg("Response"));
		syncAgentState(ctx);

		expect(sessionManager.getLeafId()).toBe(a1Id);
		const result = await session.navigateTree(a1Id, { summarize: false });

		expect(result.cancelled).toBe(false);
		expect(sessionManager.getLeafId()).toBe(a1Id);
	});

	test("navigating to non-existent entry throws", async () => {
		const { session } = ctx;
		await expect(session.navigateTree("nonexistent", { summarize: false })).rejects.toThrow(
			"Entry nonexistent not found",
		);
	});
});
