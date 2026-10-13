import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it, onTestFinished } from "vitest";
import {
	type Ctx,
	cell,
	createHost,
	type Facet,
	type FacetLoader,
	isChordError,
	memoryLinkPair,
	method,
	remote,
	resource,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function latch() {
	let open = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

const Greeter = remote("t.greeter", {
	version: 1,
	input: Type.Object({}),
	variants: {
		main: {
			state: { count: Type.Object({ n: Type.Number() }) },
			methods: { greet: method(Type.String(), Type.String()) },
		},
	},
});

const GreeterV2 = remote("t.greeter", {
	version: 2,
	input: Type.Object({}),
	variants: { main: { methods: { hello: method(Type.String(), Type.String()) } } },
});

function greeterFacet(greeting: string, options: { fail?: boolean } = {}): Facet {
	return {
		name: "greeter",
		setup: (api) =>
			api.serve(Greeter, (_input, _principal, self) => {
				if (options.fail) throw new Error("worker factory fails");
				const state = self.state({ count: cell(Type.Object({ n: Type.Number() }), { n: 0 }) });
				return {
					kind: "main",
					count: state.count,
					greet: (name: string, ctx: Ctx) => {
						state.count.change(ctx, (draft) => {
							draft.n += 1;
						});
						return `${greeting} ${name}`;
					},
				};
			}),
	};
}

/** Server + worker over a memory link; the worker loads facets by name from `modules`. */
function setup() {
	const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
	const loader: FacetLoader = async (names) => names.map((name) => modules.get(String(name))!);
	const server = createHost({ name: "server", onError: () => {} });
	const [down, up] = memoryLinkPair();
	server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
	const worker = createHost({ name: "session:S1", upstream: up, loader, onError: () => {} });
	worker.install(modules.get("greeter")!);
	return { server, worker, modules, down };
}

describe("cross-host reload", () => {
	it("prepares every host, commits the server first, then the workers; epochs stay in step", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.get(Greeter, {}, { at: "session:S1" });
		assert.equal(await greeter.greet("a"), "v1 a");
		const go = latch();
		const pinned = server.root(async (ctx) => {
			await greeter.greet("p", ctx);
			await go.promise;
			return greeter.greet("p", ctx);
		});
		await tick();
		const shapes: number[] = [];
		greeter.onShape((shape) => shapes.push(shape.epoch));
		modules.set("greeter", greeterFacet("v2"));
		const report = await server.reload([], { remote: { "session:": ["greeter"] } });
		// No waiting: the commit frame precedes this call on the FIFO link, so the worker has committed when it arrives.
		assert.equal(await greeter.greet("b"), "v2 b");
		assert.equal(server.epoch, report.epoch);
		assert.equal(worker.epoch, report.epoch);
		go.open();
		assert.equal(await pinned, "v1 p");
		assert.deepEqual(shapes, [report.epoch]);
		// The server retires the old epoch once its last old root ended, then tells the worker.
		for (let i = 0; i < 20 && worker.previousEpoch !== undefined; i++) await tick();
		assert.equal(server.previousEpoch, undefined);
		assert.equal(worker.previousEpoch, undefined);
	});

	it("a failing vote aborts every host; the error keeps its code and names the host", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.get(Greeter, {}, { at: "session:S1" });
		await greeter.greet("a");
		const before = [server.epoch, worker.epoch];
		modules.set("greeter", greeterFacet("v2", { fail: true }));
		await assert.rejects(server.reload([], { remote: { "session:": ["greeter"] } }), (error) => {
			assert.ok(isChordError(error, "unavailable"));
			assert.match(error.message, /session:S1: .*worker factory fails/);
			return true;
		});
		assert.deepEqual([server.epoch, worker.epoch], before);
		assert.equal(await greeter.greet("x"), "v1 x");
	});

	it("a worker gate blocked past its deadline aborts the whole reload", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.get(Greeter, {}, { at: "session:S1" });
		const go = latch();
		const blocker = server.root(async (ctx) => {
			await greeter.greet("g", ctx);
			await go.promise;
		});
		await tick();
		const before = [server.epoch, worker.epoch];
		const bumped: Facet = {
			name: "greeter",
			setup: (api) =>
				greeterFacet("v2").setup({
					...api,
					serve: ((type: never, factory: never) => api.serve(type, factory, { state: { version: 2 } })) as never,
				}),
		};
		modules.set("greeter", bumped);
		await assert.rejects(server.reload([], { remote: { "session:": ["greeter"] }, gateDeadline: 30 }), (error) => {
			assert.ok(isChordError(error, "aborted") && error.reason === "gate_deadline");
			assert.match(error.message, /session:S1: .*blocking roots: server#\w+:\d+/);
			return true;
		});
		assert.deepEqual([server.epoch, worker.epoch], before);
		go.open();
		await blocker;
		assert.equal(await greeter.greet("x"), "v1 x");
	});

	it("removes facets from server and workers, reconciles removal tombstones, and clears them on re-add", async () => {
		const { server, worker, modules } = setup();
		onTestFinished(async () => {
			await worker.close();
			await server.close();
		});
		await server.install(greeterFacet("v1"));
		await tick();
		const local = server.get(Greeter, {});
		const child = server.get(Greeter, {}, { at: "session:S1" });
		assert.equal(await local.greet("a"), "v1 a");
		assert.equal(await child.greet("a"), "v1 a");
		await server.reload([], { remove: ["greeter"], remoteRemove: { "session:": ["greeter"] } });
		for (let i = 0; i < 20 && child.status !== "gone"; i++) await tick();
		assert.equal(local.status, "gone");
		assert.equal(child.status, "gone");

		// A child starting with the old set must remove it without trying to import its removed module.
		const cold = createHost({
			name: "session:cold",
			loader: async () => {
				assert.fail("Removed modules must not be imported");
			},
			onError: () => {},
		});
		onTestFinished(() => cold.close());
		await cold.install(greeterFacet("v1"));
		const old = cold.get(Greeter, {});
		await old.ready;
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { worker: "cold" }, kind: "host", name: "session:cold" });
		cold.connect(up);
		for (let i = 0; i < 20 && old.status !== "gone"; i++) await tick();
		assert.equal(old.status, "gone");
		assert.equal(cold.epoch, server.epoch);
		// Close this loader-less child before the addition; it tested only the removal reconciliation.
		await cold.close();
		modules.set("greeter", greeterFacet("v2"));
		await server.reload([greeterFacet("v2")], { remote: { "session:": ["greeter"] } });
		assert.equal(await server.get(Greeter, {}, { at: "session:S1" }).greet("b"), "v2 b");
		const fresh = createHost({
			name: "session:fresh",
			loader: async (names) => names.map((name) => modules.get(String(name))!),
			onError: () => {},
		});
		onTestFinished(() => fresh.close());
		await fresh.install(greeterFacet("v1"));
		const [freshDown, freshUp] = memoryLinkPair();
		server.accept(freshDown, { principal: { worker: "fresh" }, kind: "host", name: "session:fresh" });
		fresh.connect(freshUp);
		assert.equal(await server.get(Greeter, {}, { at: "session:fresh" }).greet("c"), "v2 c");
	});

	it("only the server coordinates reloads", async () => {
		const { worker } = setup();
		await tick();
		await assert.rejects(worker.reload([]), (error) => isChordError(error, "unavailable"));
	});

	it("browsers are not participants: they see shape and reset pushes, or upgrade_required", async () => {
		const { server, modules, down: workerLink } = setup();
		// The route resolves to the already connected worker.
		server.route("session:", { authorize: () => true, resolve: async () => workerLink });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { guest: "g" } });
		const browser = createHost({ name: "browser", kind: "client", upstream: up, onError: () => {} });
		const viewer = browser.get(Greeter, {}, { at: "session:S1" });
		assert.equal(await viewer.greet("a"), "v1 a");
		const shapes: number[] = [];
		viewer.onShape((shape) => shapes.push(shape.epoch));
		modules.set("greeter", greeterFacet("v2"));
		const report = await server.reload([], { remote: { "session:": ["greeter"] } });
		for (let i = 0; i < 20 && shapes.length === 0; i++) await tick();
		assert.deepEqual(shapes, [report.epoch]);
		assert.equal(await viewer.greet("b"), "v2 b");

		modules.set("greeter", {
			name: "greeter",
			setup: (api) => api.serve(GreeterV2, () => ({ kind: "main", hello: (name: string) => `hi ${name}` })),
		});
		await server.reload([], { remote: { "session:": ["greeter"] } });
		for (let i = 0; i < 20 && viewer.status !== "gone"; i++) await tick();
		assert.equal(viewer.status, "gone");
		assert.ok(isChordError(viewer.error, "upgrade_required"));
	});

	it("an abort while a worker is still preparing: a late open closes itself and the worker can reload again", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.get(Greeter, {}, { at: "session:S1" });
		await greeter.greet("a");
		const log: string[] = [];
		const go = latch();
		const slow: Facet = {
			name: "greeter",
			setup: (api) =>
				api.serve(Greeter, (_input, _principal, self) => {
					self.resources({
						late: resource({
							rev: 1,
							open: async () => {
								await go.promise;
								log.push("opened");
							},
							close: () => void log.push("closed"),
						}),
					});
					const state = self.state({ count: cell(Type.Object({ n: Type.Number() }), { n: 0 }) });
					return { kind: "main", count: state.count, greet: (name: string) => `slow ${name}` };
				}),
		};
		modules.set("greeter", slow);
		const epoch = worker.epoch;
		await assert.rejects(server.reload([], { remote: { "session:": ["greeter"] }, voteDeadline: 50 }), (error) =>
			isChordError(error, "aborted"),
		);
		go.open();
		for (let i = 0; i < 50 && !log.includes("closed"); i++) await tick();
		assert.deepEqual(log, ["opened", "closed"]);
		assert.equal(worker.epoch, epoch);
		modules.set("greeter", greeterFacet("v3"));
		await server.reload([], { remote: { "session:": ["greeter"] } });
		assert.equal(await greeter.greet("b"), "v3 b");
	});
});
