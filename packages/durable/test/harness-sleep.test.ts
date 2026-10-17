import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTask, MemoryStorage, type Storage, type TaskId, type Wake } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { context, flush } from "./session-support.ts";
import { aborted, abortedWith, completed, eventually, openTasks } from "./task-support.ts";

const directories = new Set<string>();

afterEach(async () => {
	for (const directory of directories) await rm(directory, { recursive: true, force: true });
	directories.clear();
});

async function sqlitePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-durable-sleep-"));
	directories.add(directory);
	return join(directory, "session.sqlite");
}

type NapState = { phase: "start" } | { phase: "after"; slept: number };

/** Sleeps `delay` ms on the Harness clock, then completes with the time it resumed at. */
function napTask(delay: number, runs: { after: number } = { after: 0 }) {
	return defineTask<null, NapState, number>({
		name: "test.nap",
		version: 1,
		initial: () => ({ phase: "start" }),
		phases: {
			start: async (_task, runtime, ctx) => {
				await runtime.sleepUntil(runtime.now() + delay, { phase: "after", slept: delay }, ctx);
			},
			after: async (_task, runtime, ctx) => {
				runs.after++;
				const resumed = runtime.now();
				await runtime.commit(() => completed(resumed), ctx);
			},
		},
		abort: async (_task, runtime, ctx) => {
			await runtime.commit(() => abortedWith("test"), ctx);
		},
	});
}

async function startNap(harness: Awaited<ReturnType<typeof openTasks>>["harness"], task: ReturnType<typeof napTask>) {
	const root = await harness.root(context);
	return root.commit((tx) => tx.createTask(task, null, { ownership: { kind: "conversation" } }), context);
}

async function stateOf(harness: Awaited<ReturnType<typeof openTasks>>["harness"], id: TaskId) {
	return (await harness.getTask(id, context))?.state;
}

/** Let microtasks and a few timer turns run. */
async function settle(): Promise<void> {
	await flush();
	await new Promise((resolve) => setTimeout(resolve, 20));
	await flush();
}

describe("sleeping tasks", () => {
	it("sleeps without an invocation and resumes at its checkpoint once due", async () => {
		let clock = 1_000;
		const wakes: Wake[] = [];
		const runs = { after: 0 };
		const Nap = napTask(1_000, runs);
		const { harness } = await openTasks(new MemoryStorage(), [Nap], {
			now: () => clock,
			onWake: (wake) => wakes.push(wake),
		});
		const graph = await harness.taskGraph(context);
		const id = await startNap(harness, Nap);
		harness.resume();
		await eventually(async () => (await stateOf(harness, id))?.status === "sleeping");
		expect(await stateOf(harness, id)).toEqual({
			status: "sleeping",
			checkpoint: { phase: "after", slept: 1_000 },
			until: 2_000,
		});
		const inspection = await harness.inspect(context);
		expect(inspection.tasks.find((task) => task.record.id === id)?.state).toEqual({ kind: "sleeping", until: 2_000 });
		expect(graph.value.tasks[String(id)]?.state).toEqual({ status: "sleeping", phase: "after", until: 2_000 });
		expect(harness.wake()).toEqual({ active: false, at: 2_000 });
		await settle();
		expect(wakes.at(-1)).toEqual({ active: false, at: 2_000 });

		// Early and repeated wakes run nothing.
		clock = 1_999;
		harness.resume();
		harness.resume();
		await settle();
		expect(runs.after).toBe(0);
		expect((await stateOf(harness, id))?.status).toBe("sleeping");

		clock = 2_000;
		harness.resume();
		harness.resume();
		const receipt = await harness.waitForTask(id, context);
		expect(receipt.state.outcome).toEqual({ status: "completed", result: 2_000 });
		expect(runs.after).toBe(1);
		await settle();
		expect(harness.wake()).toEqual({ active: false });
		expect(wakes.at(-1)).toEqual({ active: false });
		// Only changes: idle at open, running, asleep until 2000, running again, idle.
		for (let index = 1; index < wakes.length; index++) expect(wakes[index]).not.toEqual(wakes[index - 1]);
		expect(wakes[0]).toEqual({ active: false });
		expect(wakes).toContainEqual({ active: true });
		expect(wakes).toContainEqual({ active: false, at: 2_000 });
		graph.dispose();
		await harness.close(context);
	});

	it("keeps a sleep across reopen", async () => {
		const path = await sqlitePath();
		let clock = 1_000;
		const Nap = napTask(60_000);
		const open = async (storage: Storage) => openTasks(storage, [Nap], { now: () => clock, onWake: () => {} });
		let { harness } = await open(await openNodeSqliteStorage(path));
		const id = await startNap(harness, Nap);
		harness.resume();
		await eventually(async () => (await stateOf(harness, id))?.status === "sleeping");
		await harness.close(context);

		({ harness } = await open(await openNodeSqliteStorage(path)));
		// Known from storage before scheduling starts.
		expect(harness.wake()).toEqual({ active: false, at: 61_000 });
		harness.resume();
		await settle();
		expect((await stateOf(harness, id))?.status).toBe("sleeping");
		await harness.close(context);

		clock = 61_000;
		({ harness } = await open(await openNodeSqliteStorage(path)));
		expect(harness.wake()).toEqual({ active: true });
		harness.resume();
		expect((await harness.waitForTask(id, context)).state.outcome).toEqual({ status: "completed", result: 61_000 });
		await harness.close(context);
	});

	it("resumes a due sleep with a timer when there is no onWake", async () => {
		const Nap = napTask(30);
		const { harness } = await openTasks(new MemoryStorage(), [Nap]);
		const id = await startNap(harness, Nap);
		const started = Date.now();
		// Only this call: the timer wakes the task.
		harness.resume();
		const receipt = await harness.waitForTask(id, context);
		expect(receipt.state.outcome.status).toBe("completed");
		expect(Date.now() - started).toBeGreaterThanOrEqual(25);
		await harness.close(context);
	});

	it("arms its timers through setTimer: a sleep's in the foreground, a declined background one is not needed", async () => {
		let clock = 1_000;
		const armed: { readonly delayMs: number; readonly background: boolean; readonly callback: () => void }[] = [];
		const Nap = napTask(500);
		const { harness } = await openTasks(new MemoryStorage(), [Nap], {
			now: () => clock,
			setTimer: (callback, delayMs, options) => {
				armed.push({ delayMs, background: options.background, callback });
				// Declines background timers, as a host that must hibernate would.
				return options.background ? undefined : () => {};
			},
		});
		const id = await startNap(harness, Nap);
		harness.resume();
		await eventually(() => armed.some((timer) => !timer.background && timer.delayMs === 500));
		expect((await stateOf(harness, id))?.status).toBe("sleeping");
		clock = 1_500;
		armed.find((timer) => !timer.background && timer.delayMs === 500)!.callback();
		expect((await harness.waitForTask(id, context)).state.outcome).toEqual({ status: "completed", result: 1_500 });
		await harness.close(context);
	});

	it("disarms an invocation's timers when it ends", async () => {
		const disarmed: number[] = [];
		const fired: string[] = [];
		const Timed = defineTask<null, { phase: "run" }, null>({
			name: "test.timed",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: {
				run: async (_task, runtime, ctx) => {
					runtime.setTimer(() => fired.push("late"), 60_000);
					await runtime.commit(() => completed(null), ctx);
				},
			},
			abort: async () => {},
		});
		let next = 0;
		const { harness } = await openTasks(new MemoryStorage(), [Timed], {
			setTimer: (_callback, delayMs) => {
				const id = next++;
				return delayMs === 60_000 ? () => disarmed.push(id) : () => {};
			},
		});
		const root = await harness.root(context);
		const id = await root.commit(
			(tx) => tx.createTask(Timed, null, { ownership: { kind: "conversation" } }),
			context,
		);
		harness.resume();
		await harness.waitForTask(id, context);
		await eventually(() => disarmed.length === 1);
		expect(fired).toEqual([]);
		await harness.close(context);
	});

	it("keeps no timer with onWake", async () => {
		const Nap = napTask(10);
		const { harness } = await openTasks(new MemoryStorage(), [Nap], { onWake: () => {} });
		const id = await startNap(harness, Nap);
		harness.resume();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect((await stateOf(harness, id))?.status).toBe("sleeping");
		expect(harness.wake()).toEqual({ active: true });
		harness.resume();
		expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("completed");
		await harness.close(context);
	});

	it("runs the abort handler of a sleeping task without waiting for its time", async () => {
		const clock = 1_000;
		const Nap = napTask(60_000);
		const { harness } = await openTasks(new MemoryStorage(), [Nap], { now: () => clock, onWake: () => {} });
		const id = await startNap(harness, Nap);
		harness.resume();
		await eventually(async () => (await stateOf(harness, id))?.status === "sleeping");
		await harness.abortTask(id, context);
		expect((await harness.waitForTask(id, context)).state.outcome).toEqual({ status: "aborted", reason: "test" });
		await harness.close(context);
	});

	it("rejects a sleep until something that is not a time, and a sleep in an abort handler", async () => {
		const errors: string[] = [];
		const Invalid = defineTask<null, { phase: "run" } | { phase: "next" }, null>({
			name: "test.invalid-sleep",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: {
				run: async (_task, runtime, ctx) => {
					for (const until of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
						await runtime
							.sleepUntil(until, { phase: "next" }, ctx)
							.catch((error: unknown) => errors.push((error as Error).message));
					}
					await runtime.commit(() => completed(null), ctx);
				},
				next: async () => {},
			},
			abort: async () => {},
		});
		const Aborting = defineTask<null, { phase: "run" }, null>({
			name: "test.sleep-in-abort",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: { run: (_task, runtime) => aborted(runtime.signal) },
			abort: async (_task, runtime, ctx) => {
				await runtime
					.sleepUntil(runtime.now() + 10, { phase: "run" }, ctx)
					.catch((error: unknown) => errors.push((error as Error).message));
				await runtime.commit(() => abortedWith("test"), ctx);
			},
		});
		const { harness } = await openTasks(new MemoryStorage(), [Invalid, Aborting]);
		const root = await harness.root(context);
		const id = await root.commit(
			(tx) => tx.createTask(Invalid, null, { ownership: { kind: "conversation" } }),
			context,
		);
		const aborting = await root.commit(
			(tx) => tx.createTask(Aborting, null, { ownership: { kind: "conversation" } }),
			context,
		);
		harness.resume();
		expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("completed");
		await harness.abortTask(aborting, context);
		expect((await harness.waitForTask(aborting, context)).state.outcome.status).toBe("aborted");
		expect(errors).toEqual([
			`Task ${id} cannot sleep until NaN: not a time in milliseconds`,
			`Task ${id} cannot sleep until -1: not a time in milliseconds`,
			`Task ${id} cannot sleep until Infinity: not a time in milliseconds`,
			`Abort handler of task ${aborting} cannot sleep`,
		]);
		await harness.close(context);
	});

	it("does not count a task without a definition as active", async () => {
		const Nap = napTask(10);
		const Missing = napTask(10);
		const { harness } = await openTasks(new MemoryStorage(), []);
		const root = await harness.root(context);
		// Created through a token the registry does not hold: nothing can run it.
		await root.commit((tx) => tx.createTask(Missing, null, { ownership: { kind: "conversation" } }), context);
		expect(harness.wake()).toEqual({ active: false });
		harness.resume();
		await settle();
		expect(harness.wake()).toEqual({ active: false });
		void Nap;
		await harness.close(context);
	});

	it("reports a throwing onWake and keeps calling it for later changes", async () => {
		let clock = 1_000;
		const wakes: Wake[] = [];
		const failure = new Error("alarm failed");
		const Nap = napTask(1_000);
		const { harness, reports } = await openTasks(new MemoryStorage(), [Nap], {
			now: () => clock,
			onWake: (wake) => {
				wakes.push(wake);
				if (wake.at !== undefined) throw failure;
			},
		});
		const id = await startNap(harness, Nap);
		harness.resume();
		await eventually(async () => (await stateOf(harness, id))?.status === "sleeping");
		await settle();
		expect(reports.length).toBeGreaterThan(0);
		expect(reports.every((error) => error === failure)).toBe(true);
		clock = 2_000;
		harness.resume();
		await harness.waitForTask(id, context);
		await settle();
		expect(wakes.at(-1)).toEqual({ active: false });
		await harness.close(context);
	});
});
