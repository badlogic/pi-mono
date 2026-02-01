/**
 * Browser process fallbacks.
 */

let currentCwd = "/";

export function cwd(): string {
	return currentCwd;
}

/** Set the virtual working directory (browser only). */
export function chdir(dir: string): void {
	currentCwd = dir;
}

export function exit(_code?: number): never {
	throw new Error("process.exit() is not available in browser environment");
}

export function kill(_pid: number, _signal?: string | number): void {
	throw new Error("process.kill() is not available in browser environment");
}

export const env: Record<string, string | undefined> = {};

export const platformName = "browser";

export const execPath = "/browser";

export const versions: Record<string, string> = { browser: "1.0.0" };
