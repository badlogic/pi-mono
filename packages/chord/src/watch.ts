// Watch handles: the watch types and the one implementation of their lifecycle, for JSON and native values.
import { type Context, withoutAbortSignal } from "./context/index.ts";
import { type Op, PendingOps } from "./delta/index.ts";
import type { JsonValue } from "./json.ts";

/**
 * Terminal result of one watch.
 *
 * - `stopped`: `stop()` was called.
 * - `cancelled`: the context the watch was acquired with was cancelled.
 * - `retired`: the source was retired; its last frame was `[["r", null]]`.
 * - `ended`: the source closed (its owner ended or closed).
 * - `listener_error`: the listener threw or rejected with `error`.
 * - `failed`: the source failed with `error`.
 */
export type WatchEnd =
	| { readonly reason: "stopped" | "cancelled" | "retired" | "ended" }
	| { readonly reason: "listener_error"; readonly error: Error }
	| { readonly reason: "failed"; readonly error: unknown };

/**
 * Serialized observation of an immutable value: one listener call at a time; changes made meanwhile arrive folded into
 * the next call.
 */
export interface WatchHandle<T> {
	/** Acquisition revision before start; latest delivered immutable revision afterward. */
	readonly value: T;
	/** Install the sole asynchronous listener. Never invokes it inline. */
	start(listener: (value: T, ops: readonly Op[], context: Context) => Promise<void>): void;
	/** Idempotently stop future callbacks and return this watch's terminal result. */
	stop(): Promise<WatchEnd>;
	/** Settle when the watch terminates; an already-running callback remains caller-owned. */
	readonly closed: Promise<WatchEnd>;
}

/**
 * A value that changes and can be watched: documents, derives, members of references. Values are immutable by
 * convention (JSON for state); each watch starts at the current value and then gets the changes, folded while its
 * listener is busy.
 */
export interface Watchable<T> {
	/** The current value. */
	readonly value: T;
	/** A watch holding the current value, then its changes; the context's cancellation ends it. */
	watch(context: Context): Promise<WatchHandle<T>>;
}

/**
 * An in-process value that changes and can be watched (it may hold anything, errors and functions included): a change
 * is a new value by identity, delivered without ops.
 */
export interface NativeWatchable<T> {
	/** The current value. */
	readonly value: T;
	/** A watch holding the current value, then one frame per new value; the context's cancellation ends it. */
	watch(context: Context): Promise<NativeWatchHandle<T>>;
}

/**
 * Serialized observation of an in-process value: as `WatchHandle`, but each new value is its own call, in order, without
 * ops.
 */
export interface NativeWatchHandle<T> {
	/** Acquisition value before start; latest delivered value afterward. */
	readonly value: T;
	/** Install the sole asynchronous listener. Never invokes it inline. */
	start(listener: (value: T, context: Context) => Promise<void>): void;
	/** Idempotently stop future callbacks and return this watch's terminal result. */
	stop(): Promise<WatchEnd>;
	/** Settle when the watch terminates; an already-running callback remains caller-owned. */
	readonly closed: Promise<WatchEnd>;
}

type WatchListener<T> = (value: T, ops: readonly Op[], context: Context) => Promise<void>;

type NativeWatchListener<T> = (value: T, context: Context) => Promise<void>;

/** One listener call: the value it delivers and the context of the newest frame it covers. */
type Delivery<T> = {
	readonly value: T;
	readonly context: Context;
	/** The retirement: the watch ends `retired` once it is delivered. */
	readonly retires: boolean;
};

/**
 * The lifecycle both handles share: serialized delivery and termination. A source feeds it and ends it explicitly;
 * termination drops every reference the watch holds into its source, so a stopped watch that is still referenced keeps
 * nothing but its last value alive. Subclasses keep what is pending and say how a listener is called.
 */
abstract class WatchLifecycle<T, L, D extends Delivery<T>> {
	#detach: (() => void) | undefined;
	#report: ((error: unknown) => void) | undefined;
	readonly #closed = Promise.withResolvers<WatchEnd>();
	#value: T;
	#listener: L | undefined;
	#started = false;
	#scheduled = false;
	#running = false;
	/** Set once, by `#terminate()`. */
	#end: WatchEnd | undefined;
	#cancellationSignal: AbortSignal | undefined;
	#cancellationListener: (() => void) | undefined;

	constructor(value: T, detach: () => void, report: (error: unknown) => void) {
		this.#value = value;
		this.#detach = detach;
		this.#report = report;
	}

	get value(): T {
		return this.#value;
	}

	get closed(): Promise<WatchEnd> {
		return this.#closed.promise;
	}

	start(listener: L): void {
		if (this.#started) throw new Error("Watch is already started");
		if (this.#end !== undefined) throw new Error("Watch is stopped");
		this.#started = true;
		this.#listener = listener;
		this.#schedule();
	}

	stop(): Promise<WatchEnd> {
		this.#terminate({ reason: "stopped" });
		return this.#closed.promise;
	}

	/** End the watch `cancelled` when `signal` aborts; installed once. */
	observeCancellation(signal: AbortSignal): void {
		if (this.#cancellationSignal !== undefined) throw new Error("Watch cancellation is already installed");
		if (this.#end !== undefined) return;
		this.#cancellationSignal = signal;
		this.#cancellationListener = () => this.cancel();
		signal.addEventListener("abort", this.#cancellationListener, { once: true });
		if (signal.aborted) this.cancel();
	}

	/** End the watch `cancelled`: its acquisition context was cancelled. */
	cancel(): void {
		this.#terminate({ reason: "cancelled" });
	}

	/** The source closed: end with `ended`, or with `failed` and the error when the source failed. */
	end(failure?: { readonly error: unknown }): void {
		this.#terminate(failure === undefined ? { reason: "ended" } : { reason: "failed", error: failure.error });
	}

	/** Whether the watch still takes frames: it has not ended. */
	protected get open(): boolean {
		return this.#end === undefined;
	}

	/** Take the next delivery, or undefined when nothing is pending. */
	protected abstract next(): D | undefined;

	/** Call `listener` with one delivery. */
	protected abstract invoke(listener: L, delivery: D, context: Context): Promise<void>;

	/** Drop everything pending and every reference into the source; called once, on termination. */
	protected abstract release(): void;

	/** Something became pending: deliver it once started, never inline. */
	protected pending(): void {
		if (this.#started) this.#schedule();
	}

	#schedule(): void {
		if (this.#scheduled || this.#running || this.#end !== undefined) return;
		this.#scheduled = true;
		queueMicrotask(() => {
			this.#scheduled = false;
			void this.#drain();
		});
	}

	/** Deliver until nothing is pending; what arrives during a call is taken after it returns. */
	async #drain(): Promise<void> {
		if (this.#running || this.#end !== undefined || !this.#started) return;
		this.#running = true;
		try {
			while (this.#end === undefined) {
				const listener = this.#listener;
				if (listener === undefined) break;
				const delivery = this.next();
				if (delivery === undefined) break;
				this.#value = delivery.value;
				try {
					await this.invoke(listener, delivery, withoutAbortSignal(delivery.context));
				} catch (error) {
					if (this.#end === undefined) {
						this.#report?.(error);
						this.#terminate({ reason: "listener_error", error: toError(error) });
					}
					break;
				}
				if (delivery.retires) {
					this.#terminate({ reason: "retired" });
					break;
				}
			}
		} finally {
			this.#running = false;
		}
	}

	/**
	 * End the watch, once: detach, drop what is pending and every reference into the source, and settle `closed`. A
	 * callback already running keeps running.
	 */
	#terminate(end: WatchEnd): void {
		if (this.#end !== undefined) return;
		this.#end = end;
		const detach = this.#detach;
		this.#detach = undefined;
		this.#report = undefined;
		this.#listener = undefined;
		this.release();
		if (this.#cancellationListener !== undefined) {
			this.#cancellationSignal?.removeEventListener("abort", this.#cancellationListener);
		}
		this.#cancellationSignal = undefined;
		this.#cancellationListener = undefined;
		detach?.();
		this.#closed.resolve(end);
	}
}

function toError(error: unknown): Error {
	if (error instanceof Error) return error;
	try {
		return new Error(String(error));
	} catch {
		return new Error(Object.prototype.toString.call(error));
	}
}

type WatchDelivery<T> = Delivery<T> & { readonly ops: readonly Op[] };

/** Canonical terminal frame of a retired source. */
const RETIREMENT_OPERATIONS: readonly Op[] = [["r", null]];

/**
 * The watch handle of a JSON source. Frames that arrive before `start()` or while the listener runs wait in one
 * `PendingOps` queue; the next call gets the newest value, the folded ops of every frame since the previous call (or
 * `[["r", newest]]` after the queue overflowed) and the newest frame's context. `detach` unsubscribes it from its
 * source on termination; `report` gets a listener's throw, which also ends the watch.
 */
export class Watch<T> extends WatchLifecycle<T, WatchListener<T>, WatchDelivery<T>> implements WatchHandle<T> {
	readonly #ops = new PendingOps();
	/** The newest frame, while a call is pending. */
	#newest: { readonly value: T; readonly context: Context } | undefined;
	#retiring = false;

	/** Queue the frame `ops`, which turn the previous value into `value`. */
	advance(value: T, ops: readonly Op[], context: Context): void {
		if (!this.open || this.#retiring) return;
		this.#ops.push(ops);
		this.#newest = { value, context };
		this.pending();
	}

	/**
	 * The source retired: queue the last frame, `[["r", null]]` with value `null`, then end `retired`. Typed for watches
	 * whose values include `null`.
	 */
	retire(this: Watch<T | null>, context: Context): void {
		if (!this.open || this.#retiring) return;
		this.#retiring = true;
		this.#ops.push(RETIREMENT_OPERATIONS);
		this.#newest = { value: null, context };
		this.pending();
	}

	protected next(): WatchDelivery<T> | undefined {
		const newest = this.#newest;
		if (newest === undefined) return undefined;
		this.#newest = undefined;
		const batch = this.#ops.take();
		// Values of a JSON watch are JSON; `T` is the source's narrower or wider view of them (e.g. a typed document).
		const ops: readonly Op[] = batch.kind === "ops" ? batch.ops : [["r", newest.value as JsonValue]];
		// Nothing is queued after a retirement, so a retiring watch's pending call is its last.
		return { value: newest.value, ops, context: newest.context, retires: this.#retiring };
	}

	protected invoke(listener: WatchListener<T>, delivery: WatchDelivery<T>, context: Context): Promise<void> {
		return listener(delivery.value, delivery.ops, context);
	}

	protected release(): void {
		this.#ops.take();
		this.#newest = undefined;
	}
}

/** Maximum values retained behind one unavailable native watch listener. */
const MAX_PENDING_NATIVE_VALUES = 100;

/**
 * The watch handle of a native source: every value in order, one call each; past 100 pending values they collapse to
 * one, `replace()` or by default the newest value. `detach` and `report` as for `Watch`.
 */
export class NativeWatch<T>
	extends WatchLifecycle<T, NativeWatchListener<T>, Delivery<T>>
	implements NativeWatchHandle<T>
{
	readonly #pending: Delivery<T>[] = [];
	#replace: (() => T) | undefined;

	constructor(value: T, detach: () => void, report: (error: unknown) => void, replace?: () => T) {
		super(value, detach, report);
		this.#replace = replace;
	}

	/** Queue `value`, the source's new value. */
	advance(value: T, context: Context): void {
		if (!this.open) return;
		if (this.#pending.length < MAX_PENDING_NATIVE_VALUES) {
			this.#pending.push({ value, context, retires: false });
		} else {
			this.#pending.length = 0;
			const replacement = this.#replace === undefined ? value : this.#replace();
			this.#pending.push({ value: replacement, context, retires: false });
		}
		this.pending();
	}

	protected next(): Delivery<T> | undefined {
		return this.#pending.shift();
	}

	protected invoke(listener: NativeWatchListener<T>, delivery: Delivery<T>, context: Context): Promise<void> {
		return listener(delivery.value, context);
	}

	protected release(): void {
		this.#pending.length = 0;
		this.#replace = undefined;
	}
}
