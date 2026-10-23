import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

/**
 * A turn driven one tool call at a time: runToolCallById addresses a single pending call from
 * outside the loop, so an external executor (for example a Temporal activity) can run one step
 * and see its result. The pending state is seeded directly, because it is what a turn interrupted
 * between its model call and its tool results holds.
 */
describe("AgentSession step-by-step tool calls", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	/** A session holding one assistant message that asked for `ids`, with no results yet. */
	async function pendingTurn(ids: string[]): Promise<Harness> {
		const harness = await createHarness();
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		harness.session.agent.state.messages = [
			...harness.session.messages,
			fauxAssistantMessage(
				ids.map((id) => fauxToolCall("read", { path: `${id}.txt` }, { id }) as never),
				{ stopReason: "toolUse" },
			) as never,
		];
		return harness;
	}

	it("reports the calls the model asked for that have no result", async () => {
		const harness = await pendingTurn(["call-a", "call-b"]);
		expect(harness.session.getPendingToolCalls().map((call) => call.id)).toEqual(["call-a", "call-b"]);
	});

	it("returns undefined for an unknown id", async () => {
		const harness = await pendingTurn(["call-a"]);
		expect(await harness.session.runToolCallById("nope")).toBeUndefined();
	});

	it("runs the call, emits its events, and appends exactly one result", async () => {
		const harness = await pendingTurn(["call-a"]);
		const before = harness.session.messages.length;
		const starts = harness.eventsOfType("tool_execution_start").length;

		const result = await harness.session.runToolCallById("call-a");

		expect(result?.role).toBe("toolResult");
		expect(result?.toolCallId).toBe("call-a");
		expect(harness.eventsOfType("tool_execution_start").length).toBe(starts + 1);
		expect(harness.session.messages.length).toBe(before + 1);

		// The call is answered, so it is no longer pending and a repeat is a no-op.
		expect(harness.session.getPendingToolCalls()).toEqual([]);
		expect(await harness.session.runToolCallById("call-a")).toBeUndefined();
		const results = harness.session.messages.filter(
			(message): message is ToolResultMessage => message.role === "toolResult" && message.toolCallId === "call-a",
		);
		expect(results.length).toBe(1);
	});

	it("leaves the other calls pending when one of a batch runs", async () => {
		const harness = await pendingTurn(["call-a", "call-b"]);
		await harness.session.runToolCallById("call-a");
		expect(harness.session.getPendingToolCalls().map((call) => call.id)).toEqual(["call-b"]);
	});
});
