import { Value } from "typebox/value";
import type { AnyContract } from "./contract.ts";
import { applyImmutable, type Decoder, decoder } from "./delta/index.ts";
import { ChordError } from "./errors.ts";
import {
	CtxImpl,
	HANDLE_BASE,
	type Hold,
	type HoldOwner,
	holdsByProxy,
	notifyStatus,
	raceSignal,
	type StatusListener,
} from "./record.ts";
import type { Ctx, HandleStatus, Principal, Readable, Shape, StateEvent } from "./types.ts";
import { fromWireError, type RootRef, type WireError } from "./wire.ts";

const noop = (): void => {};

export interface StateSink {
	snap?: unknown;
	reset?: unknown;
	ops?: readonly unknown[];
	error?: WireError;
}

/** What a remote handle needs from the link it is bound to (implemented by Connection). */
export interface RemoteChannel {
	hold(handle: RemoteHandle): number;
	release(id: number): void;
	call(hold: number, member: string, args: unknown, root: RootRef | undefined, signal: AbortSignal): Promise<unknown>;
	sub(hold: number, member: string, sink: (frame: StateSink) => void): number;
	unsub(id: number): void;
}

/** What a remote handle needs from its host. */
export interface RemoteHost {
	readonly inFactory: number;
	report(error: unknown): void;
	root<T>(fn: (ctx: Ctx) => T | Promise<T>, options?: { signal?: AbortSignal }): Promise<T>;
	forgetRemote(handle: RemoteHandle): void;
}

/**
 * A state member of a remote handle: hydrated while subscribed (snapshot, then decoded ops); `undefined` before.
 * Re-subscribing after a reconnect delivers the new snapshot as a reset.
 */
class RemoteReadable implements Readable<unknown> {
	readonly #handle: RemoteHandle;
	readonly #name: string;
	readonly #values = new Set<(value: unknown) => void>();
	readonly #events = new Set<(event: StateEvent<unknown>) => void>();
	#sub: { readonly channel: RemoteChannel; readonly id: number } | undefined;
	#decoder: Decoder = decoder();
	#value: unknown;

	constructor(handle: RemoteHandle, name: string) {
		this.#handle = handle;
		this.#name = name;
	}

	get value(): unknown {
		return this.#value;
	}

	subscribe(listener: (value: unknown) => void): () => void {
		this.#values.add(listener);
		this.#safe(() => listener(this.#value));
		this.bind();
		return () => this.#remove(this.#values, listener);
	}

	events(listener: (event: StateEvent<unknown>) => void): () => void {
		this.#events.add(listener);
		this.#safe(() => listener({ type: "snap", value: this.#value }));
		this.bind();
		return () => this.#remove(this.#events, listener);
	}

	/** Subscribes upstream while someone listens and the handle is bound; drops a subscription on an old link. */
	bind(): void {
		const listening = this.#values.size + this.#events.size > 0;
		// Nobody listens: the value would go stale, so forget it. The next subscriber sees `undefined`, then the snapshot.
		if (!listening) this.#value = undefined;
		const binding = listening ? this.#handle.binding : undefined;
		if (binding !== undefined && this.#sub?.channel === binding.channel) return;
		if (this.#sub !== undefined) {
			if (this.#sub.channel !== binding?.channel || binding === undefined) this.#sub.channel.unsub(this.#sub.id);
			this.#sub = undefined;
		}
		if (binding === undefined) return;
		const channel = binding.channel;
		this.#decoder = decoder();
		const id = channel.sub(binding.id, this.#name, (frame) => this.#receive(frame));
		this.#sub = { channel, id };
	}

	/** The link is gone: keep the last value, resubscribe on the next binding. */
	detach(): void {
		this.#sub = undefined;
	}

	stop(): void {
		this.#values.clear();
		this.#events.clear();
		this.bind();
	}

	#receive(frame: StateSink): void {
		if (frame.error !== undefined) {
			this.#handle.host.report(fromWireError(frame.error));
			return;
		}
		let event: StateEvent<unknown>;
		if (frame.ops === undefined && !("snap" in frame) && !("reset" in frame)) return;
		if (frame.ops !== undefined) {
			const ops = this.#decoder.decode(frame.ops);
			this.#value = applyImmutable(this.#value, ops);
			event = { type: "ops", ops, value: this.#value };
		} else {
			// Listeners already saw a snapshot (`undefined` or an older value), so every upstream snapshot is a reset.
			this.#decoder = decoder();
			this.#value = "snap" in frame ? frame.snap : frame.reset;
			event = { type: "reset", value: this.#value };
		}
		for (const listener of [...this.#events]) this.#safe(() => listener(event));
		for (const listener of [...this.#values]) this.#safe(() => listener(this.#value));
	}

	#remove<T>(set: Set<T>, listener: T): void {
		set.delete(listener);
		this.bind();
	}

	#safe(fn: () => void): void {
		try {
			fn();
		} catch (error) {
			this.#handle.host.report(error);
		}
	}
}

/** A hold on an object on another host, bound to a link. Late-bound like a local handle. */
export class RemoteHandle implements Hold {
	readonly record = undefined;
	readonly host: RemoteHost;
	readonly contract: AnyContract;
	readonly at: string;
	readonly input: unknown;
	/** Forwarded principal (omitted for the host's own principal). */
	readonly principal: Principal | undefined;
	readonly owner: HoldOwner;
	readonly address: string;
	readonly proxy: object;
	readonly ready: Promise<void>;
	status: HandleStatus = "loading";
	error: unknown;
	shape: Shape | undefined;
	binding: { readonly channel: RemoteChannel; readonly id: number } | undefined;
	readonly shapeListeners = new Set<(shape: Shape) => void>();
	readonly #readables = new Map<string, RemoteReadable>();
	readonly #callers = new Map<string, (args: unknown, ctx?: Ctx) => Promise<unknown>>();
	#settleReady: { resolve: () => void; reject: (error: unknown) => void } | undefined;
	#live: { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };

	constructor(
		host: RemoteHost,
		fields: {
			contract: AnyContract;
			at: string;
			input: unknown;
			principal: Principal | undefined;
			owner: HoldOwner;
			address: string;
		},
	) {
		this.host = host;
		this.contract = fields.contract;
		this.at = fields.at;
		this.input = fields.input;
		this.principal = fields.principal;
		this.owner = fields.owner;
		this.address = fields.address;
		this.ready = new Promise<void>((resolve, reject) => {
			this.#settleReady = { resolve, reject };
		});
		this.ready.catch(noop);
		this.#live = this.#newLive();
		this.proxy = new Proxy(this, {
			get: (target, property) => {
				if (HANDLE_BASE.has(property)) {
					const value: unknown = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				}
				if (typeof property !== "string" || property === "then") return undefined;
				return target.member(property);
			},
		});
		holdsByProxy.set(this.proxy, this);
	}

	get kind(): string | undefined {
		return this.shape?.kind;
	}

	onShape(listener: (shape: Shape) => void): () => void {
		this.shapeListeners.add(listener);
		return () => this.shapeListeners.delete(listener);
	}

	onStatus(listener: StatusListener): () => void {
		this.#statusListeners.add(listener);
		return () => this.#statusListeners.delete(listener);
	}

	readonly #statusListeners = new Set<StatusListener>();

	#statusChanged(): void {
		notifyStatus(this.#statusListeners, this.status, this.error, (error) => this.host.report(error));
	}

	release(): void {
		if (this.status === "released" || this.status === "gone") return;
		this.status = "released";
		this.#statusChanged();
		const error = new ChordError("released", `handle ${this.address} released`);
		this.#settleReady?.reject(error);
		this.#live.reject(error);
		for (const readable of this.#readables.values()) readable.stop();
		if (this.binding !== undefined) this.binding.channel.release(this.binding.id);
		this.binding = undefined;
		this.host.forgetRemote(this);
	}

	// ─── driven by the link ───

	bound(channel: RemoteChannel, id: number): void {
		this.binding = { channel, id };
	}

	shaped(shape: Shape): void {
		if (this.status === "released" || this.status === "gone") return;
		this.shape = shape;
		const wasLoading = this.status === "loading";
		this.status = "live";
		if (wasLoading) this.#statusChanged();
		if (wasLoading) {
			this.#settleReady?.resolve();
			this.#settleReady = undefined;
			this.#live.resolve();
		}
		for (const readable of this.#readables.values()) readable.bind();
		for (const listener of [...this.shapeListeners]) {
			try {
				listener(shape);
			} catch (error) {
				this.host.report(error);
			}
		}
	}

	gone(error: unknown): void {
		if (this.status === "released" || this.status === "gone") return;
		this.status = "gone";
		this.error = error;
		this.#statusChanged();
		this.binding = undefined;
		this.#settleReady?.reject(error);
		this.#live.reject(error);
		for (const readable of this.#readables.values()) readable.stop();
		this.host.forgetRemote(this);
	}

	/** The link went down but may come back (upstream reconnect): wait, then re-hold. */
	detached(): void {
		if (this.status === "released" || this.status === "gone") return;
		this.binding = undefined;
		for (const readable of this.#readables.values()) readable.detach();
		if (this.status === "live") {
			this.status = "loading";
			this.#live = this.#newLive();
			this.#statusChanged();
		}
	}

	// ─── members ───

	member(name: string): unknown {
		const description = Object.values(this.contract.description.variants)
			.map((members) => members[name])
			.find((member) => member !== undefined);
		if (description?.kind === "method") return this.#caller(name);
		if (description?.kind === "state") {
			let readable = this.#readables.get(name);
			if (readable === undefined) {
				readable = new RemoteReadable(this, name);
				this.#readables.set(name, readable);
			}
			return readable;
		}
		return undefined;
	}

	#caller(name: string): (args: unknown, ctx?: Ctx) => Promise<unknown> {
		let caller = this.#callers.get(name);
		if (caller === undefined) {
			caller = (args, ctx) => {
				if (this.host.inFactory > 0)
					throw new ChordError("not_ready", `${this.address}.${name} called inside a factory`);
				if (ctx instanceof CtxImpl) {
					try {
						ctx.check(ctx.host);
					} catch (error) {
						return Promise.reject(error);
					}
				}
				if (ctx === undefined || (ctx instanceof CtxImpl && ctx.holder)) {
					return this.host.root((root) => this.#call(name, args, root), { signal: ctx?.signal });
				}
				return this.#call(name, args, ctx);
			};
			this.#callers.set(name, caller);
		}
		return caller;
	}

	async #call(name: string, args: unknown, ctx: Ctx): Promise<unknown> {
		for (;;) {
			if (this.status === "released" || this.status === "gone") {
				throw this.status === "gone" ? this.error : new ChordError("released", `handle ${this.address} released`);
			}
			if (this.status === "loading") await raceSignal(this.#live.promise, ctx.signal);
			const binding = this.binding;
			if (binding === undefined) continue;
			const kind = this.shape?.kind;
			if (kind === undefined || this.contract.description.variants[kind]?.[name]?.kind !== "method") {
				throw new ChordError("not_in_variant", `${this.address}: ${name} is not a method of variant ${kind}`);
			}
			// Send only what the consumer's own schema knows (the additive rule's premise; see RecordImpl.call).
			const description = this.contract.description.variants[kind]?.[name];
			const sent = description?.kind === "method" ? Value.Clean(description.args, Value.Clone(args)) : args;
			return binding.channel.call(binding.id, name, sent, { rootId: ctx.rootId, epoch: ctx.epoch }, ctx.signal);
		}
	}

	#newLive(): { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } {
		let resolve = noop;
		let reject: (error: unknown) => void = noop;
		const promise = new Promise<void>((done, fail) => {
			resolve = done;
			reject = fail;
		});
		promise.catch(noop);
		return { promise, resolve, reject };
	}
}
