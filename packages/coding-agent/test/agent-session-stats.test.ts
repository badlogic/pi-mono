import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	getModel,
	streamSimple,
	type ToolResultMessage,
	type Usage,
} from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { getUsageCostBreakdown } from "../src/core/usage-totals.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createAssistantMessage(
	text: string,
	totalTokens: number,
	timestamp: number,
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content: stopReason === "error" ? [] : [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(totalTokens),
		stopReason,
		timestamp,
	};
}

function createUserMessage(text: string, timestamp: number) {
	return {
		role: "user" as const,
		content: text,
		timestamp,
	};
}

function createToolResultMessage(usage: Usage): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "tool-call-1",
		toolName: "test_tool",
		content: [{ type: "text", text: "tool result" }],
		usage,
		isError: false,
		timestamp: 1,
	};
}

async function createSession() {
	const settingsManager = SettingsManager.inMemory();
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			streamFn: streamSimple,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant.",
				tools: [],
				thinkingLevel: "high",
			},
		}),
		sessionManager,
		settingsManager,
		cwd: process.cwd(),
		modelRuntime: getModelRuntime(await createInMemoryModelRegistry(authStorage)),
		resourceLoader: createTestResourceLoader(),
	});

	return { session, sessionManager };
}

function syncAgentMessages(session: AgentSession, sessionManager: SessionManager): void {
	session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

describe("AgentSession.getSessionStats", () => {
	it("exposes the current context usage alongside token totals", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendMessage(createAssistantMessage("hi", 200, 2));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage).toEqual(session.getContextUsage());
			expect(stats.contextUsage?.tokens).toBe(200);
			expect(stats.contextUsage?.contextWindow).toBe(model.contextWindow);
			expect(stats.contextUsage?.percent).toBe((200 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("reports unknown current context usage immediately after compaction", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			// Totals cover ALL entries, including history compacted away (180k + 195k).
			expect(stats.tokens.input).toBe(375_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBeNull();
			expect(stats.contextUsage?.percent).toBeNull();
		} finally {
			session.dispose();
		}
	});

	it("uses post-compaction usage for current context instead of stale kept usage", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			sessionManager.appendMessage(createAssistantMessage("response3", 25_000, 6));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			// Totals cover ALL entries, including history compacted away (180k + 195k + 25k).
			expect(stats.tokens.input).toBe(400_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBe(25_000);
			expect(stats.contextUsage?.percent).toBe((25_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("includes branch summary usage in session totals", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.branchWithSummary(null, "summary", undefined, false, {
				input: 10,
				output: 20,
				cacheRead: 30,
				cacheWrite: 40,
				totalTokens: 100,
				cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
			});
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 });
			expect(stats.cost).toBe(1);
		} finally {
			session.dispose();
		}
	});

	it("includes compaction usage in session totals", async () => {
		const { session, sessionManager } = await createSession();

		try {
			const firstKeptEntryId = sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendCompaction("summary", firstKeptEntryId, 100, undefined, false, {
				input: 10,
				output: 20,
				cacheRead: 30,
				cacheWrite: 40,
				totalTokens: 100,
				cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
			});
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 });
			expect(stats.cost).toBe(1);
		} finally {
			session.dispose();
		}
	});

	it("includes tool result usage in session totals", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(
				createToolResultMessage({
					input: 10,
					output: 20,
					cacheRead: 30,
					cacheWrite: 40,
					totalTokens: 100,
					cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
				}),
			);
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 });
			expect(stats.cost).toBe(1);
		} finally {
			session.dispose();
		}
	});

	it("groups tool and summary usage separately from model-attributed usage", () => {
		const sessionManager = SessionManager.inMemory();
		const rootId = sessionManager.appendMessage(createUserMessage("hello", 1));
		sessionManager.appendMessage({
			...createAssistantMessage("response", 100, 2),
			usage: { ...createUsage(100), cost: { ...createUsage(100).cost, total: 0.5 } },
		});
		sessionManager.appendMessage(
			createToolResultMessage({ ...createUsage(100), cost: { ...createUsage(100).cost, total: 1 } }),
		);
		sessionManager.appendCompaction("summary", rootId, 100, undefined, false, {
			...createUsage(100),
			cost: { ...createUsage(100).cost, total: 2 },
		});
		sessionManager.branchWithSummary(null, "branch summary", undefined, false, {
			...createUsage(100),
			cost: { ...createUsage(100).cost, total: 3 },
		});

		expect(getUsageCostBreakdown(sessionManager.getEntries())).toEqual([
			{ key: "Tools/summaries", cost: 6, tokens: 300 },
			{ key: `${model.provider}/${model.id}`, cost: 0.5, tokens: 100 },
		]);
	});

	it("ignores zero-usage messages when checking for post-compaction context usage", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			sessionManager.appendMessage(createAssistantMessage("response3", 25_000, 6));
			sessionManager.appendMessage(createUserMessage("continue", 7));
			sessionManager.appendMessage(createAssistantMessage("partial", 0, 8));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).not.toBeNull();
			expect(stats.contextUsage?.tokens ?? 0).toBeGreaterThan(25_000);
		} finally {
			session.dispose();
		}
	});

	// Reported live shape: a footer/get_session_stats reading past 100% after
	// the most recent assistant message errored or was aborted following a
	// huge quoted turn. getContextUsage() computed its own full-array estimate
	// independently of _checkCompaction()'s Case 3, so the trigger-side fix
	// there left this display path unpatched - these tests cover the display
	// path's own narrowing and clamp, mirroring the trigger-side fix exactly.
	it("narrows displayed context to the last reliable usage when the most recent assistant errored", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 68_000, 2)); // reliable baseline: 6.8% of window
			sessionManager.appendMessage(createUserMessage("x".repeat(4_000_000), 3)); // one action's worth of quoted content alone estimates past the window
			sessionManager.appendMessage(createAssistantMessage("", 0, 4, "error")); // failed before reporting any usage
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage?.tokens).toBe(68_000);
			expect(stats.contextUsage?.percent).toBe((68_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("narrows displayed context to the last reliable usage when the most recent assistant was aborted", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 68_000, 2));
			sessionManager.appendMessage(createUserMessage("x".repeat(4_000_000), 3));
			sessionManager.appendMessage(createAssistantMessage("", 0, 4, "aborted"));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage?.tokens).toBe(68_000);
			expect(stats.contextUsage?.percent).toBe((68_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("never reports a displayed percent above 100%, even with no reliable baseline to narrow to", async () => {
		const { session, sessionManager } = await createSession();

		try {
			// No prior reliable usage anywhere: the narrowing branch cannot apply
			// (estimate.lastUsageIndex stays null), so this exercises the plain
			// full-array estimate - which must still be clamped to the window,
			// the same #8328 case the trigger-side fix also had to keep serving.
			sessionManager.appendMessage(createUserMessage("x".repeat(8_000_000), 1)); // ~2M estimated tokens, 2x the window
			sessionManager.appendMessage(createAssistantMessage("", 0, 2, "error"));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage?.tokens).toBeLessThanOrEqual(model.contextWindow);
			expect(stats.contextUsage?.percent).toBeLessThanOrEqual(100);
		} finally {
			session.dispose();
		}
	});

	it("does not narrow when the most recent assistant message completed normally with zero usage (malformed, not failed)", async () => {
		const { session, sessionManager } = await createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 68_000, 2));
			sessionManager.appendMessage(createUserMessage("x".repeat(4_000_000), 3));
			sessionManager.appendMessage(createAssistantMessage("", 0, 4, "stop")); // zero usage but not a confirmed failure
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			// Unaffected by the narrowing: still adds the trailing estimate, only
			// clamped to the window like every other path.
			expect(stats.contextUsage?.tokens).toBeGreaterThan(68_000);
			expect(stats.contextUsage?.tokens).toBeLessThanOrEqual(model.contextWindow);
		} finally {
			session.dispose();
		}
	});
});
