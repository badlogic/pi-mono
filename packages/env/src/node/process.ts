/**
 * Node.js process implementation — re-exports from global process.
 */

export function cwd(): string {
	return process.cwd();
}

export function exit(code?: number): never {
	process.exit(code);
}

export function kill(pid: number, signal?: string | number): void {
	process.kill(pid, signal);
}

export const env: Record<string, string | undefined> = process.env;

export const platformName: string = process.platform;

export const execPath: string = process.execPath;

export const versions: Record<string, string> = process.versions as Record<string, string>;
