import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import degenerateOutput from "../../examples/extensions/degenerate-output.ts";
import { DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from "../../src/core/compaction/index.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const echo: AgentTool = {
	name: "echo",
	label: "Echo",
	description: "Return a fixed result",
	parameters: Type.Object({}),
	execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
};

describe("degenerate output extension example", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it.each(["*\n".repeat(1024), " \n".repeat(1024)])(
		"keeps raw evidence but excludes long tails from replay, compaction, and resume (%#)",
		async (tail) => {
			const raw = `Checking a file.\n${tail}`;
			const requests: string[] = [];
			const harness = await createHarness({ tools: [echo], extensionFactories: [degenerateOutput] });
			harnesses.push(harness);
			harness.setResponses([
				fauxAssistantMessage([{ type: "text", text: raw }, fauxToolCall("echo", {})], { stopReason: "toolUse" }),
				(context) => {
					requests.push(
						context.messages
							.filter((message) => message.role === "assistant")
							.map(getMessageText)
							.join(""),
					);
					return fauxAssistantMessage("done");
				},
			]);
			await harness.session.prompt("inspect");
			expect(requests).toEqual(["Checking a file."]);
			expect(harness.eventsOfType("tool_execution_end")).toHaveLength(1);
			const original = harness.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (original?.type !== "message") throw new Error("missing original assistant");
			expect(getMessageText(original.message)).toBe(raw);
			expect(harness.session.messages.find((message) => message.role === "assistant")?.content).toEqual([
				{ type: "text", text: "Checking a file." },
				expect.objectContaining({ type: "toolCall", name: "echo" }),
			]);

			const preparation = prepareCompaction(harness.sessionManager.getBranch(), {
				...DEFAULT_COMPACTION_SETTINGS,
				keepRecentTokens: 1,
			});
			expect(preparation).toBeDefined();
			expect(
				[...preparation!.messagesToSummarize, ...preparation!.turnPrefixMessages].map(getMessageText).join(""),
			).not.toContain(tail);
			harness.sessionManager.appendCompaction("summary", original.id, 100);
			harness.session.refreshContext();
			expect(harness.session.messages.map(getMessageText).join("")).not.toContain(tail);

			const header = harness.sessionManager.getHeader();
			if (!header) throw new Error("missing session header");
			const restored = SessionManager.inMemory(
				undefined,
				undefined,
				JSON.parse(JSON.stringify([header, ...harness.sessionManager.getBranch()])),
			);
			expect(restored.buildSessionProjection().messages.map(getMessageText).join("")).not.toContain(tail);
			expect(
				restored.getBranch().some((entry) => entry.type === "message" && getMessageText(entry.message) === raw),
			).toBe(true);
		},
	);

	it.each([
		"Ordinary Markdown\n\n***\n",
		`\`\`\`\`\n${"*".repeat(2048)}\n\`\`\`\``,
		`~~~\n${" ".repeat(2048)}`,
		"A normal paragraph. ".repeat(200),
	])("preserves legitimate text (%#)", async (text) => {
		const harness = await createHarness({ extensionFactories: [degenerateOutput] });
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage(text)]);
		await harness.session.prompt("test");
		expect(getMessageText(harness.session.messages.at(-1))).toBe(text);
		expect(harness.sessionManager.getBranch().filter((entry) => entry.type === "context_edit")).toEqual([]);
	});

	it("does not change default replay when the extension is not loaded", async () => {
		const text = `Checking.\n${"*\n".repeat(1024)}`;
		const harness = await createHarness({ tools: [echo] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([{ type: "text", text }, fauxToolCall("echo", {})], { stopReason: "toolUse" }),
			(context) => {
				expect(getMessageText(context.messages.find((message) => message.role === "assistant"))).toBe(text);
				return fauxAssistantMessage("done");
			},
		]);
		await harness.session.prompt("test");
	});
});
