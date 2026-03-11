/**
 * Fetch utilities for OAuth providers.
 *
 * All network calls in OAuth flows must be cancellable and time-bounded.
 * Without a timeout, a slow or unreachable endpoint hangs the UI forever with
 * no way for the user to recover short of killing the process.
 */

/** Default request timeout for OAuth network calls (30 seconds). */
export const OAUTH_FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch wrapper that enforces a deadline and respects an optional caller
 * AbortSignal.  Either the timeout or the caller signal can abort the request —
 * whichever fires first.
 *
 * @param url      - Request URL
 * @param init     - Standard RequestInit (signal field is replaced internally)
 * @param signal   - Optional caller-supplied AbortSignal (e.g. from the login
 *                   dialog's cancel button)
 * @param timeoutMs - Deadline in milliseconds (default: OAUTH_FETCH_TIMEOUT_MS)
 */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	signal?: AbortSignal,
	timeoutMs: number = OAUTH_FETCH_TIMEOUT_MS,
): Promise<Response> {
	const timeoutController = new AbortController();
	const timeoutId = setTimeout(
		() => timeoutController.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
		timeoutMs,
	);

	// Compose the deadline signal with the optional caller signal.
	// AbortSignal.any() resolves as soon as *any* of the signals fires.
	const composedSignal =
		signal != null ? AbortSignal.any([timeoutController.signal, signal]) : timeoutController.signal;

	try {
		const response = await fetch(url, { ...init, signal: composedSignal });
		return response;
	} catch (err) {
		// Translate timeout aborts into a friendlier error message.
		if (timeoutController.signal.aborted && !signal?.aborted) {
			throw new Error(
				`OAuth request timed out after ${timeoutMs / 1000}s. Check your internet connection and try again.`,
			);
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}
}
