import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import emptyToolCallRecovery from "../../examples/extensions/empty-tool-call-recovery.ts";
import { createHarness, createTestUiContext, getMessageText, type Harness } from "./harness.ts";

const emptyToolUse = () => fauxAssistantMessage([], { stopReason: "toolUse" });

describe("empty-tool-call-recovery example extension", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function setup(tools?: AgentTool[]) {
		const harness = await createHarness({
			tools,
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
			extensionFactories: [emptyToolCallRecovery],
		});
		harnesses.push(harness);
		return harness;
	}

	it("stops after an empty toolUse response when the extension is not loaded", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([emptyToolUse(), fauxAssistantMessage("not requested")]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("sends hidden feedback in the next request without inventing a tool result", async () => {
		const harness = await setup();
		harness.setResponses([
			emptyToolUse(),
			(context) => {
				expect(context.messages.at(-1)?.role).toBe("user");
				expect(getMessageText(context.messages.at(-1))).toContain("contained no actual tool calls");
				expect(context.messages.some((message) => message.role === "toolResult")).toBe(false);
				expect(harness.eventsOfType("agent_settled")).toHaveLength(0);
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(2);
		expect(harness.sessionManager.getEntries()).toContainEqual(
			expect.objectContaining({
				type: "custom_message",
				customType: "empty-tool-call-recovery",
				display: false,
				details: { attempt: 1, maxAttempts: 3 },
			}),
		);
		expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
	});

	it("allows a successful response on the third recovery request", async () => {
		const harness = await setup();
		harness.setResponses([emptyToolUse(), emptyToolUse(), emptyToolUse(), fauxAssistantMessage("recovered")]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(4);
		expect(getMessageText(harness.session.messages.at(-1))).toBe("recovered");
	});

	it("stops requesting recovery after three attempts and reports exhaustion", async () => {
		const harness = await setup();
		const notify = vi.fn();
		await harness.session.bindExtensions({ uiContext: createTestUiContext({ notify }) });
		harness.setResponses(Array.from({ length: 5 }, emptyToolUse));

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(4);
		expect(harness.getPendingResponseCount()).toBe(1);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("after 3 recovery attempts"), "error");
		expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
	});

	it("resets the budget after a completed tool exchange within the same run", async () => {
		const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} }));
		const harness = await setup([
			{ name: "noop", label: "noop", description: "No-op", parameters: Type.Object({}), execute },
		]);
		harness.setResponses([
			emptyToolUse(),
			emptyToolUse(),
			emptyToolUse(),
			fauxAssistantMessage([fauxToolCall("noop", {})], { stopReason: "toolUse" }),
			emptyToolUse(),
			emptyToolUse(),
			emptyToolUse(),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(8);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
		const attempts = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom_message")
			.map((entry) => entry.details);
		expect(attempts).toEqual([1, 2, 3, 1, 2, 3].map((attempt) => ({ attempt, maxAttempts: 3 })));
	});

	it("gives a new user prompt a fresh budget after exhaustion", async () => {
		const harness = await setup();
		harness.setResponses(Array.from({ length: 4 }, emptyToolUse));
		await harness.session.prompt("first task");
		harness.setResponses([emptyToolUse(), emptyToolUse(), emptyToolUse(), fauxAssistantMessage("done")]);

		await harness.session.prompt("second task");

		expect(harness.faux.state.callCount).toBe(8);
		expect(getMessageText(harness.session.messages.at(-1))).toBe("done");
	});

	it.each([
		{ content: [] },
		{ content: [{ type: "thinking" as const, thinking: "I will use a tool." }] },
		{ content: [{ type: "text" as const, text: "I will use a tool." }] },
	])("recovers a completed toolUse response with content $content", async ({ content }) => {
		const harness = await setup();
		harness.setResponses([fauxAssistantMessage(content, { stopReason: "toolUse" }), fauxAssistantMessage("done")]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(2);
	});

	it.each(["stop", "length", "error", "aborted"] as const)("does not recover a %s response", async (stopReason) => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage("I will use a tool.", { stopReason }),
			fauxAssistantMessage("not requested"),
		]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.sessionManager.getEntries().some((entry) => entry.type === "custom_message")).toBe(false);
	});

	it("leaves real tool errors to the existing tool-result path", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("missing_tool", {})], { stopReason: "toolUse" }),
			(context) => {
				expect(context.messages).toContainEqual(expect.objectContaining({ role: "toolResult", isError: true }));
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(2);
		expect(harness.sessionManager.getEntries().some((entry) => entry.type === "custom_message")).toBe(false);
	});

	it("does not request recovery when the user cancels as the response finishes", async () => {
		const harness = await setup();
		harness.session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant") void harness.session.abort();
		});
		harness.setResponses([emptyToolUse(), fauxAssistantMessage("not requested")]);

		await harness.session.prompt("continue the task");

		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.sessionManager.getEntries().some((entry) => entry.type === "custom_message")).toBe(false);
		expect(harness.eventsOfType("agent_settled")).toEqual([{ type: "agent_settled", aborted: true }]);
	});
});
