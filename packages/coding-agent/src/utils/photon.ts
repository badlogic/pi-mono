/**
 * Photon image processing wrapper.
 *
 * This module provides a unified interface to @silvia-odwyer/photon-node that works in:
 * 1. Node.js (development, npm run build)
 * 2. Bun compiled binaries (standalone distribution)
 *
 * The challenge: photon-node's CJS entry uses fs.readFileSync(__dirname + '/photon_rs_bg.wasm')
 * which bakes the build machine's absolute path into Bun compiled binaries.
 *
 * Solution: Lazy-load photon and gracefully handle failures. Image processing functions
 * already have fallbacks that return original images when photon isn't available.
 */

// Re-export types from the main package
export type { PhotonImage as PhotonImageType } from "@silvia-odwyer/photon-node";

// Lazy-loaded photon module
let photonModule: typeof import("@silvia-odwyer/photon-node") | null = null;
let loadAttempted = false;
let loadError: Error | null = null;

/**
 * Get the photon module, loading it lazily on first access.
 * Returns null if loading fails (e.g., in broken Bun binary).
 */
export function getPhoton(): typeof import("@silvia-odwyer/photon-node") | null {
	if (loadAttempted) {
		return photonModule;
	}

	loadAttempted = true;

	try {
		// Dynamic require to defer loading until actually needed
		// This also allows the error to be caught gracefully
		photonModule = require("@silvia-odwyer/photon-node");
	} catch (e) {
		loadError = e as Error;
		photonModule = null;
	}

	return photonModule;
}

/**
 * Check if photon is available and working.
 */
export function isPhotonAvailable(): boolean {
	return getPhoton() !== null;
}

/**
 * Get the error that occurred during photon loading, if any.
 */
export function getPhotonLoadError(): Error | null {
	getPhoton(); // Ensure load was attempted
	return loadError;
}
