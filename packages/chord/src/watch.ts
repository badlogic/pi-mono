import type { Context } from "./context/index.ts";
import type { Op } from "./delta/index.ts";

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
