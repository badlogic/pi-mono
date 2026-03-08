import { describe, expect, it } from "vitest";
import taskboardExtension from "../addons-extensions/taskboard.js";
import type { ExtensionAPI } from "../src/core/extensions/types.js";

type EventHandler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

type ToolExecute = (
	callId: string,
	args: Record<string, unknown>,
	signal: AbortSignal | undefined,
	onUpdate: unknown,
	ctx: unknown,
) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;

interface Harness {
	handlers: Map<string, EventHandler>;
	executeTask: ToolExecute;
	executeTodoWrite: ToolExecute;
	ctx: {
		sessionManager: { getBranch: () => unknown[] };
		ui: {
			setWidget: (_key: string, _widget: unknown, _options?: { placement?: "aboveEditor" | "belowEditor" }) => void;
			setStatus: (_key: string, _status: string | undefined) => void;
			notify: (_msg: string, _kind: string) => void;
			custom: <T>(factory: unknown) => Promise<T>;
		};
		hasUI: boolean;
	};
	widgetCalls: Array<{ key: string; placement?: "aboveEditor" | "belowEditor"; cleared: boolean }>;
}

function createHarness(): Harness {
	const handlers = new Map<string, EventHandler>();
	let executeTask: ToolExecute | undefined;
	let executeTodoWrite: ToolExecute | undefined;
	const widgetCalls: Array<{ key: string; placement?: "aboveEditor" | "belowEditor"; cleared: boolean }> = [];

	const api = {
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, handler);
		},
		registerTool: (tool: { name: string; execute: ToolExecute }) => {
			if (tool.name === "task") executeTask = tool.execute;
			if (tool.name === "todo_write") executeTodoWrite = tool.execute;
		},
		registerCommand: () => {},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;

	taskboardExtension(api);

	if (!executeTask || !executeTodoWrite) {
		throw new Error("expected task and todo_write tools to be registered");
	}

	const ctx = {
		sessionManager: {
			getBranch: () => [],
		},
		ui: {
			setWidget: (key: string, widget: unknown, options?: { placement?: "aboveEditor" | "belowEditor" }) => {
				widgetCalls.push({
					key,
					placement: options?.placement,
					cleared: widget === undefined,
				});
			},
			setStatus: () => {},
			notify: () => {},
			custom: async () => undefined as never,
		},
		hasUI: true,
	};

	return { handlers, executeTask, executeTodoWrite, ctx, widgetCalls };
}

async function emitToolCall(
	harness: Harness,
	toolName: string,
	input: Record<string, unknown>,
): Promise<{ block?: boolean; reason?: string } | undefined> {
	const handler = harness.handlers.get("tool_call");
	if (!handler) return undefined;
	const result = await handler(
		{
			type: "tool_call",
			toolCallId: "tc-1",
			toolName,
			input,
		},
		harness.ctx,
	);
	return result as { block?: boolean; reason?: string } | undefined;
}

async function startSession(harness: Harness): Promise<void> {
	const sessionStart = harness.handlers.get("session_start");
	if (sessionStart) {
		await sessionStart({}, harness.ctx);
	}
}

describe("taskboard extension parity", () => {
	it("does not block bash when no task exists", async () => {
		const harness = createHarness();
		await startSession(harness);

		const outcome = await emitToolCall(harness, "bash", { command: "echo test" });
		expect(outcome?.block ?? false).toBe(false);
	});

	it("does not block subagent dispatch when no task exists", async () => {
		const harness = createHarness();
		await startSession(harness);

		const outcome = await emitToolCall(harness, "subagent_create", {
			task: "Investigate extension API mismatch and summarize findings",
		});
		expect(outcome?.block ?? false).toBe(false);
	});

	it("auto-starts the first task after todo_write replace", async () => {
		const harness = createHarness();
		const result = await harness.executeTodoWrite(
			"call-1",
			{
				ops: [
					{
						op: "replace",
						phases: [
							{
								name: "Execution",
								tasks: [{ content: "status" }, { content: "diagnostics" }],
							},
						],
					},
				],
			},
			undefined,
			undefined,
			harness.ctx,
		);

		const details = result.details as {
			phases: Array<{ tasks: Array<{ status: string }> }>;
		};
		expect(details.phases[0]?.tasks.map((task) => task.status)).toEqual(["in_progress", "pending"]);
		expect(result.content[0]?.text).toContain("Remaining items (2):");
		expect(result.content[0]?.text).toContain("task-1 status [in_progress] (Execution)");
	});

	it("auto-promotes the next pending task when current task is completed", async () => {
		const harness = createHarness();
		await harness.executeTodoWrite(
			"call-1",
			{
				ops: [
					{
						op: "replace",
						phases: [
							{
								name: "Execution",
								tasks: [{ content: "status" }, { content: "diagnostics" }],
							},
						],
					},
				],
			},
			undefined,
			undefined,
			harness.ctx,
		);

		const result = await harness.executeTodoWrite(
			"call-2",
			{ ops: [{ op: "update", id: "task-1", status: "completed" }] },
			undefined,
			undefined,
			harness.ctx,
		);

		const details = result.details as {
			phases: Array<{ tasks: Array<{ status: string }> }>;
		};
		expect(details.phases[0]?.tasks.map((task) => task.status)).toEqual(["completed", "in_progress"]);
		expect(result.content[0]?.text).toContain("Remaining items (1):");
		expect(result.content[0]?.text).toContain("task-2 diagnostics [in_progress] (Execution)");
	});

	it("keeps only one in_progress task when replace input contains multiples", async () => {
		const harness = createHarness();
		const result = await harness.executeTodoWrite(
			"call-1",
			{
				ops: [
					{
						op: "replace",
						phases: [
							{
								name: "Execution",
								tasks: [
									{ content: "status", status: "in_progress" },
									{ content: "diagnostics", status: "in_progress" },
								],
							},
						],
					},
				],
			},
			undefined,
			undefined,
			harness.ctx,
		);

		const details = result.details as {
			phases: Array<{ tasks: Array<{ status: string }> }>;
		};
		expect(details.phases[0]?.tasks.map((task) => task.status)).toEqual(["in_progress", "pending"]);
	});

	it("renders the widget above the editor", async () => {
		const harness = createHarness();
		await harness.executeTodoWrite(
			"call-1",
			{
				ops: [
					{
						op: "replace",
						phases: [{ name: "Execution", tasks: [{ content: "Map architecture" }] }],
					},
				],
			},
			undefined,
			undefined,
			harness.ctx,
		);

		const lastWidget = [...harness.widgetCalls].reverse().find((call) => call.key === "taskboard" && !call.cleared);
		expect(lastWidget).toEqual({
			key: "taskboard",
			placement: "aboveEditor",
			cleared: false,
		});
	});
});
