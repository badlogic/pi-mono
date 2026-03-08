import { afterEach, describe, expect, it } from "vitest";

import subagentExtension, { __testing } from "../addons-extensions/subagent.js";
import type { ExtensionAPI } from "../src/core/extensions/types.js";

type EventHandler = (event: unknown, ctx: HarnessContext) => Promise<unknown> | unknown;
type ToolExecute = (
	callId: string,
	args: Record<string, unknown>,
	signal: AbortSignal | undefined,
	onUpdate: unknown,
	ctx: HarnessContext,
) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;

interface HarnessContext {
	sessionManager: { getBranch: () => unknown[] };
	ui: {
		setWidget: (_key: string, _widget: unknown) => void;
		setStatus: (_key: string, _status: string | undefined) => void;
		notify: (_msg: string, _kind: string) => void;
	};
	hasUI: boolean;
	cwd: string;
}

interface Harness {
	handlers: Map<string, EventHandler>;
	tools: Map<string, ToolExecute>;
	ctx: HarnessContext;
	getActiveTools: () => string[];
}

function createHarness(): Harness {
	const handlers = new Map<string, EventHandler>();
	const tools = new Map<string, ToolExecute>();
	const allTools = [
		"read",
		"bash",
		"todo_write",
		"task",
		"subagent",
		"subagent_create",
		"subagent_continue",
		"subagent_list",
		"subagent_clear_finished",
	];
	let activeTools = [
		"read",
		"bash",
		"todo_write",
		"task",
		"subagent",
		"subagent_create",
		"subagent_continue",
		"subagent_list",
		"subagent_clear_finished",
	];

	const api = {
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, handler);
		},
		registerTool: (tool: { name: string; execute: ToolExecute }) => {
			tools.set(tool.name, tool.execute);
		},
		registerCommand: () => {},
		appendEntry: () => {},
		getAllTools: () => allTools.map((name) => ({ name })),
		getActiveTools: () => activeTools,
		setActiveTools: (toolsToSet: string[]) => {
			activeTools = [...toolsToSet];
		},
		sendUserMessage: () => {},
	} as unknown as ExtensionAPI;

	subagentExtension(api);

	const ctx: HarnessContext = {
		sessionManager: {
			getBranch: () => [],
		},
		ui: {
			setWidget: () => {},
			setStatus: () => {},
			notify: () => {},
		},
		hasUI: true,
		cwd: "/tmp",
	};

	return {
		handlers,
		tools,
		ctx,
		getActiveTools: () => [...activeTools],
	};
}

async function emitToolCall(
	harness: Harness,
	toolName: string,
	input: Record<string, unknown>,
): Promise<{ block?: boolean; reason?: string } | undefined> {
	const handler = harness.handlers.get("tool_call");
	if (!handler) throw new Error("tool_call handler not found");
	return (await handler(
		{
			type: "tool_call",
			toolCallId: "tc-1",
			toolName,
			input,
		},
		harness.ctx,
	)) as { block?: boolean; reason?: string } | undefined;
}

async function enableDispatchMode(harness: Harness): Promise<void> {
	const handler = harness.handlers.get("input");
	if (!handler) throw new Error("input handler not found");
	await handler(
		{
			type: "input",
			text: "Please use subagents for this task",
			source: "user",
			images: undefined,
		},
		harness.ctx,
	);
}

async function startSession(harness: Harness): Promise<void> {
	const handler = harness.handlers.get("session_start");
	if (!handler) throw new Error("session_start handler not found");
	await handler(
		{
			type: "session_start",
		},
		harness.ctx,
	);
}

afterEach(() => {
	__testing.resetState();
});

describe("subagent soft-cap guard", () => {
	it("removes legacy subagent tools from the main-agent baseline when the tmux addon starts", async () => {
		const harness = createHarness();

		await startSession(harness);

		expect(harness.getActiveTools()).toEqual(["read", "bash", "task"]);
	});

	it("treats explicit scout-agent requests as dispatch mode triggers", async () => {
		const harness = createHarness();
		const handler = harness.handlers.get("input");
		if (!handler) throw new Error("input handler not found");

		await startSession(harness);
		await handler(
			{
				type: "input",
				text: "spawn 4 scout agents in parallel and explore the codebase",
				source: "user",
				images: undefined,
			},
			harness.ctx,
		);

		expect(harness.getActiveTools()).toEqual([
			"todo_write",
			"subagent_create",
			"subagent_continue",
			"subagent_list",
			"subagent_clear_finished",
		]);
	});

	it("blocks legacy subagent tool calls and points the main agent to the tmux-backed API", async () => {
		const harness = createHarness();

		const outcome = await emitToolCall(harness, "subagent", { agent: "scout", task: "Explore the codebase" });

		expect(outcome).toEqual({
			block: true,
			reason: expect.stringContaining('Legacy subagent tool "subagent" is disabled'),
		});
		expect(outcome?.reason).toContain("subagent_create");
		expect(outcome?.reason).toContain("subagent_continue");
	});

	it("switches dispatch mode to the canonical tmux-backed subagent tools only", async () => {
		const harness = createHarness();

		await startSession(harness);
		await enableDispatchMode(harness);

		expect(harness.getActiveTools()).toEqual([
			"todo_write",
			"subagent_create",
			"subagent_continue",
			"subagent_list",
			"subagent_clear_finished",
		]);
	});

	it("blocks subagent_create at the soft cap when finished main-agent subagents can be reused or cleared", async () => {
		const harness = createHarness();
		__testing.seedAgentStates([
			{ id: 1, status: "running", spawnedBy: "main-agent" },
			{ id: 2, status: "running", spawnedBy: "main-agent" },
			{ id: 3, status: "running", spawnedBy: "main-agent" },
			{ id: 4, status: "running", spawnedBy: "main-agent" },
			{ id: 5, status: "running", spawnedBy: "main-agent" },
			{ id: 6, status: "running", spawnedBy: "main-agent" },
			{ id: 7, status: "done", spawnedBy: "main-agent" },
			{ id: 8, status: "error", spawnedBy: "main-agent" },
		]);

		const outcome = await emitToolCall(harness, "subagent_create", { task: "Investigate the current failure" });

		expect(outcome).toEqual({
			block: true,
			reason: expect.stringContaining("Subagent soft limit reached: 8 tracked main-agent subagents"),
		});
		expect(outcome?.reason).toContain("subagent_continue");
		expect(outcome?.reason).toContain("subagent_clear_finished");
	});

	it("allows overflow when all tracked main-agent subagents are still running", async () => {
		const harness = createHarness();
		__testing.seedAgentStates([
			{ id: 1, status: "running", spawnedBy: "main-agent" },
			{ id: 2, status: "running", spawnedBy: "main-agent" },
			{ id: 3, status: "running", spawnedBy: "main-agent" },
			{ id: 4, status: "running", spawnedBy: "main-agent" },
			{ id: 5, status: "running", spawnedBy: "main-agent" },
			{ id: 6, status: "running", spawnedBy: "main-agent" },
			{ id: 7, status: "running", spawnedBy: "main-agent" },
			{ id: 8, status: "running", spawnedBy: "main-agent" },
		]);

		const outcome = await emitToolCall(harness, "subagent_create", { task: "Investigate the current failure" });

		expect(outcome).toBeUndefined();
	});

	it("clears only finished main-agent subagents", async () => {
		const harness = createHarness();
		const clearTool = harness.tools.get("subagent_clear_finished");
		if (!clearTool) throw new Error("subagent_clear_finished tool not found");

		__testing.seedAgentStates([
			{ id: 1, status: "done", spawnedBy: "main-agent" },
			{ id: 2, status: "error", spawnedBy: "main-agent" },
			{ id: 3, status: "running", spawnedBy: "main-agent" },
			{ id: 4, status: "done", spawnedBy: "user" },
		]);

		const result = await clearTool("call-1", {}, undefined, undefined, harness.ctx);

		expect(result.content[0]?.text).toContain("Cleared 2 completed or errored main-agent subagents.");
		expect(__testing.getAgentStates()).toEqual([
			{ id: 3, status: "running", spawnedBy: "main-agent", task: "Task 3" },
			{ id: 4, status: "done", spawnedBy: "user", task: "Task 4" },
		]);
	});

	it("updates dispatcher mode guidance with the soft-cap policy and cleanup tools", async () => {
		const harness = createHarness();
		const handler = harness.handlers.get("before_agent_start");
		if (!handler) throw new Error("before_agent_start handler not found");

		await enableDispatchMode(harness);

		const result = (await handler(
			{
				type: "before_agent_start",
				systemPrompt: "Base prompt",
			},
			harness.ctx,
		)) as { systemPrompt: string };

		expect(result.systemPrompt).toContain("You have FIVE tools");
		expect(result.systemPrompt).toContain("todo_write");
		expect(result.systemPrompt).toContain("subagent_list");
		expect(result.systemPrompt).toContain("subagent_clear_finished");
		expect(result.systemPrompt).toContain("soft orchestration budget");
		expect(result.systemPrompt).toContain("todo state synchronized");
		expect(result.systemPrompt).toContain("Going beyond 8 tracked main-agent subagents is bad practice");
	});
});
