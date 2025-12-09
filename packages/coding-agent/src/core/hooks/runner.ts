/**
 * Hook runner - executes hooks and manages their lifecycle.
 */

import { spawn } from "node:child_process";
import type { LoadedHook } from "./loader.js";
import type { BranchEventResult, ExecResult, HookError, HookEvent, HookEventContext, HookUIContext } from "./types.js";

/**
 * Default timeout for hook execution (30 seconds).
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Listener for hook errors.
 */
export type HookErrorListener = (error: HookError) => void;

/**
 * Execute a command and return stdout/stderr/code.
 */
async function exec(command: string, args: string[], cwd: string): Promise<ExecResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, { cwd, shell: false });

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			resolve({ stdout, stderr, code: code ?? 0 });
		});

		proc.on("error", (_err) => {
			resolve({ stdout, stderr, code: 1 });
		});
	});
}

/**
 * Create a promise that rejects after a timeout.
 */
function createTimeout(ms: number): { promise: Promise<never>; clear: () => void } {
	let timeoutId: NodeJS.Timeout;
	const promise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms`)), ms);
	});
	return {
		promise,
		clear: () => clearTimeout(timeoutId),
	};
}

/**
 * HookRunner executes hooks and manages event emission.
 */
export class HookRunner {
	private hooks: LoadedHook[];
	private uiContext: HookUIContext;
	private cwd: string;
	private timeout: number;
	private errorListeners: Set<HookErrorListener> = new Set();

	constructor(hooks: LoadedHook[], uiContext: HookUIContext, cwd: string, timeout: number = DEFAULT_TIMEOUT) {
		this.hooks = hooks;
		this.uiContext = uiContext;
		this.cwd = cwd;
		this.timeout = timeout;
	}

	/**
	 * Subscribe to hook errors.
	 * @returns Unsubscribe function
	 */
	onError(listener: HookErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	/**
	 * Emit an error to all listeners.
	 */
	private emitError(error: HookError): void {
		for (const listener of this.errorListeners) {
			listener(error);
		}
	}

	/**
	 * Check if any hooks have handlers for the given event type.
	 */
	hasHandlers(eventType: string): boolean {
		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(eventType);
			if (handlers && handlers.length > 0) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Create the event context for handlers.
	 */
	private createContext(): HookEventContext {
		return {
			exec: (command: string, args: string[]) => exec(command, args, this.cwd),
			ui: this.uiContext,
			cwd: this.cwd,
		};
	}

	/**
	 * Emit an event to all hooks.
	 * Returns the result from branch events (if any handler returns one).
	 */
	async emit(event: HookEvent): Promise<BranchEventResult | undefined> {
		const ctx = this.createContext();
		let result: BranchEventResult | undefined;

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const timeout = createTimeout(this.timeout);

					const handlerResult = await Promise.race([handler(event, ctx), timeout.promise]);

					timeout.clear();

					// For branch events, capture the result
					if (event.type === "branch" && handlerResult) {
						result = handlerResult as BranchEventResult;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this.emitError({
						hookPath: hook.path,
						event: event.type,
						error: message,
					});
				}
			}
		}

		return result;
	}
}
