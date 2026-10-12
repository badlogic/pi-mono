import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it } from "vitest";
import {
	type Ctx,
	cell,
	createHost,
	defineRegistry,
	derivation,
	forbidden,
	type Handle,
	type Host,
	isChordError,
	listener,
	local,
	method,
	remote,
	resource,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const quiet = (errors: unknown[] = []) => createHost({ onError: (error) => errors.push(error) });

const Counter = local("t.counter", {
	version: 1,
	input: Type.Object({ name: Type.String() }),
	members: {
		count: Type.Object({ n: Type.Number() }),
		add: method(Type.Number(), Type.Number()),
	},
});

function serveCounter(host: Host, log: string[] = [], options: { linger?: number } = {}) {
	host.serve(
		Counter,
		({ name }, _principal, self) => {
			log.push(`factory ${name}`);
			const state = self.state({ count: cell(Type.Object({ n: Type.Number() }), { n: 0 }) });
			const res = self.resources({
				conn: resource({
					rev: 1,
					open: async () => {
						log.push(`open ${name}`);
						return { name };
					},
					close: () => {
						log.push(`close ${name}`);
					},
				}),
			});
			return {
				count: state.count,
				conn: res.conn,
				add: (delta: number, ctx) => {
					state.count.change(ctx, (draft) => {
						draft.n += delta;
					});
					return state.count.value.n;
				},
			};
		},
		options,
	);
}

describe("host: activation and lifetime", () => {
	it("activates, goes live, binds members late, disposes after release", async () => {
		const host = quiet();
		const log: string[] = [];
		serveCounter(host, log);
		const handle = host.get(Counter, { name: "a" });
		assert.equal(handle.status, "loading");
		assert.equal(handle.count.value, undefined);
		const pending = handle.add(2);
		await handle.ready;
		assert.equal(handle.status, "live");
		assert.equal(await pending, 2);
		assert.deepEqual(handle.count.value, { n: 2 });
		handle.release();
		assert.equal(handle.status, "released");
		await assert.rejects(handle.add(1), (error) => isChordError(error, "released"));
		await tick();
		assert.deepEqual(log, ["factory a", "open a", "close a"]);
	});

	it("coalesces concurrent gets and keeps the record while held", async () => {
		const host = quiet();
		const log: string[] = [];
		serveCounter(host, log);
		const a = host.get(Counter, { name: "x" });
		const b = host.get(Counter, { name: "x" });
		await Promise.all([a.ready, b.ready]);
		assert.deepEqual(log, ["factory x", "open x"]);
		a.release();
		await tick();
		assert.equal(await b.add(1), 1);
		b.release();
		await tick();
		assert.deepEqual(log, ["factory x", "open x", "close x"]);
	});

	it("lingers after the last release and revives on a new get", async () => {
		const host = quiet();
		const log: string[] = [];
		serveCounter(host, log, { linger: 30 });
		const a = host.get(Counter, { name: "l" });
		await a.add(5);
		a.release();
		const b = host.get(Counter, { name: "l" });
		await b.ready;
		assert.deepEqual(b.count.value, { n: 5 });
		b.release();
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.deepEqual(log, ["factory l", "open l", "close l"]);
	});

	it("disposes an abandoned activation once it settles", async () => {
		const host = quiet();
		const log: string[] = [];
		let release = () => {};
		const Slow = local("t.slow", { version: 1, input: Type.Object({}) });
		host.serve(Slow, (_input, _principal, self) => {
			self.resources({
				r: resource({
					rev: 1,
					open: ({ signal }) =>
						new Promise<string>((resolve) => {
							release = () => resolve("r");
							signal.addEventListener("abort", () => log.push("abort seen"));
						}),
					close: () => {
						log.push("closed");
					},
				}),
			});
			return {};
		});
		const handle = host.get(Slow, {});
		await tick();
		handle.release();
		await tick();
		release();
		await tick();
		await tick();
		assert.deepEqual(log, ["abort seen", "closed"]);
		const again = host.get(Slow, {});
		await tick();
		release();
		await again.ready;
		assert.equal(again.status, "live");
	});

	it("propagates activation failures to dependents and retries on the next get", async () => {
		const host = quiet();
		let fail = true;
		const Leaf = local("t.leaf", { version: 1, input: Type.Object({}) });
		const Parent = local("t.parent", { version: 1, input: Type.Object({}) });
		host.serve(Leaf, (_input, _principal, self) => {
			self.resources({
				r: resource({
					rev: 1,
					open: () => {
						if (fail) throw new Error("boom");
						return 1;
					},
				}),
			});
			return {};
		});
		host.serve(Parent, (_input, _principal, self) => {
			self.get(Leaf, {});
			return {};
		});
		const parent = host.get(Parent, {});
		// A plain error from a dependency surfaces as `unavailable`, with the original as cause.
		await assert.rejects(parent.ready, (error) => isChordError(error, "unavailable") && /boom/.test(error.message));
		assert.equal(parent.status, "gone");
		fail = false;
		const retry = host.get(Parent, {});
		await retry.ready;
		assert.equal(retry.status, "live");
	});

	it("unwinds declarations when a factory throws and rejects async factories", async () => {
		const host = quiet();
		const Leaf = local("t.leaf2", { version: 1, input: Type.Object({}) });
		const Bad = local("t.bad", { version: 1, input: Type.Object({ async: Type.Boolean() }) });
		let leafLive = 0;
		host.serve(Leaf, (_input, _principal, self) => {
			self.resources({
				r: resource({
					rev: 1,
					open: () => {
						leafLive++;
					},
					close: () => {
						leafLive--;
					},
				}),
			});
			return {};
		});
		host.serve(Bad, ({ async }, _principal, self) => {
			self.get(Leaf, {});
			if (async) return Promise.resolve({}) as never;
			throw new Error("factory failed");
		});
		await assert.rejects(host.get(Bad, { async: false }).ready, /factory failed/);
		await assert.rejects(host.get(Bad, { async: true }).ready, /synchronous/);
		await tick();
		await tick();
		assert.equal(leafLive, 0);
	});

	it("rejects duplicate declaration names", async () => {
		const host = quiet();
		const Dup = local("t.dup", { version: 1, input: Type.Object({}) });
		host.serve(Dup, (_input, _principal, self) => {
			self.state({ a: cell(Type.Object({}), {}) });
			self.state({ a: cell(Type.Object({}), {}) });
			return {};
		});
		await assert.rejects(host.get(Dup, {}).ready, /duplicate state name a/);
	});

	it("detects hold cycles", async () => {
		const host = quiet();
		const A = local("t.cycle-a", { version: 1, input: Type.Object({}) });
		const B = local("t.cycle-b", { version: 1, input: Type.Object({}) });
		host.serve(A, (_input, _principal, self) => {
			self.get(B, {});
			return {};
		});
		host.serve(B, (_input, _principal, self) => {
			self.get(A, {});
			return {};
		});
		await assert.rejects(host.get(A, {}).ready, /cycle/);
	});

	it("closes resources in reverse order, runs all steps and aggregates errors", async () => {
		const errors: unknown[] = [];
		const host = quiet(errors);
		const log: string[] = [];
		const Multi = local("t.multi", { version: 1, input: Type.Object({}) });
		host.serve(Multi, (_input, _principal, self) => {
			const first = self.resources({
				a: resource({ rev: 1, open: () => "a", close: () => void log.push("close a") }),
			});
			self.resources({
				b: resource({
					rev: 1,
					deps: [first.a],
					open: () => "b",
					close: () => {
						log.push("close b");
						throw new Error("b failed");
					},
				}),
				c: resource({
					rev: 1,
					open: () => "c",
					close: () => {
						log.push("close c");
						throw new Error("c failed");
					},
				}),
			});
			return {};
		});
		const handle = host.get(Multi, {});
		await handle.ready;
		handle.release();
		await tick();
		await tick();
		assert.equal(log.at(-1), "close a");
		assert.equal(log.length, 3);
		assert.ok(errors[0] instanceof AggregateError);
		assert.equal((errors[0] as AggregateError).errors.length, 2);
	});

	it("releases ctx.get holds when the call settles", async () => {
		const host = quiet();
		const log: string[] = [];
		serveCounter(host, log);
		const value = await host.root(async (ctx) => {
			const counter = ctx.get(Counter, { name: "c" });
			return counter.add(3, ctx);
		});
		assert.equal(value, 3);
		await tick();
		assert.deepEqual(log, ["factory c", "open c", "close c"]);
	});
});

describe("host: principals, variants and disposal", () => {
	const Doc = remote("t.doc", {
		version: 1,
		input: Type.Object({ id: Type.String() }),
		variants: {
			viewer: { state: { view: Type.Object({ text: Type.String() }) } },
			editor: {
				state: { view: Type.Object({ text: Type.String() }) },
				methods: { edit: method(Type.Object({ text: Type.String() }), Type.Object({ ok: Type.Boolean() })) },
			},
		},
	});

	function serveDoc(host: Host, principals: unknown[] = []) {
		host.serve(Doc, (_input, principal, self) => {
			principals.push(principal);
			const state = self.state({ view: cell(Type.Object({ text: Type.String() }), { text: "" }) });
			if ((principal as { role?: string }).role !== "editor") return { kind: "viewer", view: state.view };
			return {
				kind: "editor",
				view: state.view,
				edit: ({ text }, ctx) => {
					state.view.replace(ctx, { text });
					return text === "bad" ? ({ ok: "no" } as never) : { ok: true };
				},
			};
		});
	}

	it("keeps records per principal key and enforces variants", async () => {
		const host = createHost({ principalKey: (principal) => (principal as { user: string }).user, onError: () => {} });
		const principals: unknown[] = [];
		serveDoc(host, principals);
		const viewer = host.get(Doc, { id: "1" }, { principal: { user: "v", role: "viewer" } });
		const editor = host.get(Doc, { id: "1" }, { principal: { user: "e", role: "editor" } });
		await Promise.all([viewer.ready, editor.ready]);
		assert.equal(principals.length, 2);
		assert.equal(viewer.kind, "viewer");
		assert.deepEqual(viewer.shape?.members, ["view"]);
		await assert.rejects(viewer.edit({ text: "x" }), (error) => isChordError(error, "not_in_variant"));
		assert.deepEqual(await editor.edit({ text: "x" }), { ok: true });
		assert.deepEqual(editor.view.value, { text: "x" });
		assert.deepEqual(viewer.view.value, { text: "" });
	});

	it("validates remote args and results at the provider boundary", async () => {
		const host = quiet();
		serveDoc(host);
		const editor = host.get(Doc, { id: "2" }, { principal: { role: "editor" } });
		await assert.rejects(
			editor.edit({ text: 1 } as never),
			(error) => isChordError(error, "invalid") && error.reason === "args",
		);
		await assert.rejects(
			editor.edit({ text: "bad" }),
			(error) => isChordError(error, "invalid") && error.reason === "result",
		);
	});

	it("forced disposal makes handles gone and aborts in-flight calls", async () => {
		const host = quiet();
		let seenAbort = false;
		const Slow = local("t.inflight", {
			version: 1,
			input: Type.Object({}),
			members: { wait: method(Type.Null(), Type.Null()) },
		});
		host.serve(Slow, () => ({
			wait: (_args: null, ctx) =>
				new Promise<null>((resolve) =>
					ctx.signal.addEventListener("abort", () => {
						seenAbort = true;
						resolve(null);
					}),
				),
		}));
		const handle = host.get(Slow, {}, { principal: { user: "u" } });
		await handle.ready;
		const call = handle.wait(null);
		await tick();
		await host.invalidatePrincipal((principal) => (principal as { user: string }).user === "u");
		assert.equal(handle.status, "gone");
		await call;
		assert.ok(seenAbort);
		await assert.rejects(handle.wait(null), (error) => isChordError(error, "gone"));
		const fresh = host.get(Slow, {}, { principal: { user: "u" } });
		await fresh.ready;
		assert.equal(fresh.status, "live");
	});

	it("state members are late-bound readables: values, then snapshot/reset/ops events", async () => {
		const host = quiet();
		serveDoc(host);
		const editor = host.get(Doc, { id: "3" }, { principal: { role: "editor" } }) as Handle<typeof Doc>;
		const shapes: unknown[] = [];
		editor.onShape((shape) => shapes.push(shape.kind));
		const events: unknown[] = [];
		const values: unknown[] = [];
		editor.view.events((event) => events.push(event.type === "ops" ? ["ops", event.ops] : [event.type, event.value]));
		editor.view.subscribe((value) => values.push(value));
		await editor.ready;
		await editor.edit({ text: "hi" });
		assert.deepEqual(shapes, ["editor"]);
		assert.deepEqual(events, [
			["snap", undefined],
			["reset", { text: "" }],
			["ops", [["r", { text: "hi" }]]],
		]);
		assert.deepEqual(values, [undefined, { text: "" }, { text: "hi" }]);
	});
});

describe("host: registries", () => {
	const Routes = defineRegistry<string>("t.routes");

	it("only eager records register; tables follow registration order", async () => {
		const host = quiet();
		const RoutesA = local("t.routes-a", { version: 1, input: Type.Object({}) });
		const RoutesB = local("t.routes-b", { version: 1, input: Type.Object({}) });
		host.serve(
			RoutesA,
			(_input, _principal, self) => {
				self.register(Routes, { "GET /a": "a", "GET /c": "c" });
				return {};
			},
			{ eager: true },
		);
		host.serve(
			RoutesB,
			(_input, _principal, self) => {
				self.register(Routes, { "GET /b": "b" });
				return {};
			},
			{ eager: true },
		);
		const tables: string[][] = [];
		host.registry(Routes).subscribe((table) => tables.push([...table.keys()]));
		await tick();
		await tick();
		assert.deepEqual([...host.registry(Routes).table().keys()], ["GET /a", "GET /c", "GET /b"]);
		assert.equal(host.registry(Routes).get("GET /b"), "b");
		assert.deepEqual(tables.at(-1), ["GET /a", "GET /c", "GET /b"]);

		const Lazy = local("t.lazy-register", { version: 1, input: Type.Object({}) });
		host.serve(Lazy, (_input, _principal, self) => {
			self.register(Routes, { x: "x" });
			return {};
		});
		await assert.rejects(host.get(Lazy, {}).ready, /only eager/);
	});

	it("rejects conflicting registrations", async () => {
		const errors: unknown[] = [];
		const host = quiet(errors);
		for (const name of ["t.conflict-a", "t.conflict-b"]) {
			host.serve(
				local(name, { version: 1, input: Type.Object({}) }),
				(_input, _principal, self) => {
					self.register(Routes, { same: name });
					return {};
				},
				{ eager: true },
			);
		}
		await tick();
		await tick();
		assert.ok(errors.some((error) => /registry_conflict/.test(String(error))));
	});
});

describe("host: composition", () => {
	const Source = local("t.source", {
		version: 1,
		input: Type.Object({}),
		members: { n: Type.Number(), set: method(Type.Number(), Type.Null()) },
	});
	const Mirror = local("t.mirror", {
		version: 1,
		input: Type.Object({}),
		members: { copy: Type.Number(), doubled: Type.Number() },
	});

	it("handle state members are sources for listeners and derivations", async () => {
		const host = quiet();
		host.serve(Source, (_input, _principal, self) => {
			const state = self.state({ n: cell(Type.Number(), 1) });
			return {
				n: state.n,
				set: (value: number, ctx: Ctx) => {
					state.n.replace(ctx, value);
					return null;
				},
			};
		});
		host.serve(Mirror, (_input, _principal, self) => {
			const source = self.get(Source, {});
			const state = self.state({ copy: cell(Type.Number(), 0) });
			self.listen({ follow: listener(source.n, (value, ctx) => state.copy.replace(ctx, value ?? 0)) });
			const derived = self.derive({ doubled: derivation([source.n], (n) => (n ?? 0) * 2) });
			return { copy: state.copy, doubled: derived.doubled };
		});
		const mirror = host.get(Mirror, {});
		await mirror.ready;
		await tick();
		assert.equal(mirror.copy.value, 1);
		assert.equal(mirror.doubled.value, 2);
		await host.get(Source, {}).set(5);
		await tick();
		assert.equal(mirror.copy.value, 5);
		assert.equal(mirror.doubled.value, 10);
	});

	it("ctx.get acts as the root principal at ingress and as the host inside objects", async () => {
		const host = createHost({ principalKey: (principal) => JSON.stringify(principal), onError: () => {} });
		const seen: unknown[] = [];
		const Who = local("t.who", {
			version: 1,
			input: Type.Object({}),
			members: { ping: method(Type.Null(), Type.Null()) },
		});
		const Front = local("t.front", {
			version: 1,
			input: Type.Object({}),
			members: { relay: method(Type.Null(), Type.Null()) },
		});
		host.serve(Who, (_input, principal) => {
			seen.push(principal);
			return { ping: () => null };
		});
		host.serve(Front, (_input, principal) => {
			seen.push(principal);
			return { relay: (_args: null, ctx: Ctx) => ctx.get(Who, {}).ping(null, ctx) };
		});
		await host.root((ctx) => ctx.get(Front, {}).relay(null, ctx), { principal: { user: "guest" } });
		assert.deepEqual(seen, [{ user: "guest" }, { host: true }]);
	});

	it("calling a handle inside a factory throws not_ready", async () => {
		const host = quiet();
		host.serve(Source, (_input, _principal, self) => ({
			n: self.state({ n: cell(Type.Number(), 0) }).n,
			set: () => null,
		}));
		const Eager = local("t.eager-call", { version: 1, input: Type.Object({}) });
		host.serve(Eager, (_input, _principal, self) => {
			const source = self.get(Source, {});
			void source.set(1);
			return {};
		});
		await assert.rejects(host.get(Eager, {}).ready, (error) => isChordError(error, "not_ready"));
	});

	it("a ChordError from a factory keeps its code through dependents", async () => {
		const host = quiet();
		const Secret = local("t.secret", { version: 1, input: Type.Object({}) });
		const Page = local("t.page", { version: 1, input: Type.Object({}) });
		host.serve(Secret, () => {
			throw forbidden("not for you");
		});
		host.serve(Page, (_input, _principal, self) => {
			self.get(Secret, {});
			return {};
		});
		await assert.rejects(host.get(Page, {}).ready, (error) => isChordError(error, "forbidden"));
	});
});
