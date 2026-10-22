import type { Context, JsonValue, WatchEnd, WatchHandle } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { Op } from "@earendil-works/chord/delta";
import { errorMessage } from "../errors.ts";
import type { JsonObject } from "../types.ts";

export type ObservedDocumentValue = Readonly<JsonObject> | null;

/** Maximum exact committed frames retained behind one unavailable watch listener. */
const MAX_PENDING_WATCH_FRAMES = 100;

/** Canonical terminal frame of a retired document incarnation. */
const RETIREMENT_OPERATIONS: readonly Op[] = [["r", null]];

type WatchFrame<T> = {
	readonly value: T;
	readonly ops: readonly Op[];
	readonly context: Context;
	/** The retirement frame: the watch ends `retired` once it is delivered. */
	readonly retires?: true;
};

type WatchListener<T> = (value: T, ops: readonly Op[], context: Context) => Promise<void>;

/**
 * Serialized exact-frame watch bound to one document incarnation or conversation view. Its source ends it explicitly:
 * `retire()` for a retired document, `end()` for a closed or failed Session. Termination drops every reference the
 * watch holds into its source, so a stopped watch that is still referenced keeps nothing but its last value alive.
 * @internal
 */
export class CommittedWatch<T = ObservedDocumentValue> implements WatchHandle<T> {
	#detach: (() => void) | undefined;
	#report: ((error: unknown) => void) | undefined;
	#replace: (() => T) | undefined;
	readonly #closed = Promise.withResolvers<WatchEnd>();
	readonly #pending: WatchFrame<T>[] = [];
	#value: T;
	#listener: WatchListener<T> | undefined;
	#started = false;
	#scheduled = false;
	#running = false;
	#retired = false;
	/** Set once, by `#terminate()`. */
	#end: WatchEnd | undefined;
	#cancellationSignal: AbortSignal | undefined;
	#cancellationListener: (() => void) | undefined;

	/**
	 * `report` gets a listener's throw, which also ends the watch. `replace` gives the value an overflow delivers; by
	 * default the newest value.
	 */
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

	start(listener: WatchListener<T>): void {
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

	observeCancellation(signal: AbortSignal): void {
		if (this.#cancellationSignal !== undefined) throw new Error("Watch cancellation is already installed");
		if (this.#end !== undefined) return;
		this.#cancellationSignal = signal;
		this.#cancellationListener = () => this.cancel();
		signal.addEventListener("abort", this.#cancellationListener, { once: true });
		if (signal.aborted) this.cancel();
	}

	cancel(): void {
		this.#terminate({ reason: "cancelled" });
	}

	/** The source closed: end with `ended`, or with `failed` and the error when the Session failed. */
	end(failure?: { readonly error: unknown }): void {
		this.#terminate(failure === undefined ? { reason: "ended" } : { reason: "failed", error: failure.error });
	}

	advance(value: T, ops: readonly Op[], context: Context): void {
		if (this.#end !== undefined || this.#retired) return;
		if (this.#pending.length >= MAX_PENDING_WATCH_FRAMES) {
			this.#pending.length = 0;
			const replacement = this.#replace?.() ?? value;
			this.#pending.push({ value: replacement, ops: [["r", replacement as JsonValue]], context });
		} else {
			this.#pending.push({ value, ops, context });
		}
		if (this.#started) this.#schedule();
	}

	/**
	 * The document incarnation retired: queue the last frame, `[["r", null]]` with value `null`, after which the watch
	 * ends `retired`. An overflowing backlog is dropped, since the frame replaces the root anyway.
	 */
	retire(this: CommittedWatch<ObservedDocumentValue>, context: Context): void {
		if (this.#end !== undefined || this.#retired) return;
		this.#retired = true;
		if (this.#pending.length >= MAX_PENDING_WATCH_FRAMES) this.#pending.length = 0;
		this.#pending.push({ value: null, ops: RETIREMENT_OPERATIONS, context, retires: true });
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
					await listener(frame.value, frame.ops, deliveryContext);
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
	return error instanceof Error ? error : new Error(errorMessage(error));
}
