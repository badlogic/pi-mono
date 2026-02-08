import type { AssistantMessage } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestSession, userMsg } from "./utilities.js";

function createOverflowAssistant(timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "overflow" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 250000,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 250000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: "prompt is too long: 250000 tokens > 200000 maximum",
		timestamp,
	};
}

describe("AgentSession._checkCompaction", () => {
	let cleanup: (() => void) | undefined;

	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
		vi.restoreAllMocks();
	});

	it("uses the latest compaction entry when checking overflow errors", async () => {
		const testContext = createTestSession({ inMemory: true });
		cleanup = testContext.cleanup;
		const { session, sessionManager } = testContext;

		const seedUser = userMsg("seed");
		seedUser.timestamp = 1;
		const firstKeptEntryId = sessionManager.appendMessage(seedUser);

		const firstCompactionId = sessionManager.appendCompaction("first summary", firstKeptEntryId, 100000);
		const firstCompaction = sessionManager.getEntry(firstCompactionId);
		expect(firstCompaction?.type).toBe("compaction");
		if (!firstCompaction || firstCompaction.type !== "compaction") {
			throw new Error("Expected first compaction entry");
		}
		firstCompaction.timestamp = "2026-01-01T00:00:00.000Z";

		const overflowAssistant = createOverflowAssistant(new Date("2026-01-01T00:00:01.000Z").getTime());
		sessionManager.appendMessage(overflowAssistant);

		const secondCompactionId = sessionManager.appendCompaction("second summary", firstKeptEntryId, 100000);
		const secondCompaction = sessionManager.getEntry(secondCompactionId);
		expect(secondCompaction?.type).toBe("compaction");
		if (!secondCompaction || secondCompaction.type !== "compaction") {
			throw new Error("Expected second compaction entry");
		}
		secondCompaction.timestamp = "2026-01-01T00:00:02.000Z";

		const privateSession = session as unknown as {
			_checkCompaction: (assistantMessage: AssistantMessage, skipAbortedCheck?: boolean) => Promise<void>;
			_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<void>;
		};

		const runAutoCompactionSpy = vi.spyOn(privateSession, "_runAutoCompaction").mockResolvedValue();
		await privateSession._checkCompaction(overflowAssistant);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});
});
