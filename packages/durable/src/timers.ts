import type { SetTimer } from "./types.ts";

/** Longest delay `setTimeout` supports; a longer one fires early, and its caller arms again. */
const MAX_TIMER_DELAY = 2_147_483_647;

/**
 * Cloudflare Workers: a pending timer keeps a Durable Object from hibernating or being evicted, even an unreferenced
 * one (`nodejs_compat` gives timers an `unref()` that changes nothing).
 */
const inWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * The default `HarnessOptions.setTimer`: `setTimeout`. A background timer is unreferenced, so it never keeps the
 * process alive. It is declined in Cloudflare Workers and wherever timers cannot be unreferenced.
 */
export const nativeTimer: SetTimer = (callback, delayMs, options) => {
	if (options.background && inWorkers) return undefined;
	const handle = setTimeout(callback, Math.min(Math.max(0, delayMs), MAX_TIMER_DELAY));
	if (options.background) {
		const unref = (handle as { unref?: unknown }).unref;
		if (typeof unref !== "function") {
			clearTimeout(handle);
			return undefined;
		}
		unref.call(handle);
	}
	return () => clearTimeout(handle);
};

/** Timers the Session and Harness arm through the host's `setTimer`. */
export type Timers = {
	/** A timer that paces or resumes work. A host that declines it is reported, and the timer never fires. */
	foreground(callback: () => void, delayMs: number): () => void;
	/** A timer that only frees memory; `undefined` when the host declines it. */
	background(callback: () => void, delayMs: number): (() => void) | undefined;
};

/** Wrap a host `setTimer`: a throw or a declined foreground timer is reported, and arms nothing. */
export function hostTimers(setTimer: SetTimer | undefined, report: (error: unknown) => void): Timers {
	const arm = setTimer ?? nativeTimer;
	return {
		foreground: (callback, delayMs) => {
			try {
				const disarm = arm(callback, delayMs, { background: false });
				if (disarm !== undefined) return disarm;
				report(new Error("HarnessOptions.setTimer declined a timer that paces work"));
			} catch (error) {
				report(error);
			}
			return () => {};
		},
		background: (callback, delayMs) => {
			try {
				return arm(callback, delayMs, { background: true });
			} catch (error) {
				report(error);
				return undefined;
			}
		},
	};
}
