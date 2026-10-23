// Watch handles: the watch types and the one implementation of their lifecycle, for JSON and native values.
import { type Context, withoutAbortSignal } from "./context/index.ts";
import type { Op } from "./delta/index.ts";
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

/** Serialized exact-frame observation of an immutable value with bounded pending delivery. */
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
 * convention (JSON for state); each watch starts at the current value and then gets one frame per change.
 */
export interface Watchable<T> {
	/** The current value. */
	readonly value: T;
	/** A watch holding the current value, then one frame per change; the context's cancellation ends it. */
	watch(context: Context): Promise<WatchHandle<T>>;
}

/** Serialized observation of an in-process value: as `WatchHandle`, but a change is a new value without ops. */
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

type WatchFrame<T> = {
	readonly value: T;
	readonly ops: readonly Op[];
	readonly context: Context;
	/** The retirement frame: the watch ends `retired` once it is delivered. */
	readonly retires?: true;
};

/** Maximum frames retained behind one unavailable watch listener. */
const MAX_PENDING_WATCH_FRAMES = 100;

/**
 * The lifecycle both handles share: pending frames, serialized delivery, and termination. A source feeds it and ends
 * it explicitly; termination drops every reference the watch holds into its source, so a stopped watch that is still
 * referenced keeps nothing but its last value alive. Subclasses supply only how a listener is called and the ops of an
 * overflow frame.
 */
abstract class WatchLifecycle<T, L> {
	#detach: (() => void) | undefined;
	#report: ((error: unknown) => void) | undefined;
	#replace: (() => T) | undefined;
	readonly #closed = Promise.withResolvers<WatchEnd>();
	readonly #pending: WatchFrame<T>[] = [];
	#value: T;
	#listener: L | undefined;
	#started = false;
	#scheduled = false;
	#running = false;
	#retired = false;
	/** Set once, by `#terminate()`. */
	#end: WatchEnd | undefined;
	#cancellationSignal: AbortSignal | undefined;
	#cancellationListener: (() => void) | undefined;

	constructor(value: T, detach: () => void, report: (error: unknown) => void, replace?: () => T) {
		this.#value = value;
		this.#detach = detach;
		this.#report = report;
		this.#replace = replace;
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
		if (this.#pending.length > 0) this.#schedule();
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

	/** Call `listener` with one frame. */
	protected abstract invoke(listener: L, frame: WatchFrame<T>, context: Context): Promise<void>;

	/** The ops of the frame an overflow delivers instead of the backlog, whose value is `value`. */
	protected abstract overflowOps(value: T): readonly Op[];

	/** Queue one frame; past the bound the backlog collapses to one frame of `replace()` or the newest value. */
	protected enqueue(value: T, ops: readonly Op[], context: Context): void {
		if (this.#end !== undefined || this.#retired) return;
		if (this.#pending.length >= MAX_PENDING_WATCH_FRAMES) {
			this.#pending.length = 0;
			const replacement = this.#replace?.() ?? value;
			this.#pending.push({ value: replacement, ops: this.overflowOps(replacement), context });
		} else {
			this.#pending.push({ value, ops, context });
		}
		if (this.#started) this.#schedule();
	}

	/**
	 * Queue the last frame, after which the watch ends `retired`. An overflowing backlog is dropped, since the frame
	 * replaces the root anyway.
	 */
	protected enqueueRetirement(value: T, ops: readonly Op[], context: Context): void {
		if (this.#end !== undefined || this.#retired) return;
		this.#retired = true;
		if (this.#pending.length >= MAX_PENDING_WATCH_FRAMES) this.#pending.length = 0;
		this.#pending.push({ value, ops, context, retires: true });
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

	async #drain(): Promise<void> {
		if (this.#running || this.#end !== undefined || !this.#started) return;
		this.#running = true;
		try {
			while (this.#end === undefined) {
				const frame = this.#pending.shift();
				const listener = this.#listener;
				if (frame === undefined || listener === undefined) break;
				this.#value = frame.value;
				const deliveryContext = withoutAbortSignal(frame.context);
				try {
					await this.invoke(listener, frame, deliveryContext);
				} catch (error) {
					if (this.#end === undefined) {
						this.#report?.(error);
						this.#terminate({ reason: "listener_error", error: toError(error) });
					}
					break;
				}
				if (frame.retires === true) {
					this.#terminate({ reason: "retired" });
					break;
				}
			}
		} finally {
			this.#running = false;
			if (this.#end === undefined && this.#pending.length > 0) this.#schedule();
		}
	}

	/**
	 * End the watch, once: detach, drop pending frames and every reference into the source, and settle `closed`. A
	 * callback already running keeps running.
	 */
	#terminate(end: WatchEnd): void {
		if (this.#end !== undefined) return;
		this.#end = end;
		const detach = this.#detach;
		this.#detach = undefined;
		this.#report = undefined;
		this.#replace = undefined;
		this.#listener = undefined;
		this.#pending.length = 0;
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

/** Canonical terminal frame of a retired source. */
const RETIREMENT_OPERATIONS: readonly Op[] = [["r", null]];

/**
 * The watch handle of a JSON source: exact frames in order, an overflow becomes one root replacement `[["r", newest]]`.
 * `detach` unsubscribes it from its source on termination; `report` gets a listener's throw, which also ends the
 * watch; `replace` gives the value an overflow delivers, by default the newest value.
 */
export class Watch<T> extends WatchLifecycle<T, WatchListener<T>> implements WatchHandle<T> {
	/** Queue the frame `ops`, which turn the previous value into `value`. */
	advance(value: T, ops: readonly Op[], context: Context): void {
		this.enqueue(value, ops, context);
	}

	/**
	 * The source retired: queue the last frame, `[["r", null]]` with value `null`, then end `retired`. Typed for watches
	 * whose values include `null`.
	 */
	retire(this: Watch<T | null>, context: Context): void {
		this.enqueueRetirement(null, RETIREMENT_OPERATIONS, context);
	}

	protected invoke(listener: WatchListener<T>, frame: WatchFrame<T>, context: Context): Promise<void> {
		return listener(frame.value, frame.ops, context);
	}

	protected overflowOps(value: T): readonly Op[] {
		// Values of a JSON watch are JSON; `T` is the source's narrower or wider view of them (e.g. a typed document).
		return [["r", value as JsonValue]];
	}
}

const NO_OPS: readonly Op[] = [];

/**
 * The watch handle of a native source: values in order, an overflow collapses to the newest value. `detach` and
 * `report` as for `Watch`.
 */
export class NativeWatch<T> extends WatchLifecycle<T, NativeWatchListener<T>> implements NativeWatchHandle<T> {
	constructor(value: T, detach: () => void, report: (error: unknown) => void) {
		// No replacement: an overflow delivers the newest value.
		super(value, detach, report, undefined);
	}

	/** Queue `value`, the source's new value. */
	advance(value: T, context: Context): void {
		this.enqueue(value, NO_OPS, context);
	}

	protected invoke(listener: NativeWatchListener<T>, frame: WatchFrame<T>, context: Context): Promise<void> {
		return listener(frame.value, context);
	}

	protected overflowOps(): readonly Op[] {
		return NO_OPS;
	}
}
