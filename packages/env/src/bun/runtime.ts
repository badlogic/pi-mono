export const isNode = false;
export const isBrowser = false;

/** Always true when running under Bun */
export const isBun = true;

/**
 * Whether running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path).
 * This is detected automatically — no initialization call needed.
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");
