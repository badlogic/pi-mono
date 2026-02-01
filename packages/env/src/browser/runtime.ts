export const isNode = false;
export const isBrowser = true;

/** Never true in browser */
export const isBun = false;

/** Never true in browser */
export function isBunBinary(): boolean {
	return false;
}

/** No-op in browser */
export function detectBunBinary(_importMetaUrl: string): boolean {
	return false;
}
