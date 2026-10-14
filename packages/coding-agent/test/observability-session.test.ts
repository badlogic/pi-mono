import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionObserver, type SessionObserver } from "../src/core/observability/session-observer.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

interface ExportedSpan {
	name: string;
	spanId: string;
	parentSpanId: string | null;
	attributes: Record<string, unknown>;
}

function readSpans(dir: string): ExportedSpan[] {
	return readdirSync(dir)
		.filter((name) => name.startsWith("spans-"))
		.flatMap((name) =>
			readFileSync(join(dir, name), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as ExportedSpan),
		);
}

const echoTool: AgentTool = {
	name: "echo",
	label: "Echo",
	description: "Echo the given text back",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_toolCallId, params: unknown) => {
		const { text } = params as { text: string };
		return { content: [{ type: "text", text }], details: undefined };
	},
};

describe("session observability", () => {
	const harnesses: Harness[] = [];
	const observers: SessionObserver[] = [];
	const dirs: string[] = [];

	afterEach(async () => {
		while (observers.length > 0) await observers.pop()?.dispose();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
	});

	it("exports run, turn, llm, and tool spans for a tool round", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-observability-session-"));
		dirs.push(dir);

		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);
		observers.push(createSessionObserver(harness.session, { enabled: true, dir, content: "off" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hi" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("say hi");

		const spans = readSpans(dir);
		const names = spans.map((span) => span.name);
		expect(names.filter((name) => name === "session.run")).toHaveLength(1);
		expect(names.filter((name) => name === "turn")).toHaveLength(2);
		expect(names.filter((name) => name === "llm.request")).toHaveLength(2);
		expect(names.filter((name) => name === "tool.echo")).toHaveLength(1);

		const run = spans.find((span) => span.name === "session.run");
		const tool = spans.find((span) => span.name === "tool.echo");
		const turns = spans.filter((span) => span.name === "turn");
		expect(run?.parentSpanId).toBeNull();
		expect(turns.every((turn) => turn.parentSpanId === run?.spanId)).toBe(true);
		expect(tool?.parentSpanId).toBe(turns[0]?.spanId);
		expect(tool?.attributes["pi.tool.is_error"]).toBe(false);
		expect(tool?.attributes["pi.tool.args"]).toBeUndefined();
	});
});
