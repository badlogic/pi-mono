/**
 * Browser os fallbacks with sensible defaults.
 */

export function homedir(): string {
	return "/home/browser";
}

export function platform(): string {
	return "browser";
}

export function tmpdir(): string {
	return "/tmp";
}

export function arch(): string {
	return "wasm";
}
