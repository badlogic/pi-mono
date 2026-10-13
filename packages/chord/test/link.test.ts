import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it } from "vitest";
import {
	type Ctx,
	cell,
	createHost,
	type Frame,
	type Host,
	isChordError,
	memoryLinkPair,
	method,
	type Principal,
	remote,
	resource,
	type StateEvent,
} from "../src/index.ts";
import { Packed, unpack } from "../src/link.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const Counter = remote("t.counter", {
	version: 1,
	input: Type.Object({ name: Type.String() }),
	variants: {
		main: {
			state: { count: Type.Object({ n: Type.Number() }) },
			methods: {
				add: method(Type.Number(), Type.Number()),
				who: method(Type.Null(), Type.Unknown()),
			},
		},
	},
});

/** Serves Counter and records the principal of every record it creates. */
function serveCounter(host: Host, principals: unknown[] = []) {
	host.serve(Counter, (_input, principal, self) => {
		principals.push(principal);
		const state = self.state({ count: cell(Type.Object({ n: Type.Number() }), { n: 0 }) });
		return {
			kind: "main",
			count: state.count,
			add: (delta, ctx) => {
				state.count.change(ctx, (draft) => {
					draft.n += delta;
				});
				return state.count.value.n;
			},
			who: () => principal,
		};
	});
}

/** A server and a worker connected by a memory link; the server accepts the worker as `{ worker: name }`. */
function serverWithWorker(workerName = "session:S1") {
	const errors: unknown[] = [];
	const server = createHost({ name: "server", onError: (error) => errors.push(error) });
	const [down, up] = memoryLinkPair();
	server.accept(down, { principal: { worker: workerName }, kind: "host", name: workerName });
	const worker = createHost({ name: workerName, upstream: up, onError: (error) => errors.push(error) });
	return { server, worker, down, up, errors };
}

describe("links: calls and state across hosts", () => {
	it("a child calls the server; the server stamps the child's principal", async () => {
		const { server, worker } = serverWithWorker();
		const principals: unknown[] = [];
		serveCounter(server, principals);
		const result = await worker.root(async (ctx) => {
			const counter = ctx.get(Counter, { name: "c" }, { at: "server" });
			await counter.ready;
			assert.equal(counter.kind, "main");
			return [await counter.add(2, ctx), await counter.who(null, ctx)];
		});
		assert.deepEqual(result, [2, { worker: "session:S1" }]);
		assert.deepEqual(principals, [{ worker: "session:S1" }]);
	});

	it("state members: snapshot, then delta-encoded ops; values decode to the provider's", async () => {
		const { server, worker } = serverWithWorker();
		serveCounter(server);
		const counter = worker.get(Counter, { name: "s" }, { at: "server" });
		const events: StateEvent<unknown>[] = [];
		const values: unknown[] = [];
		counter.count.events((event) => events.push(event));
		counter.count.subscribe((value) => values.push(value));
		await counter.ready;
		await counter.add(1);
		await counter.add(1);
		await tick();
		assert.deepEqual(counter.count.value, { n: 2 });
		assert.deepEqual(
			events.map((event) => event.type),
			["snap", "reset", "ops", "ops"],
		);
		assert.deepEqual(values, [undefined, { n: 0 }, { n: 1 }, { n: 2 }]);
	});

	it("the server reaches a connected child by name", async () => {
		const { server, worker } = serverWithWorker("w1");
		const principals: unknown[] = [];
		serveCounter(worker, principals);
		await tick();
		const counter = server.get(Counter, { name: "x" }, { at: "w1" });
		assert.equal(await counter.add(5), 5);
		// The parent's own requests act as `{ host: <parent> }` on the child.
		assert.deepEqual(principals, [{ host: "server" }]);
	});

	it("rejects local types and unknown hosts", async () => {
		const { worker } = serverWithWorker();
		const missing = worker.get(Counter, { name: "m" }, { at: "server" });
		await assert.rejects(missing.ready, (error) => isChordError(error, "unavailable"));
	});
});

interface Cluster {
	readonly server: Host;
	readonly workers: Map<string, Host>;
	readonly log: string[];
	browser(
		principal: Principal,
		options?: { restamp?: (principal: Principal) => Principal | undefined },
	): {
		host: Host;
		up: ReturnType<typeof memoryLinkPair>[1];
		reconnect(): void;
	};
	allow: (principal: Principal, host: string) => boolean;
}

/** Server routing `session:*` to workers it spawns on demand (memory links); browsers connect as clients. */
function cluster(options: { pingInterval?: number; pingTimeout?: number } = {}): Cluster {
	const log: string[] = [];
	const server = createHost({ name: "server", onError: () => {} });
	const workers = new Map<string, Host>();
	const state: Cluster = {
		server,
		workers,
		log,
		allow: () => true,
		browser(principal, browserOptions = {}) {
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal, restamp: browserOptions.restamp, ...options });
			const host = createHost({
				name: "browser",
				kind: "client",
				upstream: up,
				upstreamOptions: options,
				onError: () => {},
			});
			const handle = { host, up, reconnect: () => {} };
			handle.reconnect = () => {
				const [nextDown, nextUp] = memoryLinkPair();
				server.accept(nextDown, { principal });
				handle.up = nextUp;
				host.connect(nextUp);
			};
			return handle;
		},
	};
	server.route("session:", {
		authorize: (principal, host) => state.allow(principal, host),
		resolve: async (name) => {
			const [down, up] = memoryLinkPair();
			const worker = createHost({ name, upstream: up, upstreamOptions: options, onError: () => {} });
			worker.serve(Counter, (input, principal, self) => {
				self.resources({
					probe: resource({
						rev: 1,
						open: () => void log.push(`open ${input.name}`),
						close: () => void log.push(`close ${input.name}`),
					}),
				});
				const counter = self.state({ count: cell(Type.Object({ n: Type.Number() }), { n: 0 }) });
				return {
					kind: "main",
					count: counter.count,
					add: (delta: number, ctx: Ctx) => {
						counter.count.change(ctx, (draft) => {
							draft.n += delta;
						});
						return counter.count.value.n;
					},
					who: () => principal,
				};
			});
			workers.set(name, worker);
			return down;
		},
	});
	return state;
}

describe("links: relay, stamping, lifetime", () => {
	it("relays browser → server → worker; the worker sees the browser's stamped principal", async () => {
		const c = cluster();
		const guest = { guest: "g1" };
		const browser = c.browser(guest);
		const counter = browser.host.get(Counter, { name: "a" }, { at: "session:S1" });
		assert.equal(await counter.add(3), 3);
		assert.deepEqual(await counter.who(null), guest);
		const values: unknown[] = [];
		counter.count.subscribe((value) => values.push(value));
		await counter.add(1);
		await tick();
		assert.deepEqual(values.at(-1), { n: 4 });
	});

	it("ignores payload principals from clients and from child hosts", async () => {
		const c = cluster();
		const guest = { guest: "g1" };
		const [down, raw] = memoryLinkPair();
		c.server.accept(down, { principal: guest });
		const frames: Frame[] = [];
		raw.receive((frame) => frames.push(frame));
		raw.send({ t: "hello", name: "raw", kind: "client", epoch: 0 });
		raw.send({
			t: "hold",
			id: 1,
			at: "session:S1",
			token: Counter.description,
			input: { name: "f" },
			principal: { owner: true },
		});
		raw.send({ t: "call", id: 2, hold: 1, member: "who", args: null });
		for (let i = 0; i < 50 && !frames.some((frame) => frame.t === "result"); i++) await sleep(5);
		const result = frames.find((frame) => frame.t === "result");
		assert.deepEqual(result?.t === "result" ? result.value : undefined, guest);

		// A child host cannot forward principals upward either: the server stamps it.
		const { server, down: _down, up } = serverWithWorker("w9");
		serveCounter(server);
		const childFrames: Frame[] = [];
		up.receive((frame) => childFrames.push(frame));
		up.send({
			t: "hold",
			id: 7,
			at: "server",
			token: Counter.description,
			input: { name: "f" },
			principal: { owner: true },
		});
		up.send({ t: "call", id: 8, hold: 7, member: "who", args: null });
		for (let i = 0; i < 50 && !childFrames.some((frame) => frame.t === "result"); i++) await sleep(5);
		const childResult = childFrames.find((frame) => frame.t === "result");
		assert.deepEqual(childResult?.t === "result" ? childResult.value : undefined, { worker: "w9" });
	});

	it("a route that returns an already closed link does not poison the host name", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		let attempt = 0;
		server.route("session:", {
			authorize: () => true,
			resolve: async (name) => {
				attempt++;
				const [down, up] = memoryLinkPair();
				const worker = createHost({ name, upstream: up, onError: () => {} });
				serveCounter(worker);
				// The first worker dies before the server wraps its link.
				if (attempt === 1) down.close("worker exited");
				return down;
			},
		});
		const first = server.get(Counter, { name: "a" }, { at: "session:S1" });
		await assert.rejects(first.add(1), (error: Error) => /closed/.test(error.message));
		// The next call resolves the route again and reaches the new worker.
		const second = server.get(Counter, { name: "a" }, { at: "session:S1" });
		assert.equal(await second.add(2), 2);
		assert.equal(attempt, 2);
	});

	it("authorizes before resolving and again after", async () => {
		const c = cluster();
		c.allow = (principal) => (principal as { guest: string }).guest !== "blocked";
		const blocked = c.browser({ guest: "blocked" });
		await assert.rejects(blocked.host.get(Counter, { name: "a" }, { at: "session:S1" }).ready, (error) =>
			isChordError(error, "forbidden"),
		);
		assert.equal(c.workers.size, 0);
		let calls = 0;
		c.allow = () => ++calls === 1;
		const flaky = c.browser({ guest: "flaky" });
		await assert.rejects(flaky.host.get(Counter, { name: "a" }, { at: "session:S2" }).ready, (error) =>
			isChordError(error, "forbidden"),
		);
		assert.equal(calls, 2);
	});

	it("a browser disconnect releases exactly its holds; the worker link stays up", async () => {
		const c = cluster();
		const one = c.browser({ guest: "g1" });
		const two = c.browser({ guest: "g2" });
		await one.host.get(Counter, { name: "a" }, { at: "session:S1" }).add(1);
		const other = two.host.get(Counter, { name: "b" }, { at: "session:S1" });
		await other.add(1);
		one.up.close();
		for (let i = 0; i < 20 && !c.log.includes("close a"); i++) await tick();
		assert.ok(c.log.includes("close a"));
		assert.ok(!c.log.includes("close b"));
		assert.equal(await other.add(1), 2);
	});

	it("a dead link (no pongs) is closed and everything held through it is released", async () => {
		const c = cluster({ pingInterval: 10, pingTimeout: 40 });
		const browser = c.browser({ guest: "g1" });
		await browser.host.get(Counter, { name: "a" }, { at: "session:S1" }).add(1);
		browser.up.sever();
		for (let i = 0; i < 40 && !c.log.includes("close a"); i++) await sleep(10);
		assert.ok(c.log.includes("close a"));
	});

	it("checks contract tokens across links: contract_mismatch for hosts, upgrade_required for browsers", async () => {
		const CounterV2 = remote("t.counter", {
			version: 2,
			input: Type.Object({ name: Type.String() }),
			variants: { main: { methods: { inc: method(Type.Null(), Type.Number()) } } },
		});
		const { server, worker } = serverWithWorker();
		server.serve(CounterV2, () => ({ kind: "main", inc: () => 1 }));
		await assert.rejects(worker.get(Counter, { name: "x" }, { at: "server" }).ready, (error) =>
			isChordError(error, "contract_mismatch"),
		);
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { guest: "g" } });
		const browser = createHost({ name: "browser", kind: "client", upstream: up, onError: () => {} });
		await assert.rejects(browser.get(Counter, { name: "x" }, { at: "server" }).ready, (error) =>
			isChordError(error, "upgrade_required"),
		);
	});

	it("invalidatePrincipal re-stamps the link and propagates to workers", async () => {
		const c = cluster();
		const browser = c.browser({ guest: "g1", revision: 1 }, { restamp: (p) => ({ ...(p as object), revision: 2 }) });
		const counter = browser.host.get(Counter, { name: "a" }, { at: "session:S1" });
		await counter.add(1);
		await c.server.invalidatePrincipal({ guest: "g1" });
		// The relay under the old principal is closed at once; the worker disposes its record after.
		for (let i = 0; i < 20 && counter.status !== "gone"; i++) await tick();
		assert.equal(counter.status, "gone");
		for (let i = 0; i < 20 && !c.log.includes("close a"); i++) await tick();
		assert.ok(c.log.includes("close a"));
		const again = browser.host.get(Counter, { name: "a" }, { at: "session:S1" });
		assert.deepEqual(await again.who(null), { guest: "g1", revision: 2 });
	});

	it("after a reconnect, state subscribers get a reset and calls work again", async () => {
		const c = cluster();
		const browser = c.browser({ guest: "g1" });
		const counter = browser.host.get(Counter, { name: "r" }, { at: "session:S1" });
		const events: string[] = [];
		counter.count.events((event) => events.push(event.type));
		await counter.add(2);
		browser.up.close();
		await tick();
		await tick();
		assert.equal(counter.status, "loading");
		browser.reconnect();
		assert.equal(await counter.add(1), 1);
		await tick();
		// The old hold was released with the link, so the worker made a fresh record; the reset carries its value.
		assert.deepEqual(counter.count.value, { n: 1 });
		assert.ok(events.filter((type) => type === "reset").length >= 2);
	});
});

const Big = remote("t.big", {
	version: 1,
	input: Type.Object({}),
	variants: {
		main: {
			state: { notes: Type.Array(Type.String()) },
			methods: { echo: method(Type.Array(Type.String()), Type.Array(Type.String())) },
		},
	},
});

/** About 160,000 characters of JSON: above PACK_THRESHOLD. */
const large = (tag: string) => Array.from({ length: 40 }, (_, i) => `${tag}${i}:${"x".repeat(4000)}`);

describe("links: packed payloads", () => {
	it("large args, results and snapshots cross a relay deflated and arrive intact", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		server.route("session:", {
			authorize: () => true,
			resolve: async (name) => {
				const [down, up] = memoryLinkPair();
				const worker = createHost({ name, upstream: up, onError: () => {} });
				worker.serve(Big, (_input, _principal, self) => {
					const state = self.state({ notes: cell(Type.Array(Type.String()), large("a")) });
					return { kind: "main", notes: state.notes, echo: (notes: string[]) => notes };
				});
				return down;
			},
		});
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { owner: true } });
		const browser = createHost({ name: "browser", kind: "client", upstream: up, onError: () => {} });
		const big = browser.get(Big, {}, { at: "session:S1" });
		assert.deepEqual(await big.echo(large("c")), large("c"));
		big.notes.subscribe(() => {});
		for (let i = 0; i < 100 && big.notes.value === undefined; i++) await sleep(5);
		assert.deepEqual(big.notes.value, large("a"));
	});

	it("only payloads above the threshold are packed; the receiver unpacks them", async () => {
		const [a, b] = memoryLinkPair();
		const frames: Frame[] = [];
		b.receive((frame) => frames.push(frame));
		a.send({ t: "result", id: 1, value: large("v") });
		a.send({ t: "result", id: 2, value: ["small"] });
		a.send({ t: "state", id: 3, snap: large("s") });
		for (let i = 0; i < 50 && frames.length < 3; i++) await tick();
		const [packed, small, snap] = frames;
		assert(packed?.t === "result" && packed.value instanceof Packed);
		assert.deepEqual(unpack(packed.value), large("v"));
		assert(small?.t === "result");
		assert.deepEqual(small.value, ["small"]);
		assert(snap?.t === "state" && snap.snap instanceof Packed);
		assert.deepEqual(unpack(snap.snap), large("s"));

		// A relay forwards the packed bytes as they are.
		const [c, d] = memoryLinkPair();
		const forwarded: Frame[] = [];
		d.receive((frame) => forwarded.push(frame));
		c.send({ ...packed, id: 9 });
		for (let i = 0; i < 50 && forwarded.length < 1; i++) await tick();
		const relayed = forwarded[0];
		assert(relayed?.t === "result" && relayed.value instanceof Packed);
		assert.deepEqual(relayed.value.bytes, packed.value.bytes);
	});
});
