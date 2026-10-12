import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it } from "vitest";
import { applyImmutable } from "../src/delta/index.ts";
import {
	type Ctx,
	cell,
	createHost,
	derivation,
	isChordError,
	listener,
	local,
	method,
	resource,
	type StateEvent,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function emitter<E>() {
	const listeners = new Set<(event: E) => void>();
	return {
		emit: (event: E) => {
			for (const fn of listeners) fn(event);
		},
		subscribe: (fn: (event: E) => void) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		get size() {
			return listeners.size;
		},
	};
}

const Item = Type.Object({ id: Type.Number(), label: Type.String() });
const Items = Type.Object({ items: Type.Array(Item), count: Type.Number() });

const List = local("t.list", {
	version: 1,
	input: Type.Object({}),
	members: {
		list: Items,
		labels: Type.Array(Type.String()),
		push: method(Item, Type.Null()),
		set: method(Items, Type.Null()),
	},
});

function serveList(host: ReturnType<typeof createHost>) {
	host.serve(List, (_input, _principal, self) => {
		const state = self.state({ list: cell(Items, { items: [], count: 0 }) });
		const derived = self.derive({
			labels: derivation([state.list], (list) => list.items.map((item) => item.label)),
		});
		return {
			list: state.list,
			labels: derived.labels,
			push: (item: { id: number; label: string }, ctx: Ctx) => {
				state.list.change(ctx, (draft) => {
					draft.items.push(item);
					draft.count += 1;
				});
				return null;
			},
			set: (value: { items: { id: number; label: string }[]; count: number }, ctx: Ctx) => {
				state.list.replace(ctx, value);
				return null;
			},
		};
	});
}

describe("state cells", () => {
	it("publishes snapshots then exact ops; derivations follow", async () => {
		const host = createHost({ onError: () => {} });
		serveList(host);
		const handle = host.get(List, {});
		const events: StateEvent<unknown>[] = [];
		const labels: StateEvent<unknown>[] = [];
		handle.list.events((event) => events.push(event));
		handle.labels.events((event) => labels.push(event));
		await handle.push({ id: 1, label: "a" });
		// Subscribed while loading: an empty snapshot, the hydrated value as a reset, then exact ops.
		assert.deepEqual(events[0], { type: "snap", value: undefined });
		assert.deepEqual(events[1], { type: "reset", value: { items: [], count: 0 } });
		const ops = events[2]?.type === "ops" ? events[2].ops.map((op) => JSON.stringify(op)).sort() : [];
		assert.deepEqual(ops, ['["p",["items"],0,0,[{"id":1,"label":"a"}]]', '["s",["count"],1]']);
		assert.deepEqual(events[2]?.value, { items: [{ id: 1, label: "a" }], count: 1 });
		assert.deepEqual(handle.labels.value, ["a"]);
		assert.deepEqual(
			labels.map((event) => event.type),
			["snap", "reset", "ops"],
		);
		await handle.set({ items: [], count: 0 });
		assert.deepEqual(handle.labels.value, []);
	});

	it("supports primitive cells and value-returning changes", async () => {
		const host = createHost({ onError: () => {} });
		const Counter = local("t.prim", {
			version: 1,
			input: Type.Object({}),
			members: { n: Type.Number(), inc: method(Type.Null(), Type.Number()) },
		});
		host.serve(Counter, (_input, _principal, self) => {
			const state = self.state({ n: cell(Type.Number(), 0) });
			return {
				n: state.n,
				inc: (_args: null, ctx: Ctx) => {
					state.n.change(ctx, (n) => n + 1);
					return state.n.value;
				},
			};
		});
		const handle = host.get(Counter, {});
		const values: unknown[] = [];
		await handle.ready;
		const events: StateEvent<unknown>[] = [];
		handle.n.events((event) => events.push(event));
		handle.n.subscribe((value) => values.push(value));
		assert.equal(await handle.inc(null), 1);
		assert.equal(await handle.inc(null), 2);
		assert.deepEqual(values, [0, 1, 2]);
		assert.deepEqual(events, [
			{ type: "snap", value: 0 },
			{ type: "ops", ops: [["r", 1]], value: 1 },
			{ type: "ops", ops: [["r", 2]], value: 2 },
		]);
	});

	it("rejects a returned value that does not fit the schema, even outside dev mode", async () => {
		const host = createHost({ onError: () => {} });
		const Box = local("t.box", {
			version: 1,
			input: Type.Object({}),
			members: { put: method(Type.Null(), Type.Null()) },
		});
		host.serve(Box, (_input, _principal, self) => {
			const state = self.state({ list: cell(Type.Array(Type.Number()), []) });
			return {
				put: (_args: null, ctx: Ctx) => {
					// The classic slip: an expression-bodied arrow returns push()'s length.
					state.list.change(ctx, (draft) => draft.push(1) as never);
					return null;
				},
			};
		});
		await assert.rejects(host.get(Box, {}).put(null), (error) => isChordError(error, "invalid"));
	});

	it("validates initial values always and writes only in dev mode", async () => {
		const Bad = local("t.bad-initial", { version: 1, input: Type.Object({}) });
		const host = createHost({ onError: () => {} });
		host.serve(Bad, (_input, _principal, self) => {
			self.state({ x: cell(Type.Object({ n: Type.Number() }), { n: "no" } as never) });
			return {};
		});
		await assert.rejects(host.get(Bad, {}).ready, /initial value of state x/);

		const lax = createHost({ onError: () => {} });
		serveList(lax);
		await lax.get(List, {}).set({ items: [], count: "x" } as never);

		const dev = createHost({ dev: true, onError: () => {} });
		serveList(dev);
		const handle = dev.get(List, {});
		await assert.rejects(
			handle.set({ items: [], count: "x" } as never),
			(error) => isChordError(error, "invalid") && error.reason === "state",
		);
		assert.deepEqual(handle.list.value, { items: [], count: 0 });
	});

	it("rejects writes from inside a factory and placeholder use before activation", async () => {
		const host = createHost({ onError: () => {} });
		const Writer = local("t.writer", { version: 1, input: Type.Object({}) });
		let captured: Ctx | undefined;
		await host.root((ctx) => {
			captured = ctx;
		});
		host.serve(Writer, (_input, _principal, self) => {
			const state = self.state({ x: cell(Type.Object({}), {}) });
			const res = self.resources({ r: resource({ rev: 1, open: () => 1 }) });
			assert.throws(
				() => res.r.value,
				(error) => isChordError(error, "not_ready"),
			);
			state.x.replace(captured!, {});
			return {};
		});
		await assert.rejects(host.get(Writer, {}).ready, /read_only/);
	});

	it("listeners run each event in a fresh root; tasks get an abortable ctx", async () => {
		const host = createHost({ onError: () => {} });
		const events = emitter<number>();
		const Watcher = local("t.watcher", {
			version: 1,
			input: Type.Object({}),
			members: { seen: Type.Object({ sum: Type.Number() }) },
		});
		const roots = new Set<string>();
		let taskAborted = false;
		host.serve(Watcher, (_input, _principal, self) => {
			const state = self.state({ seen: cell(Type.Object({ sum: Type.Number() }), { sum: 0 }) });
			const res = self.resources({ source: resource({ rev: 1, open: () => events }) });
			self.listen({
				onEvent: listener(
					res.source,
					(source) => source,
					(value, ctx) => {
						roots.add(ctx.rootId);
						state.seen.change(ctx, (draft) => {
							draft.sum += value;
						});
					},
				),
			});
			self.tasks({
				loop: async (ctx) => {
					await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve()));
					taskAborted = true;
				},
			});
			return { seen: state.seen };
		});
		const handle = host.get(Watcher, {});
		await handle.ready;
		events.emit(2);
		events.emit(3);
		await tick();
		assert.deepEqual(handle.seen.value, { sum: 5 });
		assert.equal(roots.size, 2);
		handle.release();
		await tick();
		await tick();
		assert.equal(events.size, 0);
		assert.ok(taskAborted);
	});

	it("re-entrant writes publish in adoption order; derivations never go stale (Sol #3)", async () => {
		const host = createHost({ onError: () => {} });
		const Echo = local("t.reentrant", {
			version: 1,
			input: Type.Object({}),
			members: { n: Type.Number(), d: Type.Number(), set: method(Type.Number(), Type.Null()) },
		});
		host.serve(Echo, (_input, _principal, self) => {
			const state = self.state({ n: cell(Type.Number(), 0) });
			const derived = self.derive({ d: derivation([state.n], (n) => n * 2) });
			// Subscribed first: re-enters the write while revision 1 is being published.
			self.listen({
				bump: listener(state.n, (n, ctx) => {
					if (n === 1) state.n.replace(ctx, 2);
				}),
			});
			return {
				n: state.n,
				d: derived.d,
				set: (value: number, ctx: Ctx) => {
					state.n.replace(ctx, value);
					return null;
				},
			};
		});
		const handle = host.get(Echo, {});
		await handle.ready;
		const values: unknown[] = [];
		let replica: unknown;
		handle.n.events((event) => {
			replica = event.type === "ops" ? applyImmutable(replica, event.ops) : event.value;
			values.push(replica);
		});
		const doubled: unknown[] = [];
		handle.d.subscribe((value) => doubled.push(value));
		await handle.set(1);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.deepEqual(values, [0, 1, 2]);
		assert.equal(handle.d.value, 4);
		assert.deepEqual(doubled, [0, 2, 4]);
	});
});
