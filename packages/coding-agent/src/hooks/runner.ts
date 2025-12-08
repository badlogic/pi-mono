import { spawn } from "child_process";
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

		proc.on("error", (err) => {
			resolve({ stdout, stderr: err.message, code: 1 });
		});

		proc.on("close", (code) => {
			resolve({ stdout, stderr, code: code ?? 0 });
		});
	});
}

/**
 * Run a handler with timeout.
 */
async function runWithTimeout<T>(
	fn: () => Promise<T>,
	timeout: number,
): Promise<{ result: T | undefined; timedOut: boolean }> {
	let timeoutId: ReturnType<typeof setTimeout>;

	const timeoutPromise = new Promise<{ result: undefined; timedOut: true }>((resolve) => {
		timeoutId = setTimeout(() => {
			resolve({ result: undefined, timedOut: true });
		}, timeout);
	});

	const resultPromise = fn().then((result) => ({ result, timedOut: false as const }));

	try {
		const outcome = await Promise.race([resultPromise, timeoutPromise]);
		return outcome;
	} finally {
		clearTimeout(timeoutId!);
	}
}

/**
 * Hook runner manages hook execution for events.
 */
export class HookRunner {
	private hooks: LoadedHook[];
	private timeout: number;
	private errorListeners: Set<HookErrorListener> = new Set();
	private cwd: string;
	private uiContext: HookUIContext;

	constructor(hooks: LoadedHook[], uiContext: HookUIContext, cwd: string, timeout = DEFAULT_TIMEOUT) {
		this.hooks = hooks;
		this.uiContext = uiContext;
		this.cwd = cwd;
		this.timeout = timeout;
	}

	/**
	 * Add a listener for hook errors.
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
			try {
				listener(error);
			} catch {
				// Ignore errors in error listeners
			}
		}
	}

	/**
	 * Create the context object passed to handlers.
	 */
	private createContext(): HookEventContext {
		return {
			exec: (command: string, args: string[]) => exec(command, args, this.cwd),
			ui: this.uiContext,
			cwd: this.cwd,
		};
	}

	/**
	 * Emit an event to all subscribed hooks.
	 * For 'branch' events, returns the first non-void result.
	 */
	async emit(event: HookEvent): Promise<BranchEventResult | undefined> {
		const ctx = this.createContext();

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type) ?? [];

			for (const handler of handlers) {
				try {
					const { result, timedOut } = await runWithTimeout(
						() => handler(event, ctx) as Promise<BranchEventResult | undefined>,
						this.timeout,
					);

					if (timedOut) {
						this.emitError({
							hookPath: hook.path,
							event: event.type,
							error: `Hook timed out after ${this.timeout}ms`,
						});
						continue;
					}

					// For branch events, return first non-void result
					if (event.type === "branch" && result !== undefined) {
						return result;
					}
				} catch (err) {
					this.emitError({
						hookPath: hook.path,
						event: event.type,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}
		}
	}

	/**
	 * Check if any hooks are registered for an event type.
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
}
