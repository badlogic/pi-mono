/**
 * Hook runner - executes hooks and manages their lifecycle.
 */

import { spawn } from "node:child_process";
import type { LoadedHook, SendHandler } from "./loader.js";
import type {
	BranchEventResult,
	ExecOptions,
	ExecResult,
	HookError,
	HookEvent,
	HookEventContext,
	HookUIContext,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEventResult,
} from "./types.js";

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
 * Supports cancellation via AbortSignal and timeout.
 */
async function exec(command: string, args: string[], cwd: string, options?: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, { cwd, shell: false });

		let stdout = "";
		let stderr = "";
		let killed = false;
		let timeoutId: NodeJS.Timeout | undefined;

		const killProcess = () => {
			if (!killed) {
				killed = true;
				proc.kill("SIGTERM");
				// Force kill after 5 seconds if SIGTERM doesn't work
				setTimeout(() => {
					if (!proc.killed) {
						proc.kill("SIGKILL");
					}
				}, 5000);
			}
		};

		// Handle abort signal
		if (options?.signal) {
			if (options.signal.aborted) {
				killProcess();
			} else {
				options.signal.addEventListener("abort", killProcess, { once: true });
			}
		}

		// Handle timeout
		if (options?.timeout && options.timeout > 0) {
			timeoutId = setTimeout(() => {
				killProcess();
			}, options.timeout);
		}

		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.signal) {
				options.signal.removeEventListener("abort", killProcess);
			}
			resolve({ stdout, stderr, code: code ?? 0, killed });
		});

		proc.on("error", (_err) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.signal) {
				options.signal.removeEventListener("abort", killProcess);
			}
			resolve({ stdout, stderr, code: 1, killed });
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

/** No-op UI context used when no UI is available */
const noOpUIContext: HookUIContext = {
	select: async () => null,
	confirm: async () => false,
	input: async () => null,
	notify: () => {},
};

/**
 * HookRunner executes hooks and manages event emission.
 */
export class HookRunner {
	private hooks: LoadedHook[];
	private uiContext: HookUIContext;
	private hasUI: boolean;
	private cwd: string;
	private sessionFile: string | null;
	private timeout: number;
	private errorListeners: Set<HookErrorListener> = new Set();

	constructor(hooks: LoadedHook[], cwd: string, timeout: number = DEFAULT_TIMEOUT) {
		this.hooks = hooks;
		this.uiContext = noOpUIContext;
		this.hasUI = false;
		this.cwd = cwd;
		this.sessionFile = null;
		this.timeout = timeout;
	}

	/**
	 * Set the UI context for hooks.
	 * Call this when the mode initializes and UI is available.
	 */
	setUIContext(uiContext: HookUIContext, hasUI: boolean): void {
		this.uiContext = uiContext;
		this.hasUI = hasUI;
	}

	/**
	 * Get the paths of all loaded hooks.
	 */
	getHookPaths(): string[] {
		return this.hooks.map((h) => h.path);
	}

	/**
	 * Set the session file path.
	 */
	setSessionFile(sessionFile: string | null): void {
		this.sessionFile = sessionFile;
	}

	/**
	 * Set the send handler for all hooks' pi.send().
	 * Call this when the mode initializes.
	 */
	setSendHandler(handler: SendHandler): void {
		for (const hook of this.hooks) {
			hook.setSendHandler(handler);
		}
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
			exec: (command: string, args: string[], options?: ExecOptions) => exec(command, args, this.cwd, options),
			ui: this.uiContext,
			hasUI: this.hasUI,
			cwd: this.cwd,
			sessionFile: this.sessionFile,
		};
	}

	/**
	 * Emit an event to all hooks.
	 * Returns the result from branch/tool_result events (if any handler returns one).
	 */
	async emit(event: HookEvent): Promise<BranchEventResult | ToolResultEventResult | undefined> {
		const ctx = this.createContext();
		let result: BranchEventResult | ToolResultEventResult | undefined;

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

					// For tool_result events, capture the result
					if (event.type === "tool_result" && handlerResult) {
						result = handlerResult as ToolResultEventResult;
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

	/**
	 * Emit a tool_call event to all hooks.
	 * No timeout - user prompts can take as long as needed.
	 * Errors are thrown (not swallowed) so caller can block on failure.
	 */
	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		const ctx = this.createContext();
		let result: ToolCallEventResult | undefined;

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get("tool_call");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				// No timeout - let user take their time
				const handlerResult = await handler(event, ctx);

				if (handlerResult) {
					result = handlerResult as ToolCallEventResult;
					// If blocked, stop processing further hooks
					if (result.block) {
						return result;
					}
				}
			}
		}

		return result;
	}
}
