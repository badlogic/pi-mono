/**
 * Browser child_process stubs.
 *
 * Child process operations are not available in the browser.
 * Use the tool Operations interfaces (BashOperations, etc.) to delegate
 * command execution to a backend server via RPC.
 */

const NOT_AVAILABLE = "child_process is not available in browser environment. Use RPC-based tool operations.";

export type ChildProcess = never;
export type SpawnOptions = Record<string, unknown>;

export function spawn(_command: string, _args?: string[], _options?: unknown): never {
	throw new Error(NOT_AVAILABLE);
}

export function spawnSync(_command: string, _args?: string[], _options?: unknown): never {
	throw new Error(NOT_AVAILABLE);
}

export function exec(_command: string, _options?: unknown, _callback?: unknown): never {
	throw new Error(NOT_AVAILABLE);
}

export function execSync(_command: string, _options?: unknown): never {
	throw new Error(NOT_AVAILABLE);
}
