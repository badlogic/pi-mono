import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createRegistry,
	defineExtension,
	defineTask,
	type Registry,
	type TaskId,
	type Wake,
} from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { context } from "./session-support.ts";
import { completed, eventually, openTasks } from "./task-support.ts";

const directories = new Set<string>();

afterEach(async () => {
	for (const directory of directories) await rm(directory, { recursive: true, force: true });
	directories.clear();
});

async function sqlitePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-durable-blocked-"));
	directories.add(directory);
	return join(directory, "session.sqlite");
}

/** A task that hangs in its phase while `crashing`, as one killed every time would, and completes otherwise. */
function crashLoop(state: { crashing: boolean; started: number }) {
	return defineTask<null, { phase: "run" }, null>({
		name: "test.crash-loop",
		version: 1,
		initial: () => ({ phase: "run" }),
		phases: {
			run: async (_task, runtime, ctx) => {
				state.started++;
				if (state.crashing)
					await new Promise<void>((resolve) => runtime.signal.addEventListener("abort", () => resolve()));
				else await runtime.commit(() => completed(null), ctx);
			},
		},
		abort: async () => {},
	});
}

async function openWith(path: string, registry: Registry, settings: { restartLimit?: number } = {}) {
	const wakes: Wake[] = [];
	const { harness, reports } = await openTasks(await openNodeSqliteStorage(path), [], {
		registry,
		settings,
		onWake: (wake) => wakes.push(wake),
	});
	return { harness, wakes, reports };
}

describe("tasks that cannot run", () => {
	it("parks a task cut off restartLimit times in a row, shows why, and runs it again on retryTask()", async () => {
		const path = await sqlitePath();
		const state = { crashing: true, started: 0 };
		const registry = createRegistry();
		const Loop = crashLoop(state);
		registry.install(defineExtension({ name: "loop", tasks: [Loop] }));
		let opened = await openWith(path, registry, { restartLimit: 3 });
		const root = await opened.harness.root(context);
		const id = await root.commit((tx) => tx.createTask(Loop, null, { ownership: { kind: "conversation" } }), context);
		// Each open runs the phase, and each close cuts it off: three restarts.
		for (let run = 1; run <= 3; run++) {
			opened.harness.resume();
			await eventually(() => state.started === run);
			await opened.harness.close(context);
			opened = await openWith(path, registry, { restartLimit: 3 });
		}
		const { harness, reports } = opened;
		expect((await harness.getTask(id, context))?.restarts).toBe(3);
		expect(reports.map((error) => (error as Error).cause)).toEqual(["restart_limit"]);
		const inspection = await harness.inspect(context);
		expect(inspection.tasks.find((task) => task.record.id === id)?.state).toEqual({
			kind: "blocked",
			reason: "restart_limit",
		});
		const graph = await harness.taskGraph(context);
		expect(graph.value.tasks[String(id)]?.blocked).toBe("restart_limit");
		// Parked work needs no process: nothing is active.
		expect(harness.wake()).toEqual({ active: false });
		harness.resume();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(state.started).toBe(3);

		state.crashing = false;
		await harness.retryTask(id, context);
		expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("completed");
		expect(state.started).toBe(4);
		graph.dispose();
		await harness.close(context);
	});

	it("still runs the abort handler of a parked task", async () => {
		const path = await sqlitePath();
		const state = { crashing: true, started: 0 };
		const aborted: TaskId[] = [];
		const registry = createRegistry();
		const Loop = defineTask<null, { phase: "run" }, null>({
			...crashLoop(state).definition,
			abort: async (task, runtime, ctx) => {
				aborted.push(task.id);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
			},
		});
		registry.install(defineExtension({ name: "loop", tasks: [Loop] }));
		let opened = await openWith(path, registry, { restartLimit: 1 });
		const id = await (await opened.harness.root(context)).commit(
			(tx) => tx.createTask(Loop, null, { ownership: { kind: "conversation" } }),
			context,
		);
		opened.harness.resume();
		await eventually(() => state.started === 1);
		await opened.harness.close(context);
		opened = await openWith(path, registry, { restartLimit: 1 });
		await opened.harness.abortTask(id, context);
		expect((await opened.harness.waitForTask(id, context)).state.outcome.status).toBe("aborted");
		expect(aborted).toEqual([id]);
		expect(state.started).toBe(1);
		await opened.harness.close(context);
	});

	it("starts the count over when the task makes progress", async () => {
		const path = await sqlitePath();
		let crashing = true;
		let started = 0;
		const Steps = defineTask<null, { phase: "one" } | { phase: "two" }, null>({
			name: "test.steps",
			version: 1,
			initial: () => ({ phase: "one" }),
			phases: {
				one: async (_task, runtime, ctx) => {
					started++;
					if (crashing)
						await new Promise<void>((resolve) => runtime.signal.addEventListener("abort", () => resolve()));
					else await runtime.commit(() => ({ status: "running", checkpoint: { phase: "two" } }), ctx);
				},
				two: async (_task, runtime) => {
					started++;
					await new Promise<void>((resolve) => runtime.signal.addEventListener("abort", () => resolve()));
				},
			},
			abort: async () => {},
		});
		const registry = createRegistry();
		registry.install(defineExtension({ name: "steps", tasks: [Steps] }));
		let opened = await openWith(path, registry, { restartLimit: 2 });
		const id: TaskId = await (await opened.harness.root(context)).commit(
			(tx) => tx.createTask(Steps, null, { ownership: { kind: "conversation" } }),
			context,
		);
		opened.harness.resume();
		await eventually(() => started === 1);
		await opened.harness.close(context);
		opened = await openWith(path, registry, { restartLimit: 2 });
		expect((await opened.harness.getTask(id, context))?.restarts).toBe(1);
		// Progress: phase one commits phase two, which resets the count.
		crashing = false;
		opened.harness.resume();
		await eventually(() => started === 3);
		expect((await opened.harness.getTask(id, context))?.restarts).toBeUndefined();
		await opened.harness.close(context);
	});

	it("shows a task without a definition as blocked, and wakes the host once a registry change unblocks it", async () => {
		const Missing = defineTask<null, { phase: "run" }, null>({
			name: "test.missing",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: { run: (_task, runtime, ctx) => runtime.commit(() => completed(null), ctx) },
			abort: async () => {},
		});
		const registry = createRegistry();
		const path = await sqlitePath();
		const { harness, wakes } = await openWith(path, registry);
		const graph = await harness.taskGraph(context);
		const root = await harness.root(context);
		const id = await root.commit(
			(tx) => tx.createTask(Missing, null, { ownership: { kind: "conversation" } }),
			context,
		);
		harness.resume();
		await eventually(() => graph.value.tasks[String(id)]?.blocked === "missing_task");
		expect(harness.wake()).toEqual({ active: false });
		registry.install(defineExtension({ name: "late", tasks: [Missing] }));
		// The graph follows the registry; the host hears it can run work now.
		await eventually(() => graph.value.tasks[String(id)]?.blocked === undefined);
		await eventually(() => wakes.some((wake) => wake.active));
		expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("completed");
		graph.dispose();
		await harness.close(context);
	});
});
