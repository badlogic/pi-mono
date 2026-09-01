import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

// Reported shape: "Compacted from 1,665,423 tokens", footer/visible context
// reading 6.8% immediately after, then auto-compaction firing again shortly
// after while the visible context still read low - the failing turn in
// between reported stopReason "error". Traced to _checkCompaction's Case 3:
// once a reliable post-compaction usage baseline exists, a turn that then
// fails with stopReason "error" never confirms how much of its own rendered
// content the provider actually processed (it may have failed before
// sending anything), so adding the crude per-character trailingTokens
// estimate of everything since that baseline on top of it overstated the
// trigger far past what the visible context showed - and, for a bridge
// provider that resends the full conversation as quoted text on every turn
// (no cross-turn prompt-cache reuse), that trailing estimate can be far
// larger than the real, cached context a healthy turn would use.

type SessionWithCompactionInternals = {
	_checkCompaction: (assistantMessage: AssistantMessage, skipAbortedCheck?: boolean) => Promise<boolean>;
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

function assistantWithUsage(
	harness: Harness,
	totalTokens: number,
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	const model = harness.getModel();
	return {
		role: "assistant",
		content: stopReason === "error" ? [] : [{ type: "text", text: "response" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

describe("post-compaction error turn does not retrigger auto-compact from a low visible baseline", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	// A 1000-token window scaled proportionally to the reported case: 6.8% of
	// 1,000,000 is 68,000; here 6.8% of 1000 is 68. reserveTokens stays small
	// (matching the #8328 regression test's own convention) so the threshold
	// sits just under the window, not because the real bug depends on it.
	async function createPostCompactionHarness(): Promise<Harness> {
		const harness = await createHarness({
			models: [{ id: "faux-1", contextWindow: 1000, maxTokens: 200 }],
			settings: { compaction: { enabled: true, reserveTokens: 10 } },
		});
		harnesses.push(harness);
		return harness;
	}

	it("uses the last reliable post-compaction usage instead of the full trailing estimate when the next turn errors", async () => {
		const harness = await createPostCompactionHarness();
		const baseline = assistantWithUsage(harness, 68, "stop"); // the reported 6.8% of window
		const failedTurn = assistantWithUsage(harness, 0, "error"); // usage cleared: this is what the provider reports on a spawn/response failure

		// Between the reliable baseline and the failed turn: one action's worth
		// of real content large enough that a naive chars/4 sum over it alone
		// would cross the compaction threshold, reproducing the reported
		// "visible 6.8%, auto-compact fires again" shape if left unbounded.
		harness.session.agent.state.messages = [
			{
				role: "user",
				content: [{ type: "text", text: "kept-recent context after compaction" }],
				timestamp: Date.now() - 3,
			},
			baseline,
			{ role: "user", content: [{ type: "text", text: "x".repeat(4000) }], timestamp: Date.now() - 1 }, // ~1000 estimated tokens - alone exceeds the 990-token threshold
			failedTurn,
		];
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(failedTurn);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("still compacts from the full trailing estimate when no reliable usage exists at all (the #8328 case this fallback also serves)", async () => {
		const harness = await createPostCompactionHarness();
		const failedTurn = assistantWithUsage(harness, 0, "error");

		// No earlier valid usage anywhere in the array: estimate.lastUsageIndex
		// is null, so this must still fall through to the full message-size
		// estimate exactly as before this change - the malformed-response case
		// #8328 fixed must keep working.
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "x".repeat(4000) }], timestamp: Date.now() - 1 },
			failedTurn,
		];
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(failedTurn);

		expect(runAutoCompactionSpy).toHaveBeenCalledOnce();
		expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
	});

	it('still compacts from the trailing estimate when the zero-usage response\'s own stopReason is not "error" (a malformed-but-not-failed response)', async () => {
		const harness = await createPostCompactionHarness();
		const baseline = assistantWithUsage(harness, 68, "stop");
		const zeroUsageButNotError = assistantWithUsage(harness, 0, "stop");

		harness.session.agent.state.messages = [
			{
				role: "user",
				content: [{ type: "text", text: "kept-recent context after compaction" }],
				timestamp: Date.now() - 3,
			},
			baseline,
			{ role: "user", content: [{ type: "text", text: "x".repeat(4000) }], timestamp: Date.now() - 1 },
			zeroUsageButNotError,
		];
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(zeroUsageButNotError);

		expect(runAutoCompactionSpy).toHaveBeenCalledOnce();
	});
});
