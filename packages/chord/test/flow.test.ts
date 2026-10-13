// Link flow control: state waits while the peer's acknowledgements lag a window behind, coalesced per subscription;
// everything else is sent at once.
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
	type Link,
	memoryLinkPair,
	method,
	remote,
} from "../src/index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, attempts = 200): Promise<void> {
	for (let i = 0; i < attempts && !check(); i++) await sleep(2);
	assert.ok(check(), "condition not reached");
}

/** A client's end of a link that can hold back its acknowledgements, and records what it receives. */
class AckGate implements Link {
	readonly inner: Link;
	readonly received: Frame[] = [];
	paused = false;
	#held: Frame | undefined;
	constructor(inner: Link) {
		this.inner = inner;
	}
	get closed(): boolean {
		return this.inner.closed;
	}
	send(frame: Frame): number | undefined {
		if (frame.t === "ack" && this.paused) {
			this.#held = frame;
			return 0;
		}
		return this.inner.send(frame);
	}
	release(): void {
		this.paused = false;
		if (this.#held !== undefined) this.inner.send(this.#held);
		this.#held = undefined;
	}
	receive(handler: (frame: Frame) => void): void {
		this.inner.receive((frame) => {
			this.received.push(frame);
			handler(frame);
		});
	}
	onClose(handler: (reason: string) => void): void {
		this.inner.onClose(handler);
	}
	close(reason?: string): void {
		this.inner.close(reason);
	}
}

const Counter = remote("t.flow-counter", {
	version: 1,
	input: Type.Object({}),
	variants: {
		main: {
			state: { count: Type.Object({ n: Type.Number() }) },
			methods: { add: method(Type.Number(), Type.Number()), wait: method(Type.Null(), Type.Null()) },
		},
	},
});

let release = () => {};
const waiting = () =>
	new Promise<null>((resolve) => {
		const previous = release;
		release = () => {
			previous();
			resolve(null);
		};
	});

function serveCounter(host: Host): void {
	host.serve(Counter, (_input, _principal, self) => {
		const state = self.state({ count: cell(Type.Object({ n: Type.Number() }), { n: 0 }) });
		return {
			kind: "main",
			count: state.count,
			add: (delta: number, ctx: Ctx) => {
				state.count.change(ctx, (draft) => {
					draft.n += delta;
				});
				return state.count.value.n;
			},
			wait: waiting,
		};
	});
}

/** A client of `server` (accepted with `window`) whose acknowledgements can be held back. */
function client(server: Host, window: number) {
	const [down, up] = memoryLinkPair();
	server.accept(down, { principal: { user: "u" }, window });
	const gate = new AckGate(up);
	const host = createHost({ name: "browser", kind: "client", upstream: gate, onError: () => {} });
	return { host, gate };
}

const stateFrames = (frames: readonly Frame[]) =>
	frames.filter((frame): frame is Extract<Frame, { t: "state" }> => frame.t === "state");

describe("link flow control", () => {
	it("holds state back while the window is full, answers calls meanwhile, and sends one coalesced frame", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		serveCounter(server);
		const { host, gate } = client(server, 200);
		const counter = host.get(Counter, {}, { at: "server" });
		const values: unknown[] = [];
		counter.count.subscribe((value) => values.push(value));
		await until(() => values.at(-1) !== undefined);

		gate.paused = true;
		const results: number[] = [];
		for (let i = 0; i < 40; i++) results.push((await counter.add(1)) as number);
		// Every call was answered, though most state is still waiting for an acknowledgement.
		assert.equal(results.at(-1), 40);
		assert.ok((values.at(-1) as { n: number }).n < 40, "state waits behind the window");
		const before = stateFrames(gate.received).length;

		gate.release();
		await until(() => (values.at(-1) as { n: number }).n === 40);
		assert.equal(stateFrames(gate.received).length - before, 1, "the waiting ops arrive as one frame");
		await host.close();
		await server.close();
	});

	it("replaces ops that outgrow their slot with the current value", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		serveCounter(server);
		const { host, gate } = client(server, 64);
		const counter = host.get(Counter, {}, { at: "server" });
		const values: unknown[] = [];
		counter.count.subscribe((value) => values.push(value));
		await until(() => values.at(-1) !== undefined);

		gate.paused = true;
		const before = gate.received.length;
		for (let i = 0; i < 100; i++) await counter.add(1);
		gate.release();
		await until(() => (values.at(-1) as { n: number }).n === 100);
		const sent = stateFrames(gate.received.slice(before));
		assert.ok(
			sent.some((frame) => "reset" in frame),
			"a reset replaced the ops",
		);
		assert.ok(sent.length < 10, `few state frames, not one per change (${sent.length})`);
		await host.close();
		await server.close();
	});

	it("drops what waits for a subscription that ends", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		serveCounter(server);
		const { host, gate } = client(server, 64);
		const counter = host.get(Counter, {}, { at: "server" });
		const stop = counter.count.subscribe(() => {});
		await until(() => counter.count.value !== undefined);

		gate.paused = true;
		for (let i = 0; i < 10; i++) await counter.add(1);
		stop();
		const before = gate.received.length;
		gate.release();
		await counter.add(1);
		await sleep(10);
		assert.deepEqual(stateFrames(gate.received.slice(before)), []);
		await host.close();
		await server.close();
	});

	it("coalesces relayed state for the origin and resubscribes downstream when the slot overflows", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		const toWorker: Frame[] = [];
		server.route("w", {
			authorize: () => true,
			resolve: async (name) => {
				const [down, up] = memoryLinkPair();
				const worker = createHost({ name, upstream: up, onError: () => {} });
				serveCounter(worker);
				return {
					get closed() {
						return down.closed;
					},
					send: (frame: Frame) => {
						toWorker.push(frame);
						return down.send(frame);
					},
					receive: (handler) => down.receive(handler),
					onClose: (handler) => down.onClose(handler),
					close: (reason) => down.close(reason),
				} satisfies Link;
			},
		});
		const { host, gate } = client(server, 64);
		const counter = host.get(Counter, {}, { at: "w" });
		const values: unknown[] = [];
		counter.count.subscribe((value) => values.push(value));
		await until(() => values.at(-1) !== undefined);
		const subs = () => toWorker.filter((frame) => frame.t === "sub").length;
		assert.equal(subs(), 1);

		gate.paused = true;
		for (let i = 0; i < 100; i++) await counter.add(1);
		// Each overflow replaces the slot with a fresh downstream subscription (its snapshot then waits in the slot).
		assert.ok(subs() > 1, "the overflowing slot was resubscribed downstream");
		assert.equal(toWorker.filter((frame) => frame.t === "unsub").length, subs() - 1);
		gate.release();
		await until(() => (values.at(-1) as { n: number }).n === 100);
		await host.close();
		await server.close();
	});

	it("neither windows nor acknowledges a peer whose hello does not announce acks", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		serveCounter(server);
		const [down, raw] = memoryLinkPair();
		server.accept(down, { principal: { user: "u" }, window: 1 });
		const frames: Frame[] = [];
		raw.receive((frame) => frames.push(frame));
		raw.send({ t: "hello", name: "raw", kind: "client", epoch: 0 });
		raw.send({ t: "hold", id: 1, at: "server", token: Counter.description, input: {} });
		raw.send({ t: "sub", id: 2, hold: 1, member: "count" });
		for (let i = 0; i < 5; i++) raw.send({ t: "call", id: 3 + i, hold: 1, member: "add", args: 1 });
		await until(() => frames.filter((frame) => frame.t === "result").length === 5);
		await sleep(5);
		assert.equal(stateFrames(frames).length, 6, "the snapshot and one frame per change");
		assert.ok(!frames.some((frame) => frame.t === "ack"));
		assert.equal((frames[0] as Extract<Frame, { t: "hello" }>).acks, true);
		await server.close();
	});

	it("closes the link on an acknowledgement of frames never sent", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		const [down, raw] = memoryLinkPair();
		server.accept(down, { principal: { user: "u" } });
		raw.receive(() => {});
		raw.send({ t: "hello", name: "raw", kind: "client", epoch: 0, acks: true });
		raw.send({ t: "ack", n: 99 });
		await until(() => raw.closed);
		await server.close();
	});
});

describe("link call limit", () => {
	it("answers calls beyond maxCalls at once with too_many_calls and keeps the link", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		serveCounter(server);
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { user: "u" }, maxCalls: 2 });
		const host = createHost({ name: "browser", kind: "client", upstream: up, onError: () => {} });
		const counter = host.get(Counter, {}, { at: "server" });
		await counter.ready;
		release = () => {};
		const first = counter.wait(null);
		const second = counter.wait(null);
		await assert.rejects(
			counter.add(1),
			(error) => isChordError(error, "unavailable") && error.reason === "too_many_calls",
		);
		release();
		await Promise.all([first, second]);
		assert.equal(await counter.add(1), 1);
		await host.close();
		await server.close();
	});
});
