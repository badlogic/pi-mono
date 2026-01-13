/**
 * Singleton wrapper for wasm-vips initialization.
 * wasm-vips requires async initialization, so we cache the instance.
 */

import type Vips from "wasm-vips";

let vipsInstance: Awaited<ReturnType<typeof Vips>> | null = null;
let vipsInitPromise: Promise<Awaited<ReturnType<typeof Vips>> | null> | null = null;

/**
 * Get the initialized wasm-vips instance.
 * Returns null if wasm-vips is not available or fails to initialize.
 */
export async function getVips(): Promise<Awaited<ReturnType<typeof Vips>> | null> {
	if (vipsInstance) {
		return vipsInstance;
	}

	if (vipsInitPromise) {
		return vipsInitPromise;
	}

	vipsInitPromise = (async () => {
		try {
			const VipsInit = (await import("wasm-vips")).default;
			vipsInstance = await VipsInit();
			return vipsInstance;
		} catch {
			// wasm-vips not available
			return null;
		}
	})();

	const result = await vipsInitPromise;
	if (!result) {
		vipsInitPromise = null; // Allow retry on failure
	}
	return result;
}
