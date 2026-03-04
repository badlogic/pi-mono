import { describe, expect, it } from "vitest";
import taskboardExtension from "../addons-extensions/taskboard.js";
import type { ExtensionAPI } from "../src/core/extensions/types.js";

type EventHandler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

type TaskToolExecute = (
	callId: string,
	args: Record<string, unknown>,
	signal: AbortSignal | undefined,
	onUpdate: unknown,
	ctx: unknown,
) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;

interface Harness {
	handlers: Map<string, EventHandler>;
	executeTask: TaskToolExecute;
	ctx: {
		sessionManager: { getBranch: () => unknown[] };
		ui: {
			setWidget: (_key: string, _widget: unknown) => void;
			setStatus: (_key: string, _status: string | undefined) => void;
			notify: (_msg: string, _kind: string) => void;
		};
		hasUI: boolean;
	};
}

function createHarness(): Harness {
	const handlers = new Map<string, EventHandler>();
	let executeTask: TaskToolExecute | undefined;

	const api = {
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, handler);
		},
		registerTool: (tool: { name: string; execute: TaskToolExecute }) => {
			if (tool.name === "task") executeTask = tool.execute;
		},
		registerCommand: () => {},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;

	taskboardExtension(api);

	if (!executeTask) {
		throw new Error("task tool was not registered");
	}

	const ctx = {
		sessionManager: {
			getBranch: () => [],
		},
		ui: {
			setWidget: () => {},
			setStatus: () => {},
			notify: () => {},
		},
		hasUI: true,
	};

	return { handlers, executeTask, ctx };
}

async function emitToolCall(
	harness: Harness,
	toolName: string,
	input: Record<string, unknown>,
): Promise<{ block?: boolean; reason?: string }> {
	const handler = harness.handlers.get("tool_call");
	if (!handler) throw new Error("tool_call handler not found");
	const result = await handler(
		{
			type: "tool_call",
			toolCallId: "tc-1",
			toolName,
			input,
		},
		harness.ctx,
	);
	return result as { block?: boolean; reason?: string };
}

async function startSession(harness: Harness): Promise<void> {
	const sessionStart = harness.handlers.get("session_start");
	if (sessionStart) {
		await sessionStart({}, harness.ctx);
	}
}

async function listTasks(harness: Harness): Promise<{
	text: string;
	tasks: Array<{ id: number; text: string; status: string; priority: string; category?: string }>;
}> {
	const result = await harness.executeTask("call-1", { action: "list" }, undefined, undefined, harness.ctx);
	const textPart = result.content.find((part) => part.type === "text");
	const details = result.details as {
		tasks: Array<{ id: number; text: string; status: string; priority: string; category?: string }>;
	};
	return {
		text: textPart?.text ?? "",
		tasks: details.tasks,
	};
}

describe("taskboard extension guard", () => {
	it("does not block bash when no tasks exist and auto-creates an in-progress task", async () => {
		const harness = createHarness();
		await startSession(harness);

		const outcome = await emitToolCall(harness, "bash", { command: "echo test" });
		expect(outcome.block).toBe(false);

		const list = await listTasks(harness);
		expect(list.tasks).toHaveLength(1);
		expect(list.tasks[0].status).toBe("in-progress");
		expect(list.text.toLowerCase()).toContain("echo test");
	});

	it("auto-creates an in-progress subagent task when dispatching without active work", async () => {
		const harness = createHarness();
		await startSession(harness);
		const outcome = await emitToolCall(harness, "subagent_create", {
			task: "Investigate extension API mismatch and summarize findings",
		});
		expect(outcome.block).toBe(false);

		const list = await listTasks(harness);
		expect(list.tasks).toHaveLength(1);
		expect(list.tasks[0].status).toBe("in-progress");
		expect(list.tasks[0].category).toBe("subagent");
	});

	it("promotes an existing pending task to in-progress instead of creating a new one", async () => {
		const harness = createHarness();
		await startSession(harness);

		await harness.executeTask(
			"call-2",
			{ action: "add", text: "Create integration tests for queue draining" },
			undefined,
			undefined,
			harness.ctx,
		);

		const outcome = await emitToolCall(harness, "write", {
			path: "/tmp/demo.txt",
			content: "hello",
		});
		expect(outcome.block).toBe(false);

		const list = await listTasks(harness);
		expect(list.tasks).toHaveLength(1);
		expect(list.tasks[0].status).toBe("in-progress");
	});
});
