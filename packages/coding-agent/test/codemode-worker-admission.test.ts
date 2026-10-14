import { Worker } from "node:worker_threads";
import * as codemode from "@earendil-works/pi-codemode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCodemode } from "../src/extensions/codemode/execute.ts";

const terminate = Worker.prototype.terminate;
const terminations = new Map<Worker, (code: number) => void>();

beforeEach(() => {
	vi.spyOn(Worker.prototype, "terminate").mockImplementation(function (this: Worker) {
		this.ref();
		return new Promise<number>((resolve) => {
			terminations.set(this, resolve);
		});
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		[...terminations].map(async ([worker, resolve]) => {
			resolve(await terminate.call(worker));
		}),
	);
	terminations.clear();
});

const run = (code: string, signal?: AbortSignal) =>
	executeCodemode("worker-admission", { code }, signal, undefined, undefined);

describe("codemode worker admission", () => {
	// #10748: fresh sandboxes must share capacity and retain it until actual worker exit.
	it.each(["timeout", "abort", "success"] as const)("bounds surviving workers after %s", async (how) => {
		const once = vi.spyOn(Worker.prototype, "once");
		for (let i = 0; i < 2; i++) {
			const controller = new AbortController();
			const exitListenersBefore = once.mock.calls.filter(([event]) => event === "exit").length;
			const pending = run(
				how === "timeout"
					? '// @options: {"timeout_ms": 200}\nwhile (true) {}'
					: how === "abort"
						? "while (true) {}"
						: "return 1",
				controller.signal,
			);
			if (how === "abort") {
				await vi.waitFor(() =>
					expect(once.mock.calls.filter(([event]) => event === "exit").length).toBeGreaterThan(
						exitListenersBefore,
					),
				);
				controller.abort();
			}
			const result = await pending;
			if (how === "success") expect(result.isError).toBeUndefined();
			else {
				expect(result.isError).toBe(true);
				expect(result.content).toContainEqual({
					type: "text",
					text: expect.stringContaining(how === "timeout" ? "Script timed out:" : "Script aborted:"),
				});
			}
			expect(terminations.size).toBe(i + 1);
		}

		const blocked = await run("return 3");
		expect(blocked).toMatchObject({ isError: true, details: { calls: [] } });
		expect(blocked.content).toContainEqual({
			type: "text",
			text: expect.stringContaining("Codemode worker limit reached (2 workers are still running or shutting down)"),
		});
		expect(terminations.size).toBe(2);

		const aborted = await run("while (true) {}", AbortSignal.abort());
		expect(aborted.isError).toBe(true);
		expect(aborted.content).toContainEqual({ type: "text", text: expect.stringContaining("Script aborted:") });
		expect(terminations.size).toBe(2);

		// Releasing one actual worker, not its result, permits exactly one new execution.
		const [worker, resolve] = [...terminations][0];
		resolve(await terminate.call(worker));
		terminations.delete(worker);
		expect((await run("return 42")).isError).toBeUndefined();
		expect(terminations.size).toBe(2);
	});

	// #10748: timed-out launches resuming after WASM loading must obey the same limit.
	it("bounds workers that start after their results already timed out", async () => {
		const wasm = await codemode.loadQuickJSWasm();
		const loading = Promise.withResolvers<codemode.CodemodeWasmModule>();
		vi.spyOn(codemode, "loadQuickJSWasm").mockReturnValue(loading.promise);
		try {
			const results = await Promise.all(
				Array.from({ length: 3 }, () => run('// @options: {"timeout_ms": 20}\nwhile (true) {}')),
			);
			expect(results.every((result) => result.isError)).toBe(true);
			expect(terminations.size).toBe(0);
			loading.resolve(wasm);
			const blocked = await run("return 1");
			expect(blocked.isError).toBe(true);
			expect(blocked.content).toContainEqual({
				type: "text",
				text: expect.stringContaining("Codemode worker limit reached"),
			});
			expect(terminations.size).toBe(2);
		} finally {
			loading.resolve(wasm);
		}
	});

	// #10748: concurrent callers must not race past the shared admission limit.
	it("admits only two workers from a concurrent burst", async () => {
		const results = await Promise.all(Array.from({ length: 6 }, () => run("return 1")));
		expect(results.filter((result) => !result.isError)).toHaveLength(2);
		expect(results.filter((result) => result.isError)).toHaveLength(4);
		expect(terminations.size).toBe(2);
	});
});
