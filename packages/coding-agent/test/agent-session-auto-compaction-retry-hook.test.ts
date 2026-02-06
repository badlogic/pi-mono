import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { codingTools } from "../src/core/tools/index.js";
import { createTestResourceLoader } from "./utilities.js";

vi.mock("../src/core/compaction/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/core/compaction/index.js")>();
	return {
		...actual,
		compact: vi.fn(async (preparation: { firstKeptEntryId: string; tokensBefore: number }) => {
			return {
				summary: "compacted summary",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: undefined,
			};
		}),
	};
});

function makeAssistantMessage(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "anthropic-messages" as const,
		provider: "anthropic" as const,
		model: "claude-test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

describe("AgentSession auto-compaction retry hook", () => {
	let AgentSession: typeof import("../src/core/agent-session.js").AgentSession;

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.resetModules();
		({ AgentSession } = await import("../src/core/agent-session.js"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("invokes hook after compaction is applied and before retry is scheduled (supports prompt override)", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test",
			initialState: {
				model,
				systemPrompt: "FULL PROMPT",
				tools: codingTools,
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: true, reserveTokens: 10, keepRecentTokens: 1 },
		});

		const session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: process.cwd(),
			modelRegistry: {} as any,
			resourceLoader: createTestResourceLoader(),
		});

		// Avoid real auth/model registry resolution in unit tests.
		(session as any)._modelRegistry = { getApiKey: async () => "test" };

		// Seed session history so prepareCompaction() can build a preparation.
		sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		sessionManager.appendMessage(makeAssistantMessage("hi there"));
		agent.replaceMessages(sessionManager.buildSessionContext().messages);

		const continueSpy = vi.fn(async () => {});
		(agent as any).continue = continueSpy;

		const sequence: string[] = [];
		let hookFirstRole: string | undefined;
		const events: Array<{ type: string; [k: string]: unknown }> = [];
		session.subscribe((e) => {
			events.push(e);
			if (e.type === "auto_compaction_end") sequence.push("end");
		});

		session.setAutoCompactionRetryHook((ctx) => {
			sequence.push("hook");
			hookFirstRole = ctx.messages[0]?.role;
			return { action: "proceed", systemPrompt: "SLIM PROMPT" };
		});

		await (session as any)._runAutoCompaction("overflow", true);

		expect(hookFirstRole).toBe("compactionSummary");
		expect(sequence).toEqual(["hook", "end"]);
		expect(session.systemPrompt).toBe("SLIM PROMPT");

		// Retry is scheduled but not executed until timers advance.
		expect(continueSpy).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(continueSpy).toHaveBeenCalledTimes(1);

		const endEvent = events.find((e) => e.type === "auto_compaction_end");
		expect(endEvent && endEvent.type === "auto_compaction_end" && endEvent.willRetry).toBe(true);
	});

	it("can cancel retry and willRetry reflects cancellation", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test",
			initialState: {
				model,
				systemPrompt: "FULL PROMPT",
				tools: codingTools,
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: true, reserveTokens: 10, keepRecentTokens: 1 },
		});

		const session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: process.cwd(),
			modelRegistry: {} as any,
			resourceLoader: createTestResourceLoader(),
		});
		(session as any)._modelRegistry = { getApiKey: async () => "test" };

		sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		sessionManager.appendMessage(makeAssistantMessage("hi there"));
		agent.replaceMessages(sessionManager.buildSessionContext().messages);

		const continueSpy = vi.fn(async () => {});
		(agent as any).continue = continueSpy;

		const events: Array<{ type: string; [k: string]: unknown }> = [];
		session.subscribe((e) => events.push(e));

		session.setAutoCompactionRetryHook(() => {
			return { action: "cancel", errorMessage: "retry canceled by consumer" };
		});

		await (session as any)._runAutoCompaction("overflow", true);
		await vi.runAllTimersAsync();

		expect(continueSpy).not.toHaveBeenCalled();

		const endEvent = events.find((e) => e.type === "auto_compaction_end");
		expect(endEvent && endEvent.type === "auto_compaction_end" && endEvent.willRetry).toBe(false);
		expect(endEvent && endEvent.type === "auto_compaction_end" && endEvent.retryCanceledMessage).toBe(
			"retry canceled by consumer",
		);
		expect(endEvent && endEvent.type === "auto_compaction_end" && endEvent.errorMessage).toBeUndefined();
	});
});
