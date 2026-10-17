import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantMsg, userMsg } from "../../utilities.ts";
import { createHarness, getMessageText, type Harness } from "../harness.ts";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

describe("#10982 custom messages during compaction", () => {
	let harness: Harness;

	afterEach(() => {
		vi.restoreAllMocks();
		harness?.cleanup();
	});

	// Regression test for #10982: triggerTurn must wait for compaction_end on every exit path.
	it.each(
		(["manual", "threshold", "overflow"] as const).flatMap((reason) =>
			(["success", "failure", "abort"] as const).map((outcome) => ({ reason, outcome })),
		),
	)("defers triggerTurn until $reason compaction ends with $outcome", async ({ reason, outcome }) => {
		const compactionStarted = createDeferred();
		const compactionReleased = createDeferred();
		const requestStarted = createDeferred();
		const responseReleased = createDeferred();
		harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 }, retry: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => {
						compactionStarted.resolve();
						await compactionReleased.promise;
						if (outcome === "failure") return;
						return {
							compaction: {
								summary: "compacted history",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					});
				},
			],
		});
		harness.sessionManager.appendMessage(userMsg("old prompt"));
		harness.sessionManager.appendMessage(assistantMsg("old response"));
		harness.session.refreshContext();
		let requestMessages = "";
		harness.setResponses([
			...(outcome === "failure"
				? [fauxAssistantMessage("", { stopReason: "error", errorMessage: "summary failed" })]
				: []),
			async (context) => {
				requestMessages = JSON.stringify(context.messages);
				requestStarted.resolve();
				await responseReleased.promise;
				return fauxAssistantMessage("queued response");
			},
		]);

		const compaction =
			reason === "manual"
				? harness.session.compact()
				: (
						harness.session as unknown as {
							_runAutoCompaction: (reason: "threshold" | "overflow", willRetry: boolean) => Promise<boolean>;
						}
					)._runAutoCompaction(reason, false);
		const compactionOutcome = compaction.catch((error: unknown) => error);
		await compactionStarted.promise;

		try {
			expect(harness.session.isCompacting).toBe(true);
			expect(harness.session.isStreaming).toBe(false);
			await harness.session.sendCustomMessage(
				{ customType: "queued", content: "queued message", display: true, details: { source: "background" } },
				{ triggerTurn: true },
			);
			expect(harness.eventsOfType("agent_start")).toHaveLength(0);
			expect(harness.faux.state.callCount).toBe(0);
			expect(harness.sessionManager.getEntries().some((entry) => entry.type === "custom_message")).toBe(false);
		} finally {
			if (outcome === "abort") harness.session.abortCompaction();
			compactionReleased.resolve();
		}

		let idleResolved = false;
		const idle = harness.session.waitForIdle().then(() => {
			idleResolved = true;
		});
		try {
			// Finishing compaction must not wait for the newly triggered run to finish.
			const result = await compactionOutcome;
			await requestStarted.promise;
			expect(idleResolved).toBe(false);
			if (reason === "manual" && outcome !== "success") expect(result).toBeInstanceOf(Error);
			const end = harness.eventsOfType("compaction_end");
			expect(end).toHaveLength(1);
			expect(end[0]).toMatchObject({ reason, aborted: outcome === "abort" });
			expect(end[0]?.errorMessage !== undefined).toBe(outcome === "failure");
			const endIndex = harness.events.findIndex((event) => event.type === "compaction_end");
			const runIndex = harness.events.findIndex((event) => event.type === "agent_start");
			expect(runIndex).toBeGreaterThan(endIndex);
			expect(requestMessages).toContain("queued message");
			if (outcome === "success") expect(requestMessages).toContain("compacted history");
		} finally {
			responseReleased.resolve();
		}
		await idle;

		expect(harness.session.getLastAssistantText()).toBe("queued response");
		const entries = harness.sessionManager.getEntries();
		const customIndex = entries.findIndex((entry) => entry.type === "custom_message");
		expect(entries[customIndex]).toMatchObject({
			customType: "queued",
			display: true,
			details: { source: "background" },
		});
		if (outcome === "success") {
			expect(customIndex).toBeGreaterThan(entries.findIndex((entry) => entry.type === "compaction"));
		}
		expect(harness.session.isIdle).toBe(true);
	});

	// Regression test for #10982: replay each submission through the normal delivery rules.
	it.each(["steer", "followUp"] as const)("preserves %s ordering and nextTurn context", async (deliverAs) => {
		const compactionStarted = createDeferred();
		const compactionReleased = createDeferred();
		harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => {
						compactionStarted.resolve();
						await compactionReleased.promise;
						return {
							compaction: {
								summary: "compacted history",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					});
				},
			],
		});
		harness.sessionManager.appendMessage(userMsg("old prompt"));
		harness.sessionManager.appendMessage(assistantMsg("old response"));
		harness.session.refreshContext();
		const responses = deliverAs === "steer" ? ["queued response"] : ["first response", "queued response"];
		harness.setResponses(responses.map((text) => fauxAssistantMessage(text)));
		const compaction = harness.session.compact();
		await compactionStarted.promise;
		try {
			await harness.session.sendCustomMessage(
				{ customType: "aside", content: "next turn context", display: false },
				{ triggerTurn: true, deliverAs: "nextTurn" },
			);
			for (const content of ["first", "second"]) {
				await harness.session.sendCustomMessage(
					{ customType: "queued", content, display: true },
					{ triggerTurn: true, deliverAs },
				);
			}
			expect(harness.eventsOfType("agent_start")).toHaveLength(0);
		} finally {
			compactionReleased.resolve();
		}
		await compaction;
		await harness.session.waitForIdle();
		expect(harness.session.messages.filter((message) => message.role === "custom").map(getMessageText)).toEqual([
			"first",
			"next turn context",
			"second",
		]);
		expect(harness.session.getLastAssistantText()).toBe("queued response");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	// Regression test for #10982: deferred run errors must not become compaction failures.
	it("reports a deferred run failure through send_message", async () => {
		const errorReported = createDeferred();
		const errors: string[] = [];
		harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", (event) => {
						pi.sendMessage(
							{ customType: "queued", content: "queued message", display: true },
							{ triggerTurn: true },
						);
						return {
							compaction: {
								summary: "compacted history",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					});
				},
			],
		});
		harness.sessionManager.appendMessage(userMsg("old prompt"));
		harness.sessionManager.appendMessage(assistantMsg("old response"));
		harness.session.refreshContext();
		harness.session.extensionRunner.onError((error) => {
			errors.push(`${error.event}: ${error.error}`);
			errorReported.resolve();
		});
		vi.spyOn(harness.session.agent, "prompt").mockRejectedValueOnce(new Error("queued run failed"));

		await expect(harness.session.compact()).resolves.toMatchObject({ summary: "compacted history" });
		await errorReported.promise;
		expect(errors).toEqual(["send_message: queued run failed"]);
		expect(harness.eventsOfType("compaction_end")).toHaveLength(1);
		expect(harness.eventsOfType("compaction_end")[0]?.result?.summary).toBe("compacted history");
		expect(harness.session.isIdle).toBe(true);
	});

	// Regression test for #10982: isCompacting also includes branch summarization.
	it("releases queued custom messages after tree navigation", async () => {
		const navigationStarted = createDeferred();
		const navigationReleased = createDeferred();
		harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_tree", async () => {
						navigationStarted.resolve();
						await navigationReleased.promise;
						return { summary: { summary: "branch summary" } };
					});
				},
			],
		});
		harness.sessionManager.appendMessage(userMsg("first prompt"));
		const targetId = harness.sessionManager.appendMessage(assistantMsg("first response"));
		harness.sessionManager.appendMessage(userMsg("second prompt"));
		harness.sessionManager.appendMessage(assistantMsg("second response"));
		harness.session.refreshContext();
		harness.setResponses([fauxAssistantMessage("queued response")]);
		const navigation = harness.session.navigateTree(targetId, { summarize: true });
		await navigationStarted.promise;
		try {
			await harness.session.sendCustomMessage(
				{ customType: "queued", content: "after navigation", display: true },
				{ triggerTurn: true },
			);
			expect(harness.eventsOfType("agent_start")).toHaveLength(0);
		} finally {
			navigationReleased.resolve();
		}
		await navigation;
		await harness.session.waitForIdle();
		expect(harness.session.messages.map(getMessageText)).toContain("after navigation");
		expect(harness.session.getLastAssistantText()).toBe("queued response");
		const branch = harness.sessionManager.getBranch();
		expect(branch.findIndex((entry) => entry.type === "custom_message")).toBeGreaterThan(
			branch.findIndex((entry) => entry.type === "branch_summary"),
		);
	});
});
