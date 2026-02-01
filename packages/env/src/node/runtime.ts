export const isNode = true;
export const isBrowser = false;

/** Whether running under the Bun runtime (either via `bun run` or as a compiled binary) */
export const isBun = !!process.versions.bun;

/**
 * Whether running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path).
 *
 * NOTE: Initialized to false — call `detectBunBinary(import.meta.url)` from your entry point.
 */
let _isBunBinary = false;

export function isBunBinary(): boolean {
	return _isBunBinary;
}

/**
 * Detect if running as a Bun compiled binary based on the caller's import.meta.url.
 * Call once from your entry point:
 * ```ts
 * import { detectBunBinary } from "@mariozechner/pi-env";
 * detectBunBinary(import.meta.url);
 * ```
 */
export function detectBunBinary(importMetaUrl: string): boolean {
	_isBunBinary =
		importMetaUrl.includes("$bunfs") || importMetaUrl.includes("~BUN") || importMetaUrl.includes("%7EBUN");
	return _isBunBinary;
}
