// Tests for Chord's watch handles: the shared lifecycle through `Watch`, and what `NativeWatch` does differently.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
	BACKGROUND_CONTEXT,
	type Context,
	createContextKey,
	withAbortSignal,
	withContextValue,
} from "../src/context/index.ts";
import { applyImmutable, type Op, track } from "../src/delta/index.ts";
import { MAX_PENDING_OPS } from "../src/delta/pending.ts";
import type { JsonValue } from "../src/json.ts";
import { NativeWatch, Watch, type WatchEnd } from "../src/watch.ts";

const context = BACKGROUND_CONTEXT;

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { promise, resolve: () => resolve() };
}

/** A watch whose detach and reports are recorded. */
function recordedWatch<T>(value: T) {
	const recorded = { detached: 0, reported: [] as unknown[] };
	const watch = new Watch<T>(
		value,
		() => recorded.detached++,
		(error) => recorded.reported.push(error),
	);
	return { watch, recorded };
}

/** A started watch collecting its calls. */
function collectingWatch<T>(value: T) {
	const { watch, recorded } = recordedWatch(value);
	const frames: Array<{ value: T; ops: readonly Op[] }> = [];
	watch.start(async (delivered, ops) => {
		frames.push({ value: delivered, ops });
	});
	return { watch, recorded, frames };
}

/** The end of `closed`, or undefined while the watch is open. */
function endOf(watch: { readonly closed: Promise<WatchEnd> }): { readonly end: WatchEnd | undefined } {
	const settled: { end: WatchEnd | undefined } = { end: undefined };
	void watch.closed.then((end) => {
		settled.end = end;
	});
	return settled;
}

const collect = (() => {
	setFlagsFromString("--expose-gc");
	const gc = runInNewContext("gc") as () => void;
	return async (): Promise<void> => {
		for (let round = 0; round < 5; round++) {
			await flush();
			gc();
		}
	};
})();

describe("Watch delivery", () => {
	it("keeps the acquisition value until start, then delivers the frames since in one call", async () => {
		const { watch } = recordedWatch<JsonValue>({ n: 0, text: "" });
		watch.advance({ n: 1, text: "" }, [["s", ["n"], 1]], context);
		watch.advance(
			{ n: 2, text: "a" },
			[
				["s", ["n"], 2],
				["a", ["text"], "a"],
			],
			context,
		);
		watch.advance({ n: 2, text: "ab" }, [["a", ["text"], "b"]], context);
		await flush();
		expect(watch.value).toEqual({ n: 0, text: "" });

		const frames: Array<{ value: JsonValue; ops: readonly Op[] }> = [];
		watch.start(async (value, ops) => {
			frames.push({ value, ops });
		});
		expect(frames).toEqual([]);
		await flush();
		expect(frames).toEqual([
			{
				value: { n: 2, text: "ab" },
				ops: [
					["s", ["n"], 2],
					["a", ["text"], "ab"],
				],
			},
		]);
		expect(watch.value).toEqual({ n: 2, text: "ab" });
	});

	it("passes a frame's ops on by identity to a listener that keeps up", async () => {
		const { watch } = recordedWatch<JsonValue>(0);
		const delivered: Array<readonly Op[]> = [];
		watch.start(async (_value, ops) => {
			delivered.push(ops);
		});
		const first: readonly Op[] = [["r", 1]];
		const second: readonly Op[] = [["r", 2]];
		watch.advance(1, first, context);
		await flush();
		watch.advance(2, second, context);
		await flush();
		expect(delivered).toHaveLength(2);
		expect(delivered[0]).toBe(first);
		expect(delivered[1]).toBe(second);
	});

	it("never invokes the listener inline", async () => {
		const { watch, frames } = collectingWatch<JsonValue>(0);
		watch.advance(1, [["r", 1]], context);
		expect(frames).toEqual([]);
		await flush();
		expect(frames).toEqual([{ value: 1, ops: [["r", 1]] }]);
	});

	it("awaits each callback and folds frames advanced while one is in flight into the next call", async () => {
		const { watch } = recordedWatch<JsonValue>({ text: "" });
		const gate = deferred();
		const calls: string[] = [];
		const frames: Array<{ value: JsonValue; ops: readonly Op[] }> = [];
		watch.start(async (value, ops) => {
			calls.push(`start ${JSON.stringify(value)}`);
			frames.push({ value, ops });
			if (frames.length === 1) await gate.promise;
			calls.push(`end ${JSON.stringify(value)}`);
		});
		watch.advance({ text: "a" }, [["a", ["text"], "a"]], context);
		await flush();
		watch.advance({ text: "ab" }, [["a", ["text"], "b"]], context);
		watch.advance({ text: "abc" }, [["a", ["text"], "c"]], context);
		await flush();
		expect(calls).toEqual(['start {"text":"a"}']);
		gate.resolve();
		await flush();
		expect(calls).toEqual(['start {"text":"a"}', 'end {"text":"a"}', 'start {"text":"abc"}', 'end {"text":"abc"}']);
		expect(frames[1]).toEqual({ value: { text: "abc" }, ops: [["a", ["text"], "bc"]] });
	});

	it("delivers the newest frame's context, without its abort signal", async () => {
		const { watch } = recordedWatch<JsonValue>(0);
		const key = createContextKey<string>("frame");
		const controller = new AbortController();
		const delivered: Context[] = [];
		watch.start(async (_value, _ops, deliveryContext) => {
			delivered.push(deliveryContext);
		});
		watch.advance(1, [["r", 1]], withContextValue(key, "first", context));
		watch.advance(2, [["r", 2]], withContextValue(key, "second", withAbortSignal(controller.signal, context)));
		await flush();
		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.value(key)).toBe("second");
		expect(delivered[0]?.abortSignal).toBeUndefined();
	});
});

describe("Watch with a slow listener", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("gets one call per batch whose ops turn the previous delivered value into the newest", async () => {
		vi.useFakeTimers();
		type Doc = { entries: Array<{ text: string; status: string }>; tokens: number };
		const tracker = track<Doc>({ entries: [], tokens: 0 });
		const { watch } = recordedWatch<Doc>(tracker.value);
		const commit = (edit: (draft: Doc) => void): void => {
			const change = tracker.beginChange();
			edit(change.state as Doc);
			const prepared = change.prepare();
			tracker.adopt(prepared);
			watch.advance(tracker.value, prepared.ops, context);
		};
		let replica: Doc = tracker.value;
		const calls: Array<{ commits: number; ops: number }> = [];
		let commits = 0;
		watch.start(async (value, ops) => {
			replica = applyImmutable(replica, ops);
			expect(replica).toEqual(value);
			calls.push({ commits, ops: ops.length });
			// A listener taking a second per call, as a slow client would.
			await new Promise((resolve) => setTimeout(resolve, 1000));
		});
		// Ten seconds of a streamed reply at 60 tokens per second, a new entry every second.
		for (let tick = 0; tick < 600; tick++) {
			if (tick % 60 === 0) commit((draft) => void draft.entries.push({ text: "", status: "streaming" }));
			commit((draft) => {
				draft.entries.at(-1)!.text += "tok ";
				draft.tokens++;
			});
			commits++;
			await vi.advanceTimersByTimeAsync(1000 / 60);
		}
		await vi.advanceTimersByTimeAsync(2000);
		expect(replica).toEqual(tracker.value);
		// One call per second, each carrying at most one op per path written since the previous one.
		expect(calls.length).toBeGreaterThanOrEqual(10);
		expect(calls.length).toBeLessThanOrEqual(12);
		for (const call of calls) expect(call.ops).toBeLessThanOrEqual(5);
		await watch.stop();
	});
});

/** Advance `watch` by one frame per element of `{ k: [0, ..., count - 1] }`, each setting its own path. */
function advanceDistinct(watch: Watch<JsonValue>, count: number): JsonValue {
	const values: number[] = [];
	for (let index = 0; index < count; index++) {
		values.push(index);
		watch.advance({ k: [...values] }, [["s", ["k", index], index]], context);
	}
	return { k: values };
}

describe("Watch overflow", () => {
	it(`keeps ${MAX_PENDING_OPS} pending ops after folding and replaces the root past them`, async () => {
		const exact = collectingWatch<JsonValue>({ k: [] });
		advanceDistinct(exact.watch, MAX_PENDING_OPS);
		await flush();
		expect(exact.frames).toHaveLength(1);
		expect(exact.frames[0]?.ops).toHaveLength(MAX_PENDING_OPS);

		const over = collectingWatch<JsonValue>({ k: [] });
		const newest = advanceDistinct(over.watch, MAX_PENDING_OPS + 1);
		await flush();
		expect(over.frames).toEqual([{ value: newest, ops: [["r", newest]] }]);
	});

	it("never folds the in-flight call into an overflow", async () => {
		const { watch } = recordedWatch<JsonValue>({ k: [] });
		const gate = deferred();
		const frames: Array<{ value: JsonValue; ops: readonly Op[] }> = [];
		watch.start(async (value, ops) => {
			frames.push({ value, ops });
			if (frames.length === 1) await gate.promise;
		});
		watch.advance({ k: [], first: true }, [["s", ["first"], true]], context);
		await flush();
		const newest = advanceDistinct(watch, MAX_PENDING_OPS + 1);
		gate.resolve();
		await flush();
		expect(frames).toEqual([
			{ value: { k: [], first: true }, ops: [["s", ["first"], true]] },
			{ value: newest, ops: [["r", newest]] },
		]);
	});

	it("starts folding again after an overflow was delivered", async () => {
		const { watch, frames } = collectingWatch<JsonValue>({ k: [] });
		advanceDistinct(watch, MAX_PENDING_OPS + 1);
		await flush();
		watch.advance({ n: 1 }, [["r", { n: 1 }]], context);
		watch.advance({ n: 2 }, [["s", ["n"], 2]], context);
		await flush();
		expect(frames.at(-1)).toEqual({
			value: { n: 2 },
			ops: [
				["r", { n: 1 }],
				["s", ["n"], 2],
			],
		});
	});
});

describe("Watch retirement", () => {
	it('delivers `[["r", null]]` as the last call and then ends retired', async () => {
		const { watch, frames, recorded } = collectingWatch<JsonValue>(1);
		const settled = endOf(watch);
		watch.advance(2, [["r", 2]], context);
		await flush();
		watch.retire(context);
		watch.advance(3, [["r", 3]], context);
		await flush();
		expect(frames).toEqual([
			{ value: 2, ops: [["r", 2]] },
			{ value: null, ops: [["r", null]] },
		]);
		expect(watch.value).toBeNull();
		expect(settled.end).toEqual({ reason: "retired" });
		expect(recorded.detached).toBe(1);
	});

	it("drops pending frames, also an overflow, for the retirement", async () => {
		for (const pending of [3, MAX_PENDING_OPS + 1]) {
			const { watch } = recordedWatch<JsonValue>({ k: [] });
			advanceDistinct(watch, pending);
			watch.retire(context);
			const frames: Array<{ value: JsonValue; ops: readonly Op[] }> = [];
			watch.start(async (value, ops) => {
				frames.push({ value, ops });
			});
			expect(await watch.closed).toEqual({ reason: "retired" });
			expect(frames).toEqual([{ value: null, ops: [["r", null]] }]);
		}
	});

	it("ends retired only on its source's retirement, never on a null value", async () => {
		const { watch, frames } = collectingWatch<JsonValue>(1);
		const settled = endOf(watch);
		watch.advance(null, [["r", null]], context);
		await flush();
		watch.advance(2, [["r", 2]], context);
		await flush();
		expect(frames).toEqual([
			{ value: null, ops: [["r", null]] },
			{ value: 2, ops: [["r", 2]] },
		]);
		expect(settled.end).toBeUndefined();
		expect(await watch.stop()).toEqual({ reason: "stopped" });
	});

	it("is only available to watches whose values include null", () => {
		const check = (numbers: Watch<number>, documents: Watch<{ n: number } | null>) => {
			// @ts-expect-error `retire` delivers `null`, which a number watch cannot hold.
			numbers.retire(context);
			documents.retire(context);
		};
		expectTypeOf(check).toBeFunction();
	});

	it("discards a retirement still pending when the source ends", async () => {
		const { watch } = recordedWatch<JsonValue>(1);
		watch.retire(context);
		watch.end();
		expect(await watch.closed).toEqual({ reason: "ended" });
		expect(watch.value).toBe(1);
	});
});

describe("Watch ends", () => {
	it("stops idempotently and rejects a repeated or late start", async () => {
		const { watch, recorded } = recordedWatch<JsonValue>(0);
		watch.start(async () => {});
		expect(() => watch.start(async () => {})).toThrow("Watch is already started");
		expect(await watch.stop()).toEqual({ reason: "stopped" });
		expect(await watch.stop()).toEqual({ reason: "stopped" });
		expect(recorded.detached).toBe(1);

		const late = recordedWatch<JsonValue>(0).watch;
		await late.stop();
		expect(() => late.start(async () => {})).toThrow("Watch is stopped");
	});

	it("ends `ended` or `failed` from its source, dropping pending frames", async () => {
		const { watch, frames } = collectingWatch<JsonValue>(0);
		watch.advance(1, [["r", 1]], context);
		watch.end();
		await flush();
		expect(frames).toEqual([]);
		expect(await watch.closed).toEqual({ reason: "ended" });

		const failure = new Error("source failed");
		const failed = recordedWatch<JsonValue>(0).watch;
		failed.end({ error: failure });
		failed.end();
		expect(await failed.closed).toEqual({ reason: "failed", error: failure });
	});

	it("stops future delivery without aborting or awaiting an in-flight callback", async () => {
		const { watch } = recordedWatch<JsonValue>(0);
		const gate = deferred();
		const calls: string[] = [];
		watch.start(async (value) => {
			calls.push(`start ${value}`);
			await gate.promise;
			calls.push(`end ${value}`);
		});
		watch.advance(1, [["r", 1]], context);
		await flush();
		watch.advance(2, [["r", 2]], context);
		expect(await watch.stop()).toEqual({ reason: "stopped" });
		gate.resolve();
		await flush();
		expect(calls).toEqual(["start 1", "end 1"]);
	});

	it("ends `cancelled` when its acquisition signal aborts, also when already aborted", async () => {
		const controller = new AbortController();
		const { watch, recorded } = recordedWatch<JsonValue>(0);
		watch.observeCancellation(controller.signal);
		expect(() => watch.observeCancellation(controller.signal)).toThrow("Watch cancellation is already installed");
		controller.abort();
		expect(await watch.closed).toEqual({ reason: "cancelled" });
		expect(recorded.detached).toBe(1);

		const aborted = recordedWatch<JsonValue>(0).watch;
		aborted.observeCancellation(AbortSignal.abort());
		expect(await aborted.closed).toEqual({ reason: "cancelled" });

		const cancelled = recordedWatch<JsonValue>(0).watch;
		cancelled.cancel();
		expect(await cancelled.closed).toEqual({ reason: "cancelled" });
	});

	it("ends `listener_error` on a throw, reports it, and delivers nothing more", async () => {
		const { watch, recorded } = recordedWatch<JsonValue>(0);
		const failure = new Error("listener failed");
		const gate = deferred();
		const values: JsonValue[] = [];
		watch.start(async (value) => {
			values.push(value);
			await gate.promise;
			throw failure;
		});
		watch.advance(1, [["r", 1]], context);
		await flush();
		watch.advance(2, [["r", 2]], context);
		gate.resolve();
		expect(await watch.closed).toEqual({ reason: "listener_error", error: failure });
		expect(values).toEqual([1]);
		expect(recorded.reported).toEqual([failure]);
		expect(recorded.detached).toBe(1);
	});

	it("wraps a thrown non-Error in an Error", async () => {
		const { watch } = recordedWatch<JsonValue>(0);
		watch.start(() => Promise.reject("plain"));
		watch.advance(1, [["r", 1]], context);
		const end = await watch.closed;
		expect(end.reason).toBe("listener_error");
		expect(end.reason === "listener_error" && end.error.message).toBe("plain");
	});
});

describe("Watch references", () => {
	it("retains neither its source, its listener, nor its signal once ended, while still referenced", async () => {
		/** A watch over a source only its closures reference; `end` ends it before returning. */
		const acquire = async (end: (watch: Watch<JsonValue>) => void) => {
			const source = { value: 1 as JsonValue };
			const controller = new AbortController();
			const watch = new Watch<JsonValue>(
				0,
				() => void source,
				() => void source,
			);
			const listener = async (): Promise<void> => {};
			watch.observeCancellation(controller.signal);
			watch.start(listener);
			watch.advance(1, [["r", 1]], context);
			await flush();
			end(watch);
			return {
				watch,
				source: new WeakRef(source),
				listener: new WeakRef(listener),
				signal: new WeakRef(controller.signal),
			};
		};

		// Control: an open watch keeps its source, so the collections below are real.
		const open = await acquire(() => {});
		await collect();
		expect(open.source.deref()).toBeDefined();
		expect(open.listener.deref()).toBeDefined();
		expect(open.signal.deref()).toBeDefined();
		await open.watch.stop();

		for (const end of [
			(watch: Watch<JsonValue>) => void watch.stop(),
			(watch: Watch<JsonValue>) => watch.cancel(),
			(watch: Watch<JsonValue>) => watch.end(),
			(watch: Watch<JsonValue>) => watch.retire(context),
		]) {
			const ended = await acquire(end);
			await flush();
			await collect();
			expect(ended.source.deref()).toBeUndefined();
			expect(ended.listener.deref()).toBeUndefined();
			expect(ended.signal.deref()).toBeUndefined();
		}
	});

	it("releases its pending queue and leaf index once delivered or ended", async () => {
		/** Two pending frames, folded, whose ops alone reference `payload`; `settle` delivers or ends them. */
		const pending = async (settle: (watch: Watch<JsonValue>, gate: () => void) => Promise<void>) => {
			const payload = { big: "x".repeat(1000) };
			const watch = new Watch<JsonValue>(
				0,
				() => {},
				() => {},
			);
			const gate = deferred();
			let calls = 0;
			watch.start(async () => {
				if (++calls === 1) await gate.promise;
			});
			watch.advance(1, [["s", ["n"], 1]], context);
			await flush();
			watch.advance(2, [["s", ["o"], payload]], context);
			watch.advance(3, [["s", ["n"], 3]], context);
			await settle(watch, gate.resolve);
			return { watch, payload: new WeakRef(payload) };
		};

		const delivered = await pending(async (_watch, gate) => {
			gate();
			await flush();
		});
		await collect();
		expect(delivered.payload.deref()).toBeUndefined();
		expect(delivered.watch.value).toBe(3);

		const stopped = await pending(async (watch) => {
			await watch.stop();
		});
		await collect();
		expect(stopped.payload.deref()).toBeUndefined();
	});
});

describe("NativeWatch", () => {
	it("delivers values by identity in order with a context, never inline", async () => {
		const first = { run: () => 1 };
		const second = { run: () => 2 };
		const watch = new NativeWatch<{ run: () => number }>(
			{ run: () => 0 },
			() => {},
			() => {},
		);
		const key = createContextKey<string>("frame");
		const delivered: Array<{ value: { run: () => number }; frame: string | undefined }> = [];
		watch.start(async (value, deliveryContext) => {
			delivered.push({ value, frame: deliveryContext.value(key) });
		});
		watch.advance(first, withContextValue(key, "first", context));
		watch.advance(second, withContextValue(key, "second", context));
		expect(delivered).toEqual([]);
		await flush();
		expect(delivered).toHaveLength(2);
		expect(delivered[0].value).toBe(first);
		expect(delivered[1].value).toBe(second);
		expect(delivered.map((entry) => entry.frame)).toEqual(["first", "second"]);
		expect(watch.value).toBe(second);
	});

	it("collapses 101 pending values to the newest", async () => {
		const watch = new NativeWatch<number>(
			0,
			() => {},
			() => {},
		);
		for (let n = 1; n <= 101; n++) watch.advance(n, context);
		const values: number[] = [];
		watch.start(async (value) => {
			values.push(value);
		});
		await flush();
		expect(values).toEqual([101]);
	});

	it("collapses 101 pending values to the value of `replace`", async () => {
		const watch = new NativeWatch<string>(
			"",
			() => {},
			() => {},
			() => "replacement",
		);
		for (let n = 1; n <= 101; n++) watch.advance(`value ${n}`, context);
		const values: string[] = [];
		watch.start(async (value) => {
			values.push(value);
		});
		await flush();
		expect(values).toEqual(["replacement"]);
	});

	it("ends with every reason of its lifecycle", async () => {
		const create = () =>
			new NativeWatch<number>(
				0,
				() => {},
				() => {},
			);
		const stopped = create();
		expect(await stopped.stop()).toEqual({ reason: "stopped" });

		const cancelled = create();
		cancelled.observeCancellation(AbortSignal.abort());
		expect(await cancelled.closed).toEqual({ reason: "cancelled" });

		const ended = create();
		ended.end();
		expect(await ended.closed).toEqual({ reason: "ended" });

		const error = new Error("source failed");
		const failed = create();
		failed.end({ error });
		expect(await failed.closed).toEqual({ reason: "failed", error });

		const reported: unknown[] = [];
		const throwing = new NativeWatch<number>(
			0,
			() => {},
			(thrown) => reported.push(thrown),
		);
		const failure = new Error("listener failed");
		throwing.start(() => Promise.reject(failure));
		throwing.advance(1, context);
		expect(await throwing.closed).toEqual({ reason: "listener_error", error: failure });
		expect(reported).toEqual([failure]);
	});

	it("retains neither its source nor its listener once stopped, while still referenced", async () => {
		const acquire = async (stop: boolean) => {
			const source = { value: 1 };
			const watch = new NativeWatch<number>(
				0,
				() => void source,
				() => void source,
			);
			const listener = async (): Promise<void> => {};
			watch.start(listener);
			watch.advance(source.value, context);
			await flush();
			if (stop) await watch.stop();
			return { watch, source: new WeakRef(source), listener: new WeakRef(listener) };
		};

		const open = await acquire(false);
		await collect();
		expect(open.source.deref()).toBeDefined();
		await open.watch.stop();

		const stopped = await acquire(true);
		await collect();
		expect(stopped.source.deref()).toBeUndefined();
		expect(stopped.listener.deref()).toBeUndefined();
		expect(stopped.watch.value).toBe(1);
	});
});
