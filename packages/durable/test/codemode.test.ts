import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { type CodemodeRun, CodemodeSandbox } from "@earendil-works/pi-codemode";
import {
	defineTool,
	type Harness,
	type TaskId,
	type ToolRegistration,
	ToolResultEntry,
	ToolTask,
	type ToolTaskInput,
} from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CodemodeGlobal,
	CodemodeJournalDoc,
	CodemodeRunDoc,
	type CodemodeToolDetails,
	createCodemodeTool,
} from "../src/codemode/codemode.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { allEntries, type ChatSetup, chatSetup, openChat } from "./chat-support.ts";
import { addHooks, addTool } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { aborted, type Deferred, deferred, eventually } from "./task-support.ts";

const Parameters = Type.Object({ text: Type.Optional(Type.String()), id: Type.Optional(Type.Number()) });

function tool(
	name: string,
	execute: ToolRegistration<typeof Parameters>["execute"],
	replay: "safe" | "unsafe" = "unsafe",
) {
	return defineTool({ name, description: name, parameters: Parameters, execute, replay });
}

const DONE = fauxAssistantMessage([fauxText("done")]);

function script(code: string): AssistantMessage {
	return fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "s1" })], { stopReason: "toolUse" });
}

const directories = new Set<string>();
afterEach(async () => {
	for (const directory of directories) await rm(directory, { recursive: true, force: true });
	directories.clear();
});

async function sqlitePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-durable-codemode-"));
	directories.add(directory);
	return join(directory, "session.sqlite");
}

/**
 * A chat with the code mode tool and test tools:
 * - `echo` returns `echo <text>` and counts its runs by text;
 * - `hold` (replay-safe) waits for `holds.gate` while `holds.block` is set, then returns `held <id>`;
 * - `slow` returns `slow <id>` once `slows.release(id)` was called.
 */
function codemodeChat(globals: CodemodeGlobal[] = []) {
	const setup = chatSetup();
	const sandbox = new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024 });
	const vm: { starts: number; onStart?: (run: CodemodeRun) => void } = { starts: 0 };
	const start = sandbox.start.bind(sandbox);
	sandbox.start = (code, options) => {
		vm.starts++;
		const run = start(code, options);
		vm.onStart?.(run);
		return run;
	};
	addTool(setup.registry, createCodemodeTool({ sandbox, globals }));
	const echo = new Map<string, number>();
	addTool(
		setup.registry,
		tool("echo", async (args) => {
			echo.set(args.text ?? "", (echo.get(args.text ?? "") ?? 0) + 1);
			return { output: [{ type: "text", text: `echo ${args.text ?? ""}` }] };
		}),
	);
	const holds = { block: true, reached: deferred(), runs: 0 };
	addTool(
		setup.registry,
		tool(
			"hold",
			async (args, _api, callContext) => {
				holds.runs++;
				if (holds.block) {
					holds.reached.resolve();
					await aborted(callContext.abortSignal!);
				}
				return { output: [{ type: "text", text: `held ${args.id ?? ""}` }] };
			},
			"safe",
		),
	);
	const pauses = { block: true, reached: deferred() };
	addTool(
		setup.registry,
		tool(
			"pause",
			async (_args, _api, callContext) => {
				if (pauses.block) {
					pauses.reached.resolve();
					await aborted(callContext.abortSignal!);
				}
				return { output: [{ type: "text", text: "paused" }] };
			},
			"safe",
		),
	);
	const gates = new Map<number, Deferred>();
	const finished: number[] = [];
	const slows = {
		finished,
		gate: (id: number) => {
			const gate = gates.get(id) ?? deferred();
			gates.set(id, gate);
			return gate;
		},
		release: (id: number) => slows.gate(id).resolve(),
	};
	addTool(
		setup.registry,
		tool("slow", async (args) => {
			await slows.gate(args.id ?? 0).promise;
			finished.push(args.id ?? 0);
			return { output: [{ type: "text", text: `slow ${args.id}` }] };
		}),
	);
	return { setup, sandbox, vm, echo, holds, pauses, slows };
}

async function scriptTask(harness: Harness): Promise<TaskId> {
	const tasks = (await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context)).items;
	return tasks.find((task) => (task.input as ToolTaskInput).kind === "model")!.id;
}

async function nestedCount(harness: Harness): Promise<number> {
	const tasks = (await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context)).items;
	return tasks.filter((task) => (task.input as ToolTaskInput).kind === "nested").length;
}

/** The code mode call's result text. */
async function resultText(setup: ChatSetup, root: Awaited<ReturnType<typeof openChat>>["root"]) {
	void setup;
	const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
	const message = entry.model![0]!;
	return {
		text:
			message.role === "toolResult"
				? message.content.map((item) => (item.type === "text" ? item.text : "")).join("\n")
				: "",
		isError: message.role === "toolResult" && message.isError,
	};
}

/**
 * Run `code` until `holds.reached`, close the Harness (a restart), let `between` change the stored state, then reopen
 * with `hold` no longer blocking and wait for the answer.
 */
async function restart(
	chat: ReturnType<typeof codemodeChat>,
	code: string,
	between: (harness: Harness, task: TaskId) => Promise<void> = async () => {},
	beforeClose: (harness: Harness, task: TaskId) => Promise<void> = async () => {},
) {
	const path = await sqlitePath();
	chat.setup.faux.setResponses([script(code), DONE]);
	let opened = await openChat(await openNodeSqliteStorage(path), chat.setup);
	const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
	await chat.holds.reached.promise;
	await beforeClose(opened.harness, await scriptTask(opened.harness));
	await opened.harness.close(context);
	chat.holds.block = false;
	opened = await openChat(await openNodeSqliteStorage(path), chat.setup);
	await between(opened.harness, await scriptTask(opened.harness));
	opened.harness.resume();
	expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe("done");
	return { ...opened, result: await resultText(chat.setup, opened.root) };
}

describe("durable code mode", () => {
	it("runs a script that calls tools as nested calls, and journals each result before delivering it", async () => {
		const chat = codemodeChat();
		chat.holds.block = false;
		chat.setup.faux.setResponses([
			script(`const a = await tools.echo({ text: "a" }); const b = await tools.echo({ text: "b" }); return [a, b];`),
			DONE,
		]);
		const { harness, root } = await openChat(await openNodeSqliteStorage(await sqlitePath()), chat.setup);
		await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
		expect(await resultText(chat.setup, root)).toEqual({ text: '["echo a","echo b"]', isError: false });
		expect(await nestedCount(harness)).toBe(2);
		await harness.close(context);
	});

	it("resumes a script after a restart without running its finished calls again", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`const a = await tools.echo({ text: "a" });
			const held = await tools.hold({ id: 1 });
			const b = await tools.echo({ text: "b" });
			return [a, held, b, Date.now() > 0];`,
		);
		expect(result).toEqual({ text: '["echo a","held 1","echo b",true]', isError: false });
		expect(Object.fromEntries(chat.echo)).toEqual({ a: 1, b: 1 });
		// The VM ran twice; hold, replay-safe, reran once after the restart.
		expect(chat.vm.starts).toBe(2);
		expect(chat.holds.runs).toBe(2);
		await harness.close(context);
	});

	it("replays results in the order they arrived, not the order the calls were made", async () => {
		const chat = codemodeChat();
		const code = `const order = [];
			await Promise.all([tools.slow({ id: 1 }).then(() => order.push(1)), tools.slow({ id: 2 }).then(() => order.push(2))]);
			await tools.echo({ text: order.join(",") });
			await tools.hold({});
			return order;`;
		// 2 finishes first, then 1.
		chat.slows.release(2);
		void eventually(() => chat.slows.finished.includes(2)).then(() => chat.slows.release(1));
		const { harness, result } = await restart(chat, code);
		expect(result).toEqual({ text: "[2,1]", isError: false });
		expect(Object.fromEntries(chat.echo)).toEqual({ "2,1": 1 });
		await harness.close(context);
	});

	it("journals globals with their results and hands a replay the recorded ones", async () => {
		let counter = 0;
		const globals: CodemodeGlobal[] = [{ name: "next", execute: async () => ++counter }];
		const chat = codemodeChat(globals);
		const { harness, result } = await restart(
			chat,
			`const n = await next(); await tools.hold({}); return [n, await next()];`,
		);
		// The first next() ran once and was replayed from the journal; the second ran after the restart.
		expect(result).toEqual({ text: "[1,2]", isError: false });
		expect(counter).toBe(2);
		await harness.close(context);
	});

	it("keeps the script's clock and randomness across a restart", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`const before = [Date.now(), Math.random()];
			await tools.hold({});
			await tools.echo({ text: String(before[0]) + "/" + String(before[1]) });
			return "ok";`,
		);
		expect(result.text).toBe("ok");
		// One echo: the same arguments, so the rerun admitted no second call.
		expect([...chat.echo.values()]).toEqual([1]);
		await harness.close(context);
	});

	it("ends the call when a resumed script made a different number of calls than before", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`await tools.echo({ text: "a" }); await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const journal = await tx.doc(CodemodeJournalDoc, task);
					journal.entries[0]!.issuedAfter = 7;
				}, context);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("after result 1 it had made 2 calls, where it had made 7");
		await harness.close(context);
	});

	it("ends the call at once when a resumed script waits without making a call it made before", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`await tools.echo({ text: "a" }); await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const journal = await tx.doc(CodemodeJournalDoc, task);
					journal.entries[0]!.id = 99;
				}, context);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("it waits without making call 99");
		// hold, admitted before the restart, resumed on its own; no call was admitted by the replay.
		expect(await nestedCount(harness)).toBe(2);
		await harness.close(context);
	});

	it("ends the call when a resumed script calls a global with other arguments", async () => {
		const chat = codemodeChat([{ name: "next", execute: async () => 1 }]);
		const { harness, result } = await restart(chat, `await next(); await tools.hold({});`, async (opened, task) => {
			await opened.commit(async (tx) => {
				const journal = await tx.doc(CodemodeJournalDoc, task);
				journal.entries[0]!.global!.args = "other";
			}, context);
		});
		expect(result.isError).toBe(true);
		expect(result.text).toContain("call 1 is next");
		await harness.close(context);
	});

	it("admits no call of a diverging replay, even one the script never made before", async () => {
		const chat = codemodeChat();
		// With k set, the replay makes three extra calls after result 1, which the live run did not make; the count in
		// result 1's acknowledgment shows the divergence only after they were issued.
		const { harness, result } = await restart(
			chat,
			`await tools.echo({ text: "a" });
			const extra = load("k") ?? 0;
			for (let i = 0; i < extra; i++) tools.echo({ text: "extra" + i });
			await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: 3 };
				}, context);
			},
			async (opened, task) => {
				await eventually(
					async () => (await opened.snapshot(CodemodeJournalDoc, task, context))?.entries[0]?.issuedAfter === 2,
				);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("after result 1 it had made 5 calls, where it had made 2");
		expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
		expect(await nestedCount(harness)).toBe(2);
		await harness.close(context);
	});

	it("ends the call when a resumed script ends where it went on before", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`await tools.echo({ text: "a" }); if (load("k")) return "early"; await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: true };
				}, context);
			},
			// The live run acknowledged result 1 before the restart: it went on after it.
			async (opened, task) => {
				await eventually(
					async () => (await opened.snapshot(CodemodeJournalDoc, task, context))?.entries[0]?.issuedAfter === 2,
				);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("it ended after result 1, where it went on before");
		await harness.close(context);
	});

	it("ends the call when a resumed script ends before calls the live run made, even without a recorded count", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`await tools.echo({ text: "a" }); if (load("k")) return "early"; await tools.echo({ text: "b" }); await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: true };
					// As if the live run crashed before recording result 1's count.
					const journal = await tx.doc(CodemodeJournalDoc, task);
					delete journal.entries[0]!.issuedAfter;
				}, context);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("it ended after result 1, where it went on before");
		await harness.close(context);
	});

	it("ends the call when a resumed script makes a call an earlier attempt admitted with other arguments", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`await tools.echo({ text: load("k") ?? "a" }); await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: "other" };
					// As if the restart came before the first journal commit: the rerun runs live from the start.
					const journal = await tx.doc(CodemodeJournalDoc, task);
					journal.entries.length = 0;
				}, context);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("different path");
		expect(result.text).toContain("call 1 is tools.echo");
		expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
		await harness.close(context);
	});

	it("records a count the live run never recorded as soon as a replay acknowledges it", async () => {
		const chat = codemodeChat();
		const path = await sqlitePath();
		chat.setup.faux.setResponses([script(`await tools.echo({ text: "a" }); await tools.hold({});`), DONE]);
		let opened = await openChat(await openNodeSqliteStorage(path), chat.setup);
		const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
		await chat.holds.reached.promise;
		await opened.harness.close(context);
		// As if result 1's count was never recorded; hold blocks again after the restart.
		chat.holds.reached = deferred();
		opened = await openChat(await openNodeSqliteStorage(path), chat.setup);
		const task = await scriptTask(opened.harness);
		await opened.harness.commit(async (tx) => {
			delete (await tx.doc(CodemodeJournalDoc, task)).entries[0]!.issuedAfter;
		}, context);
		opened.harness.resume();
		// The replay acknowledges result 1 and goes live; the script waits on hold, and the count is already recorded.
		await chat.holds.reached.promise;
		await eventually(
			async () => (await opened.harness.snapshot(CodemodeJournalDoc, task, context))?.entries[0]?.issuedAfter === 2,
		);
		await opened.harness.close(context);
		chat.holds.block = false;
		opened = await openChat(await openNodeSqliteStorage(path), chat.setup);
		opened.harness.resume();
		expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe("done");
		await opened.harness.close(context);
	});

	it("lists the script's tool calls in its result's details", async () => {
		const chat = codemodeChat();
		addTool(
			chat.setup.registry,
			tool("fails", async () => ({ output: [{ type: "text", text: "permission denied" }], isError: true })),
		);
		chat.setup.faux.setResponses([
			script(
				`await tools.echo({ text: "a" }); try { await tools.fails({}); } catch {} tools.hold({ id: 9 }); return 1;`,
			),
			DONE,
		]);
		const { harness, root } = await openChat(await openNodeSqliteStorage(await sqlitePath()), chat.setup);
		await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
		const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
		const details = (entry.model![0] as { details?: CodemodeToolDetails }).details;
		// A call still running, or not yet launched, when the script ended shows as cancelled.
		expect(details?.calls).toMatchObject([
			{ id: 1, name: "echo", args: '{"text":"a"}', status: "ok" },
			{ id: 2, name: "fails", args: "{}", status: "error", error: "permission denied" },
			{ id: 3, name: "hold", args: '{"id":9}', status: "cancelled" },
		]);
		expect(details?.calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
		await harness.close(context);
	});

	it("aborts a call still running when the script ends", async () => {
		const chat = codemodeChat();
		chat.setup.faux.setResponses([script(`tools.hold({}); await tools.echo({ text: "a" }); return 1;`), DONE]);
		const { harness, root } = await openChat(await openNodeSqliteStorage(await sqlitePath()), chat.setup);
		await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
		expect(await resultText(chat.setup, root)).toEqual({ text: "1", isError: false });
		const tasks = (await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context))
			.items;
		const hold = tasks.find(
			(task) =>
				(task.input as ToolTaskInput).kind === "nested" &&
				(task.input as { call: { name: string } }).call.name === "hold",
		)!;
		expect(chat.holds.runs).toBe(1);
		expect(hold.state).toMatchObject({ status: "terminal", outcome: { status: "aborted" } });
		await harness.close(context);
	});

	it("admits no call once the script has ended, even one it made before ending", async () => {
		const chat = codemodeChat();
		chat.holds.block = false;
		const storage = new ControlledStorage();
		// Hold the fingerprint commit, and so the admission of the script's call, until the script has ended.
		chat.vm.onStart = (run) => {
			const held = storage.holdCommits();
			void run.result.then(() => held.release());
		};
		chat.setup.faux.setResponses([script(`tools.echo({ text: "late" }); return 1;`), DONE]);
		const { harness, root } = await openChat(storage, chat.setup);
		await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
		expect(await resultText(chat.setup, root)).toEqual({ text: "1", isError: false });
		expect(chat.echo.size).toBe(0);
		expect(await nestedCount(harness)).toBe(0);
		await harness.close(context);
	});

	it("checks a rerun's calls against an earlier attempt's before admitting any later call", async () => {
		const chat = codemodeChat();
		// With k set, call 1 has other arguments and call 2 is another tool than before; call 3 would be new.
		const { harness, result } = await restart(
			chat,
			`const k = load("k");
			tools.echo({ text: k ?? "a" });
			if (k) tools.echo({ text: "new" });
			await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: "x" };
					// As if the restart came before the first journal commit.
					(await tx.doc(CodemodeJournalDoc, task)).entries.length = 0;
				}, context);
			},
		);
		expect(result.isError).toBe(true);
		// The first run already made more calls than before.
		expect(result.text).toContain("its first run made 3 calls, where it had made 2");
		expect(await nestedCount(harness)).toBe(2);
		expect(Object.fromEntries(chat.echo)).toEqual({ a: 1 });
		await harness.close(context);
	});

	it("ends the call when a rerun makes a global call where an earlier attempt made a tool call", async () => {
		const chat = codemodeChat([{ name: "pick", execute: async () => 1 }]);
		const { harness, result } = await restart(
			chat,
			`if (load("k")) { await pick(); await tools.echo({ text: "new" }); } else { await tools.hold({}); }`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: true };
				}, context);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("call 1 is pick(), but was tools.hold({})");
		expect(chat.echo.size).toBe(0);
		await harness.close(context);
	});

	it("ends the call when a rerun's first run makes fewer calls than an earlier attempt admitted", async () => {
		// Live, the first run admits hold 1 and hold 2. With k set, it makes only hold 1, and after its result a global and a
		// new tool call: the global's ID is hold 2's key, which no check after the release would see.
		const chat = codemodeChat([{ name: "pick", execute: async () => 1 }]);
		const { harness, result } = await restart(
			chat,
			`const k = load("k");
			const first = tools.hold({ id: 1 });
			if (!k) tools.hold({ id: 2 });
			await first;
			await pick();
			await tools.echo({ text: "new" });`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: true };
				}, context);
			},
			async (opened, task) => {
				await eventually(async () => (await opened.snapshot(CodemodeJournalDoc, task, context))?.firstIssued === 2);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("its first run made 1 calls, where it had made 2");
		expect(chat.echo.size).toBe(0);
		await harness.close(context);
	});

	it("ends the call when a rerun without journal entries ends in its first run, where it went on before", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`if (load("k")) { store("x", 1); return "early"; } await tools.hold({});`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: true };
				}, context);
			},
			async (opened, task) => {
				await eventually(async () => (await opened.snapshot(CodemodeJournalDoc, task, context))?.firstIssued === 1);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("it ended after result 0, where it went on before");
		await harness.close(context);
	});

	it("checks every call a rerun holds before launching any of them", async () => {
		// Live, call 1 is a global that never finishes and call 2 is hold; with k set, call 1 is a new tool call and call 2
		// holds with other arguments. Checking call 1 alone would launch it before call 2's conflict shows.
		const chat = codemodeChat([
			{
				name: "forever",
				execute: async (_args, _api, callContext) => {
					await aborted(callContext.abortSignal!);
					return null;
				},
			},
		]);
		const { harness, result } = await restart(
			chat,
			`const k = load("k");
			if (k) tools.echo({ text: "new" }); else forever();
			await tools.hold({ id: k ? 2 : 1 });`,
			async (opened, task) => {
				await opened.commit(async (tx) => {
					const run = await tx.doc(CodemodeRunDoc, task);
					run.start!.store = { k: true };
				}, context);
			},
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain('call 2 is tools.hold({"id":2}), but was tools.hold({"id":1})');
		expect(chat.echo.size).toBe(0);
		expect(await nestedCount(harness)).toBe(1);
		await harness.close(context);
	});

	it("keeps a global's undefined result undefined, live and replayed", async () => {
		const chat = codemodeChat([{ name: "nothing", execute: async () => undefined }]);
		const { harness, result } = await restart(
			chat,
			`const before = await nothing(); await tools.hold({}); return [before === undefined, (await nothing()) === undefined];`,
		);
		expect(result).toEqual({ text: "[true,true]", isError: false });
		await harness.close(context);
	});

	it("rejects a failed tool call with its error text and structured output", async () => {
		const chat = codemodeChat();
		addTool(
			chat.setup.registry,
			tool("fails", async () => ({ output: [{ type: "text", text: "permission denied" }], isError: true })),
		);
		chat.holds.block = false;
		chat.setup.faux.setResponses([
			script(`try { await tools.fails({}); } catch (e) { return [e.message, e.structuredOutput]; }`),
			DONE,
		]);
		const { harness, root } = await openChat(await openNodeSqliteStorage(await sqlitePath()), chat.setup);
		await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
		expect(await resultText(chat.setup, root)).toEqual({
			text: '["permission denied","permission denied"]',
			isError: false,
		});
		await harness.close(context);
	});

	it("delivers a result only after its journal commit", async () => {
		const storage = new ControlledStorage();
		const seen: string[] = [];
		const chat = codemodeChat([
			{
				name: "first",
				execute: async () => {
					seen.push("first");
					// The next commit is this result's journal commit: it never lands.
					storage.failNextCommit(new Error("lost"));
					return 1;
				},
			},
			{
				name: "second",
				execute: async () => {
					seen.push("second");
					return 2;
				},
			},
		]);
		chat.holds.block = false;
		chat.setup.faux.setResponses([script(`await first(); await second();`), DONE]);
		const { harness, root } = await openChat(storage, chat.setup);
		await root.submit({ type: "input", content: "go" }, context);
		await eventually(() => seen.includes("first"));
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(seen).toEqual(["first"]);
		await harness.close(context).catch(() => {});
	});

	it("refuses to resume when the sandbox's fingerprint or the code mode version changed", async () => {
		for (const field of ["fingerprint", "version"] as const) {
			const chat = codemodeChat();
			const { harness, result } = await restart(
				chat,
				`await tools.hold({}); await tools.echo({ text: "late" });`,
				async (opened, task) => {
					await opened.commit(async (tx) => {
						const run = await tx.doc(CodemodeRunDoc, task);
						if (field === "fingerprint") run.start!.fingerprint = "another sandbox";
						else run.start!.version = 0;
					}, context);
				},
			);
			expect(result.isError).toBe(true);
			expect(result.text).toContain("cannot resume");
			expect(chat.echo.size).toBe(0);
			await harness.close(context);
		}
	});

	it("times a script out across a restart, without admitting new calls", async () => {
		const chat = codemodeChat();
		const { harness, result } = await restart(
			chat,
			`// @options: {"timeout_ms": 300}
			await tools.hold({}); await tools.echo({ text: "late" });`,
			() => new Promise((resolve) => setTimeout(resolve, 400)),
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("deadline passed");
		expect(chat.echo.size).toBe(0);
		expect(chat.vm.starts).toBe(1);
		await harness.close(context);
	});

	it("returns a decided outcome after a restart without running the script again", async () => {
		const chat = codemodeChat();
		const path = await sqlitePath();
		chat.holds.block = false;
		chat.setup.faux.setResponses([script(`return "first"`), DONE]);
		// Stop after execute() returned, so after the outcome is stored, and before the result commits.
		const stopped = { block: true, reached: deferred() };
		addHooks(chat.setup.registry, ToolTask, {
			afterTool: async (call, _result, _api, hookContext) => {
				if (call.name !== "codemode" || !stopped.block) return undefined;
				stopped.reached.resolve();
				await aborted(hookContext.abortSignal!);
				return undefined;
			},
		});
		let opened = await openChat(await openNodeSqliteStorage(path), chat.setup);
		const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
		await stopped.reached.promise;
		const task = await scriptTask(opened.harness);
		expect((await opened.harness.snapshot(CodemodeRunDoc, task, context))?.result).toBeDefined();
		await opened.harness.close(context);
		stopped.block = false;
		opened = await openChat(await openNodeSqliteStorage(path), chat.setup);
		opened.harness.resume();
		expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe("done");
		expect(await resultText(chat.setup, opened.root)).toEqual({ text: "first", isError: false });
		expect(chat.vm.starts).toBe(1);
		await opened.harness.close(context);
	});

	it("keeps store() values per conversation, as of a fork's entry", async () => {
		const chat = codemodeChat();
		chat.holds.block = false;
		chat.setup.faux.setResponses([
			script(`store("k", 1); return load("k")`),
			DONE,
			script(`return [load("k") ?? null]`),
			DONE,
		]);
		const { harness, root } = await openChat(await openNodeSqliteStorage(await sqlitePath()), chat.setup);
		await (await root.submit({ type: "input", content: "first" }, context)).wait(context);
		const firstUser = (await allEntries(root)).find((entry) => entry.kind === "pi.user")!;
		await (await root.submit({ type: "input", content: "second" }, context)).wait(context);
		const results = (await allEntries(root)).filter((entry) => ToolResultEntry.is(entry));
		const texts = results.map((entry) => (entry.model![0] as { content: { text: string }[] }).content[0]!.text);
		expect(texts).toEqual(["1", "[1]"]);
		// A fork at the first input is from before the first script stored anything.
		chat.setup.faux.setResponses([script(`return [load("k") ?? null]`), DONE]);
		const fork = await root.fork(firstUser.id, { ownership: { kind: "ownerless" } }, context);
		await (await fork.submit({ type: "input", content: "fork" }, context)).wait(context);
		const forkResult = (await allEntries(fork)).filter((entry) => ToolResultEntry.is(entry)).at(-1)!;
		expect((forkResult.model![0] as { content: { text: string }[] }).content[0]!.text).toBe("[null]");
		await harness.close(context);
	});

	it("journals results that finish together in one commit", async () => {
		const release = deferred();
		let waiting = 0;
		const chat = codemodeChat([
			{
				name: "wait",
				execute: async () => {
					if (++waiting === 50) release.resolve();
					await release.promise;
					return null;
				},
			},
		]);
		chat.holds.block = false;
		chat.setup.faux.setResponses([
			script(`return (await Promise.all(Array.from({ length: 50 }, () => wait()))).length`),
			DONE,
		]);
		const { harness, root } = await openChat(await openNodeSqliteStorage(await sqlitePath()), chat.setup);
		let journalCommits = 0;
		harness.subscribeCommits((publication) => {
			for (const change of publication.changes) {
				if (change.type === "document" && change.record.kind === "pi.codemode.journal") journalCommits++;
			}
		});
		await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
		expect(await resultText(chat.setup, root)).toEqual({ text: "50", isError: false });
		// The journal's creation and a few groups, not one commit per result (51).
		expect(journalCommits).toBeLessThan(10);
		await harness.close(context);
	});
});
