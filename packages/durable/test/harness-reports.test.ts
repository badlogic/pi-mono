import { createModels, Type } from "@earendil-works/pi-ai";
import {
	type AnyTask,
	createRegistry,
	defineExtension,
	defineTask,
	defineTool,
	Harness,
	MemoryStorage,
	type ReportInfo,
	type SetTimer,
	wrapTool,
} from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { ControlledStorage, context } from "./session-support.ts";
import { completed, eventually } from "./task-support.ts";

type Report = { readonly message: string; readonly info: ReportInfo };

/** Open a Harness with `tasks` installed that collects every report's message and info. */
async function open(
	tasks: readonly AnyTask[],
	options: { readonly storage?: MemoryStorage; readonly onWake?: () => void; readonly setTimer?: SetTimer } = {},
) {
	const registry = createRegistry();
	registry.install(defineExtension({ name: "test", tasks }));
	const reports: Report[] = [];
	const harness = await Harness.open(
		options.storage ?? new MemoryStorage(),
		{
			models: createModels(),
			registry,
			onReport: (error, info) => reports.push({ message: (error as Error).message, info }),
			...(options.onWake === undefined ? {} : { onWake: options.onWake }),
			...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
		},
		context,
	);
	return { harness, registry, reports };
}

describe("reports", () => {
	it("say which task reported a failure or faulted", async () => {
		const Faulty = defineTask<null, { phase: "run" }, null>({
			name: "test.faulty",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: {
				run: async (_task, runtime) => {
					runtime.report(new Error("noted"));
					throw new Error("broken");
				},
			},
			abort: async () => {},
		});
		const { harness, reports } = await open([Faulty]);
		const root = await harness.root(context);
		const id = await root.commit(
			(tx) => tx.createTask(Faulty, null, { ownership: { kind: "conversation" } }),
			context,
		);
		harness.resume();
		expect((await harness.waitForTask(id, context)).state.outcome.status).toBe("faulted");
		await eventually(() => reports.length === 2);
		const task = { source: "task", taskId: id, taskKind: "test.faulty", conversationId: root.id };
		expect(reports).toEqual([
			{ message: "noted", info: task },
			{ message: "broken", info: { ...task, faulted: true } },
		]);
		await harness.close(context);
	});

	it("tell extension, listener, wake, and timer failures from a failed Session", async () => {
		const Sleeper = defineTask<null, { phase: "run" } | { phase: "done" }, null>({
			name: "test.sleeper",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: {
				run: (_task, runtime, ctx) => {
					// The host's setTimer throws: reported, and armed with setTimeout instead.
					runtime.setTimer(() => {}, 10);
					return runtime.sleepUntil(runtime.now() + 60_000, { phase: "done" }, ctx);
				},
				done: (_task, runtime, ctx) => runtime.commit(() => completed(null), ctx),
			},
			abort: async () => {},
		});
		const storage = new ControlledStorage();
		const { harness, registry, reports } = await open([Sleeper], {
			storage,
			onWake: () => {
				throw new Error("alarm");
			},
			setTimer: () => {
				throw new Error("no timers");
			},
		});
		const echo = defineTool({
			name: "echo",
			description: "echo",
			parameters: Type.Object({}),
			execute: async () => ({}),
		});
		registry.install(defineExtension({ name: "tools", tools: [echo] }));
		registry.install(
			defineExtension({ name: "wraps", wraps: [wrapTool(echo, (tool) => ({ ...tool, name: "renamed" }))] }),
		);
		harness.subscribeCommits(() => {
			throw new Error("listener");
		});
		const root = await harness.root(context);
		await root.agent(context);
		await root.commit((tx) => tx.createTask(Sleeper, null, { ownership: { kind: "conversation" } }), context);
		harness.resume();
		await eventually(() =>
			["alarm", "no timers"].every((message) => reports.some((report) => report.message === message)),
		);
		const infoOf = (message: string) => reports.find((report) => report.message === message)?.info;
		expect(infoOf("Wrapper renamed echo to renamed")).toEqual({ source: "extension", conversationId: root.id });
		expect(infoOf("listener")).toEqual({ source: "listener" });
		expect(infoOf("alarm")).toEqual({ source: "wake" });
		expect(infoOf("no timers")).toEqual({ source: "timer" });

		const failure = new Error("disk gone");
		storage.failNextCommit(failure);
		await root.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context).catch(() => {});
		await harness.closed;
		expect(infoOf("disk gone")).toEqual({ source: "session" });
	});
});
