import type { HookConfig, HookContext, HookEvent, HookModule, HookStorageContext } from "./types.js";

/**
 * Default timeout for hook execution (30 seconds).
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Event type to handler method name mapping.
 */
const EVENT_TO_HANDLER: Record<string, keyof HookModule> = {
	agent_start: "onAgentStart",
	agent_end: "onAgentEnd",
	turn_start: "onTurnStart",
	turn_end: "onTurnEnd",
	message_start: "onMessageStart",
	message_update: "onMessageUpdate",
	message_end: "onMessageEnd",
	tool_execution_start: "onToolExecutionStart",
	tool_execution_end: "onToolExecutionEnd",
	branch: "onBranch",
	command: "onCommand",
	session_load: "onSessionLoad",
	session_save: "onSessionSave",
};

/**
 * Error emitted when a hook fails.
 */
export interface HookError {
	hookId: string;
	event: string;
	error: string;
}

/**
 * Listener for hook errors.
 */
export type HookErrorListener = (error: HookError) => void;

/**
 * Hook runner manages hook execution for events.
 */
export class HookRunner {
	private hooks: Map<string, HookModule>;
	private eventHandlers: Map<string, Array<{ hook: HookModule; timeout: number }>>;
	private errorListeners: Set<HookErrorListener> = new Set();

	constructor(hooks: Map<string, HookModule>, configs: HookConfig[]) {
		this.hooks = hooks;
		this.eventHandlers = this.buildEventIndex(configs);
	}

	/**
	 * Build an index of event types to their handlers.
	 */
	private buildEventIndex(configs: HookConfig[]): Map<string, Array<{ hook: HookModule; timeout: number }>> {
		const index = new Map<string, Array<{ hook: HookModule; timeout: number }>>();

		for (const config of configs) {
			if (!config.enabled) continue;

			const hook = this.hooks.get(config.id);
			if (!hook) continue;

			for (const eventType of config.events) {
				const handlers = index.get(eventType) ?? [];
				handlers.push({
					hook,
					timeout: config.timeout ?? DEFAULT_TIMEOUT,
				});
				index.set(eventType, handlers);
			}
		}

		return index;
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
	 * Run a single hook handler with timeout and abort support.
	 */
	private async runHook(
		hook: HookModule,
		event: HookEvent,
		ctx: HookContext,
		timeout: number,
	): Promise<HookError | null> {
		const handlerName = EVENT_TO_HANDLER[event.type];
		if (!handlerName) {
			return null; // Unknown event type, skip
		}

		const handler = hook[handlerName] as ((event: HookEvent, ctx: HookContext) => Promise<void>) | undefined;
		if (typeof handler !== "function") {
			return null; // No handler for this event
		}

		// Create abort controller for this hook execution
		const controller = new AbortController();

		// Create context with abort signal
		const hookCtx: HookContext = {
			...ctx,
			signal: controller.signal,
		};

		// Create timeout promise with clearable timer
		let timeoutId: ReturnType<typeof setTimeout>;
		const timeoutPromise = new Promise<"timeout">((resolve) => {
			timeoutId = setTimeout(() => {
				controller.abort();
				resolve("timeout");
			}, timeout);
		});

		try {
			const result = await Promise.race([
				handler.call(hook, event, hookCtx).then(() => "success" as const),
				timeoutPromise,
			]);

			if (result === "timeout") {
				const error: HookError = {
					hookId: hook.id,
					event: event.type,
					error: `Hook timed out after ${timeout}ms`,
				};
				this.emitError(error);
				return error;
			}

			return null;
		} catch (err) {
			const error: HookError = {
				hookId: hook.id,
				event: event.type,
				error: err instanceof Error ? err.message : String(err),
			};
			this.emitError(error);
			return error;
		} finally {
			clearTimeout(timeoutId!);
		}
	}

	/**
	 * Emit an event to all subscribed hooks.
	 * Hooks run sequentially to avoid race conditions.
	 * Errors are caught and emitted, but don't stop other hooks.
	 *
	 * @param event - The event to emit
	 * @param ctx - Base context (storage will be replaced per-hook)
	 * @param createStorage - Factory to create per-hook storage (required)
	 */
	async emit(
		event: HookEvent,
		ctx: Omit<HookContext, "storage" | "signal">,
		createStorage: (hookId: string) => HookStorageContext,
	): Promise<HookError[]> {
		const handlers = this.eventHandlers.get(event.type) ?? [];
		const errors: HookError[] = [];

		for (const { hook, timeout } of handlers) {
			// Create per-hook context with isolated storage
			// Signal is added in runHook
			const hookCtx = {
				...ctx,
				storage: createStorage(hook.id),
				signal: undefined as unknown as AbortSignal, // Placeholder, set in runHook
			} as HookContext;

			const error = await this.runHook(hook, event, hookCtx, timeout);
			if (error) {
				errors.push(error);
			}
		}

		return errors;
	}

	/**
	 * Check if any hooks are registered for an event type.
	 */
	hasHandlers(eventType: string): boolean {
		const handlers = this.eventHandlers.get(eventType);
		return handlers !== undefined && handlers.length > 0;
	}

	/**
	 * Get all registered hook IDs.
	 */
	getHookIds(): string[] {
		return Array.from(this.hooks.keys());
	}
}
