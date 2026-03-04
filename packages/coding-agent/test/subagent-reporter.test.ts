import { describe, expect, it } from "vitest";
import subagentReporter from "../addons-extensions/subagent-reporter.js";
import type { ExtensionAPI } from "../src/core/extensions/types.js";

interface ReportEntry {
	version: 1;
	kind: "first_activity" | "tool_progress" | "turn" | "agent_end";
	turnIndex: number;
	text: string;
	toolCount: number;
	timestamp: number;
}

type EventHandler = (event: unknown) => void | Promise<void>;

function createReporterHarness(): {
	handlers: Map<string, EventHandler>;
	reports: ReportEntry[];
} {
	const handlers = new Map<string, EventHandler>();
	const reports: ReportEntry[] = [];

	const pi = {
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, handler);
		},
		appendEntry: (customType: string, data: unknown) => {
			if (customType !== "subagent-turn-report") return;
			reports.push(data as ReportEntry);
		},
	} as unknown as ExtensionAPI;

	subagentReporter(pi);

	return { handlers, reports };
}

async function emit(handlers: Map<string, EventHandler>, event: string, payload: unknown): Promise<void> {
	const handler = handlers.get(event);
	if (!handler) {
		throw new Error(`Missing handler for event: ${event}`);
	}
	await handler(payload);
}

describe("subagent-reporter", () => {
	it("emits tool_progress entries with incremental tool counts", async () => {
		const { handlers, reports } = createReporterHarness();

		await emit(handlers, "turn_start", { turnIndex: 7 });
		await emit(handlers, "tool_execution_end", {});
		await emit(handlers, "tool_execution_end", {});
		await emit(handlers, "turn_end", {
			turnIndex: 7,
			message: {
				role: "assistant",
				content: [{ type: "text", text: "done" }],
			},
		});

		expect(reports.map((report) => report.kind)).toEqual([
			"first_activity",
			"tool_progress",
			"tool_progress",
			"turn",
		]);
		expect(reports.map((report) => report.toolCount)).toEqual([1, 1, 2, 2]);
	});

	it("emits cumulative tool counts across turns", async () => {
		const { handlers, reports } = createReporterHarness();

		await emit(handlers, "turn_start", { turnIndex: 1 });
		await emit(handlers, "tool_execution_end", {});
		await emit(handlers, "tool_execution_end", {});
		await emit(handlers, "turn_end", {
			turnIndex: 1,
			message: {
				role: "assistant",
				content: [{ type: "text", text: "first turn" }],
			},
		});

		await emit(handlers, "turn_start", { turnIndex: 2 });
		await emit(handlers, "tool_execution_end", {});
		await emit(handlers, "turn_end", {
			turnIndex: 2,
			message: {
				role: "assistant",
				content: [{ type: "text", text: "second turn" }],
			},
		});

		const turnReports = reports.filter((report) => report.kind === "turn");
		expect(turnReports).toHaveLength(2);
		expect(turnReports.map((report) => report.toolCount)).toEqual([2, 3]);
	});
});
