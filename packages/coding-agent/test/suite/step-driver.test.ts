/**
 * Shows the shape Temporal needs: a turn where the model call and each tool call are separate
 * steps an outside caller drives by id. Each step prints a line, the way an activity would.
 *
 * Run: node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/step-driver.test.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("step driver", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("drives a turn one tool call at a time", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		writeFileSync(join(harness.tempDir, "one.txt"), "first");
		writeFileSync(join(harness.tempDir, "two.txt"), "second");

		// What a turn holds after its model call but before its tools run: one assistant message
		// asking for two calls, with no results yet.
		harness.session.agent.state.messages = [
			...harness.session.messages,
			fauxAssistantMessage(
				[
					fauxToolCall("read", { path: "one.txt" }, { id: "step-1" }) as never,
					fauxToolCall("read", { path: "two.txt" }, { id: "step-2" }) as never,
				],
				{ stopReason: "toolUse" },
			) as never,
		];

		const lines: string[] = [];
		lines.push("workflow: model call produced [step-1, step-2]");
		for (const call of harness.session.getPendingToolCalls()) {
			lines.push(`activity: tool call ${call.id} (${call.name})`);
			const result = await harness.session.runToolCallById(call.id);
			lines.push(`activity: tool call ${call.id} -> ${result?.isError ? "error" : "ok"}`);
		}
		lines.push(`workflow: turn done, ${harness.session.getPendingToolCalls().length} pending left`);

		console.log(`\n${lines.join("\n")}\n`);

		expect(harness.session.getPendingToolCalls()).toEqual([]);
		expect(lines).toEqual([
			"workflow: model call produced [step-1, step-2]",
			"activity: tool call step-1 (read)",
			"activity: tool call step-1 -> ok",
			"activity: tool call step-2 (read)",
			"activity: tool call step-2 -> ok",
			"workflow: turn done, 0 pending left",
		]);
	});
});
