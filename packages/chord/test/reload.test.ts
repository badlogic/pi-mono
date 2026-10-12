import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it } from "vitest";
import {
	type Ctx,
	cell,
	createHost,
	defineRegistry,
	type Facet,
	isChordError,
	listener,
	local,
	method,
	remote,
	resource,
	type Self,
	type ServeOptions,
	type StateEvent,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const quiet = () => createHost({ onError: () => {} });

function latch() {
	let open = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

const Greeter = local("t.greeter", {
	version: 1,
	input: Type.Object({ id: Type.Optional(Type.String({ default: "a" })) }),
	members: { greet: method(Type.String(), Type.String()), count: Type.Unknown() },
});

const CountV1 = Type.Object({ n: Type.Number() });

interface GreeterSpec {
	readonly greeting: string;
	readonly schema?: typeof CountV1 | ReturnType<typeof Type.Object>;
	readonly initial?: object;
	readonly bump?: (draft: Record<string, number>) => void;
	readonly options?: ServeOptions<typeof Greeter>;
	readonly extra?: (self: Self, input: { id?: string }) => void;
}

function greeterFacet(spec: GreeterSpec): Facet {
	return {
		name: "greeter",
		setup: (api) =>
			api.serve(
				Greeter,
				(input, _principal, self) => {
					spec.extra?.(self, input);
					const state = self.state({ count: cell(spec.schema ?? CountV1, (spec.initial ?? { n: 0 }) as never) });
					return {
						count: state.count,
						greet: (name: string, ctx: Ctx) => {
							state.count.change(ctx, (draft) => {
								const bump =
									spec.bump ??
									((d: Record<string, number>) => {
										d.n = (d.n ?? 0) + 1;
									});
								bump(draft as Record<string, number>);
							});
							return `${spec.greeting} ${name}`;
						},
					};
				},
				spec.options,
			),
	};
}

async function until(check: () => Promise<boolean>, attempts = 200): Promise<void> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (await check()) return;
		await tick();
	}
	throw new Error("condition not reached");
}

describe("reload", () => {
	it("compatible reload: no gate, pinned roots keep old code, state preserved, previous retires", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "hello" }));
		const handle = host.get(Greeter, {});
		assert.equal(await handle.greet("a"), "hello a");
		const go = latch();
		const pinned = host.root(async (ctx) => {
			const first = await handle.greet("p", ctx);
			await go.promise;
			return [first, await handle.greet("p", ctx)];
		});
		await tick();
		const shapes: number[] = [];
		handle.onShape((shape) => shapes.push(shape.epoch));
		const report = await host.reload([greeterFacet({ greeting: "hi" })]);
		assert.deepEqual(report.gated, []);
		assert.equal(report.prepared.length, 1);
		assert.equal(await handle.greet("b"), "hi b");
		assert.deepEqual(shapes, [report.epoch]);
		assert.equal(host.previousEpoch, report.previous);
		go.open();
		assert.deepEqual(await pinned, ["hello p", "hello p"]);
		assert.equal(host.previousEpoch, undefined);
		assert.deepEqual(handle.count.value, { n: 4 });
	});

	it("prepare runs in recording mode: writes throw and a failing factory leaves everything unchanged", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "hello" }));
		const a = host.get(Greeter, { id: "a" });
		const b = host.get(Greeter, { id: "b" });
		await Promise.all([a.ready, b.ready]);
		let captured: Ctx | undefined;
		await host.root((ctx) => {
			captured = ctx;
		});

		const writing = greeterFacet({
			greeting: "hi",
			extra: (self) => {
				const state = self.state({ probe: cell(Type.Object({}), {}) });
				state.probe.replace(captured!, {});
			},
		});
		await assert.rejects(host.reload([writing]), /read_only/);

		const log: string[] = [];
		const failing = greeterFacet({
			greeting: "hi",
			extra: (self, input) => {
				self.resources({
					extra: resource({
						rev: 1,
						open: () => void log.push(`open ${input.id}`),
						close: () => void log.push(`close ${input.id}`),
					}),
				});
				if (input.id === "b") throw new Error("b fails");
			},
		});
		const epoch = host.epoch;
		await assert.rejects(
			host.reload([failing]),
			// A plain error from the new factory surfaces as `unavailable`; the message says the reload aborted.
			(error) => isChordError(error, "unavailable") && /reload aborted.*b fails/.test(error.message),
		);
		assert.equal(host.epoch, epoch);
		assert.deepEqual(log, ["open a", "close a"]);
		assert.equal(await a.greet("x"), "hello x");
	});

	it("refuses a changed cell schema without a state-version bump", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "hello" }));
		await host.get(Greeter, {}).ready;
		const changed = greeterFacet({
			greeting: "hi",
			schema: Type.Object({ total: Type.Number() }),
			initial: { total: 0 },
		});
		await assert.rejects(
			host.reload([changed]),
			(error) =>
				isChordError(error, "invalid") &&
				error.reason === "state" &&
				/without a state-version bump/.test(error.message),
		);
	});

	it("state bump: gate, migrate(old, fromVersion) into the new schema, reset to watchers, old roots upgrade_conflict", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "hello" }));
		const handle = host.get(Greeter, {});
		await handle.greet("a");
		await handle.greet("a");
		const events: StateEvent<unknown>[] = [];
		handle.count.events((event) => events.push(event));
		const go = latch();
		// Started before the reload, never touched the record: rejected after the commit.
		const late = host.root(async (ctx) => {
			await go.promise;
			return handle.greet("late", ctx);
		});
		const froms: number[] = [];
		const v2 = greeterFacet({
			greeting: "hi",
			schema: Type.Object({ total: Type.Number() }),
			initial: { total: 0 },
			bump: (draft) => {
				draft.total = (draft.total ?? 0) + 1;
			},
			options: {
				state: {
					version: 2,
					migrate: {
						count: (old, from) => {
							froms.push(from);
							return { total: (old as { n: number }).n };
						},
					},
				},
			},
		});
		const report = await host.reload([v2]);
		assert.equal(report.gated.length, 1);
		assert.deepEqual(froms, [1]);
		assert.deepEqual(events.at(-1), { type: "reset", value: { total: 2 } });
		assert.equal(await handle.greet("b"), "hi b");
		assert.deepEqual(handle.count.value, { total: 3 });
		go.open();
		await assert.rejects(late, (error) => isChordError(error, "upgrade_conflict") && error.retryable);
	});

	it("gate: late old roots get upgrade_conflict, grandfathered roots re-enter, then commit", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "hello" }));
		const handle = host.get(Greeter, {});
		await handle.ready;
		const go = latch();
		const grandfathered = host.root(async (ctx) => {
			await handle.greet("g", ctx);
			await go.promise;
			return handle.greet("g", ctx);
		});
		await tick();
		const reload = host.reload([greeterFacet({ greeting: "hi", options: { state: { version: 2 } } })]);
		await until(async () => {
			try {
				await handle.greet("probe");
				return false;
			} catch (error) {
				return isChordError(error, "upgrade_conflict");
			}
		});
		go.open();
		assert.equal(await grandfathered, "hello g");
		const report = await reload;
		assert.equal(report.gated.length, 1);
		assert.equal(await handle.greet("n"), "hi n");
	});

	it("gate deadline: reload aborts, reports blocking roots, nothing changes", async () => {
		const host = quiet();
		const log: string[] = [];
		const facet = (greeting: string, version: number): Facet => ({
			name: "greeter",
			setup: (api) =>
				api.serve(
					Greeter,
					(_input, _principal, self) => {
						self.tasks({
							loop: async (ctx) => {
								log.push(`start ${greeting}`);
								await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve()));
								log.push(`stop ${greeting}`);
							},
						});
						const state = self.state({ count: cell(Type.Number(), 0) });
						return { count: state.count, greet: (name: string) => `${greeting} ${name}` };
					},
					{ state: { version } },
				),
		});
		host.install(facet("hello", 1));
		const handle = host.get(Greeter, {});
		await handle.ready;
		const go = latch();
		const blocker = host.root(async (ctx) => {
			await handle.greet("b", ctx);
			await go.promise;
		});
		await tick();
		await assert.rejects(host.reload([facet("hi", 2)], { gateDeadline: 30 }), (error) => {
			assert.ok(isChordError(error, "aborted") && error.reason === "gate_deadline");
			assert.match(error.message, /blocking roots: host#\w+:\d+/);
			return true;
		});
		assert.equal(await handle.greet("x"), "hello x");
		await tick();
		assert.deepEqual(log, ["start hello", "stop hello", "start hello"]);
		go.open();
		await blocker;
	});

	it("exclusive resources are replaced at the gate; non-exclusive ones at prepare and closed at retirement", async () => {
		const host = quiet();
		const log: string[] = [];
		const facet = (rev: number): Facet => ({
			name: "greeter",
			setup: (api) =>
				api.serve(Greeter, (_input, _principal, self) => {
					const res = self.resources({
						lock: resource({
							rev,
							exclusive: true,
							open: () => {
								log.push(`open lock ${rev}`);
								return rev;
							},
							close: () => void log.push(`close lock ${rev}`),
						}),
						cache: resource({
							rev,
							open: () => void log.push(`open cache ${rev}`),
							close: () => void log.push(`close cache ${rev}`),
						}),
					});
					const state = self.state({ count: cell(Type.Number(), 0) });
					return { count: state.count, greet: (name: string) => `${res.lock.value} ${name}` };
				}),
		});
		host.install(facet(1));
		const handle = host.get(Greeter, {});
		assert.equal(await handle.greet("x"), "1 x");
		log.length = 0;
		const report = await host.reload([facet(2)]);
		assert.equal(report.gated.length, 1);
		assert.equal(await handle.greet("x"), "2 x");
		await tick();
		assert.deepEqual(log, ["open cache 2", "close lock 1", "open lock 2", "close cache 1"]);
	});

	it("two-version rule: the next reload retires the previous epoch; its roots get superseded", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "v1" }));
		const handle = host.get(Greeter, {});
		await handle.ready;
		const first = host.epoch;
		const go = latch();
		const pinned = host.root(async (ctx) => {
			await handle.greet("p", ctx);
			await go.promise;
			return handle.greet("p", ctx);
		});
		await tick();
		await host.reload([greeterFacet({ greeting: "v2" })]);
		assert.equal(host.previousEpoch, first);
		await host.reload([greeterFacet({ greeting: "v3" })], { retireDeadline: 20 });
		go.open();
		await assert.rejects(pinned, (error) => isChordError(error, "superseded") && error.retryable);
		await assert.rejects(
			host.root(() => 1, { epoch: first }),
			(error) => isChordError(error, "superseded"),
		);
		assert.equal(await handle.greet("n"), "v3 n");
	});

	it("checks contracts at reload: forgotten bumps, live consumers, accepts adapters", async () => {
		const DocV1 = remote("t.rdoc", {
			version: 1,
			input: Type.Object({}),
			variants: { main: { methods: { read: method(Type.Null(), Type.Object({ text: Type.String() })) } } },
		});
		const DocBroken = remote("t.rdoc", {
			version: 1,
			input: Type.Object({}),
			variants: { main: { methods: { read: method(Type.Null(), Type.Object({ text: Type.Number() })) } } },
		});
		const DocV2 = remote("t.rdoc", {
			version: 2,
			input: Type.Object({}),
			variants: { main: { methods: { fetch: method(Type.Null(), Type.Object({ body: Type.String() })) } } },
		});
		const host = quiet();
		host.install({
			name: "doc",
			setup: (api) => api.serve(DocV1, () => ({ kind: "main", read: () => ({ text: "v1" }) })),
		});
		const consumer = host.get(DocV1, {});
		assert.deepEqual(await consumer.read(null), { text: "v1" });

		const broken: Facet = {
			name: "doc",
			setup: (api) => api.serve(DocBroken, () => ({ kind: "main", read: () => ({ text: 1 }) })),
		};
		await assert.rejects(host.reload([broken]), /without a version bump/);

		const fetch = () => ({ body: "v2" });
		const v2: Facet = { name: "doc", setup: (api) => api.serve(DocV2, () => ({ kind: "main", fetch })) };
		await assert.rejects(host.reload([v2]), (error) => isChordError(error, "contract_mismatch"));

		const adapted: Facet = {
			name: "doc",
			setup: (api) =>
				api.serve(DocV2, () => ({ kind: "main", fetch }), {
					accepts: {
						1: (current) => ({
							kind: "main",
							read: () => ({ text: `${(current.fetch as typeof fetch)().body} via adapter` }),
						}),
					},
				}),
		};
		await host.reload([adapted]);
		assert.deepEqual(await consumer.read(null), { text: "v2 via adapter" });
		const modern = host.get(DocV2, {});
		assert.deepEqual(await modern.fetch(null), { body: "v2" });
	});

	it("rebinds listeners to the new code and restarts tasks", async () => {
		const host = quiet();
		const listeners = new Set<(event: number) => void>();
		const events = {
			subscribe: (fn: (event: number) => void) => {
				listeners.add(fn);
				return () => listeners.delete(fn);
			},
		};
		const emit = (value: number) => {
			for (const fn of listeners) fn(value);
		};
		const log: string[] = [];
		const Sum = local("t.sum", {
			version: 1,
			input: Type.Object({}),
			members: { sum: Type.Object({ v: Type.Number() }) },
		});
		const facet = (factor: number): Facet => ({
			name: "sum",
			setup: (api) =>
				api.serve(Sum, (_input, _principal, self) => {
					const state = self.state({ sum: cell(Type.Object({ v: Type.Number() }), { v: 0 }) });
					self.listen({
						add: listener(
							events,
							(source) => source,
							(value, ctx) =>
								state.sum.change(ctx, (draft) => {
									draft.v += value * factor;
								}),
						),
					});
					self.tasks({
						run: async (ctx) => {
							log.push(`start ${factor}`);
							await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve()));
							log.push(`stop ${factor}`);
						},
					});
					return { sum: state.sum };
				}),
		});
		host.install(facet(1));
		const handle = host.get(Sum, {});
		await handle.ready;
		emit(1);
		await tick();
		await host.reload([facet(10)]);
		assert.equal(listeners.size, 1);
		emit(1);
		await tick();
		assert.deepEqual(handle.sum.value, { v: 11 });
		assert.deepEqual(log, ["start 1", "start 10", "stop 1"]);
	});

	it("keeps registry tables per epoch", async () => {
		const host = quiet();
		const Routes = defineRegistry<string>("t.reload-routes");
		const Router = local("t.router", { version: 1, input: Type.Object({}) });
		const facet = (value: string): Facet => ({
			name: "router",
			setup: (api) =>
				api.serve(
					Router,
					(_input, _principal, self) => {
						self.register(Routes, { "GET /": value });
						return {};
					},
					{ eager: true },
				),
		});
		host.install(facet("one"));
		await tick();
		await tick();
		const seen: [string | undefined, number][] = [];
		host.registry(Routes).subscribe((table, epoch) => seen.push([table.get("GET /"), epoch]));
		const go = latch();
		const pinned = host.root(async (ctx) => {
			await go.promise;
			return host.registry(Routes).get("GET /", ctx);
		});
		const report = await host.reload([facet("two")]);
		assert.equal(host.registry(Routes).get("GET /"), "two");
		go.open();
		assert.equal(await pinned, "one");
		assert.deepEqual(seen, [
			["one", report.previous],
			["two", report.epoch],
		]);
	});

	it("a reload can add a type together with a consumer that holds it", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "hello" }));
		const handle = host.get(Greeter, {});
		await handle.ready;
		const Clock = local("t.clock", {
			version: 1,
			input: Type.Object({}),
			members: { now: method(Type.Null(), Type.Number()) },
		});
		const clockFacet: Facet = { name: "clock", setup: (api) => api.serve(Clock, () => ({ now: () => 42 })) };
		const consumer = (fail: boolean): Facet => ({
			name: "greeter",
			setup: (api) =>
				api.serve(Greeter, (_input, _principal, self) => {
					const clock = self.get(Clock, {});
					const state = self.state({ count: cell(CountV1, { n: 0 }) });
					if (fail) throw new Error("consumer fails");
					return {
						count: state.count,
						greet: async (name: string, ctx: Ctx) => `${await clock.now(null, ctx)} ${name}`,
					};
				}),
		});
		const epoch = host.epoch;
		await assert.rejects(host.reload([clockFacet, consumer(true)]), /consumer fails/);
		assert.equal(host.epoch, epoch);
		assert.equal(await handle.greet("x"), "hello x");
		await host.reload([clockFacet, consumer(false)]);
		assert.equal(await handle.greet("x"), "42 x");
	});

	it("the gate rejects new records of a changed type; after commit they get the new code", async () => {
		const host = quiet();
		host.install(greeterFacet({ greeting: "hello" }));
		const handle = host.get(Greeter, {});
		await handle.ready;
		const go = latch();
		const grandfathered = host.root(async (ctx) => {
			await handle.greet("g", ctx);
			await go.promise;
		});
		const later = latch();
		const pinned = host.root(async (ctx) => {
			await later.promise;
			return handle.greet("old", ctx);
		});
		await tick();
		const reload = host.reload([greeterFacet({ greeting: "hi", options: { state: { version: 2 } } })]);
		await until(async () => {
			try {
				await handle.greet("probe");
				return false;
			} catch (error) {
				return isChordError(error, "upgrade_conflict");
			}
		});
		assert.throws(
			() => host.get(Greeter, { id: "late" }),
			(error) => isChordError(error, "upgrade_conflict") && error.retryable,
		);
		go.open();
		await grandfathered;
		await reload;
		assert.equal(await host.get(Greeter, { id: "late" }).greet("l"), "hi l");
		// The previous epoch is still retained (pinned root), but the gated record dropped its old behavior.
		assert.notEqual(host.previousEpoch, undefined);
		later.open();
		await assert.rejects(pinned, (error) => isChordError(error, "upgrade_conflict"));
	});
});
