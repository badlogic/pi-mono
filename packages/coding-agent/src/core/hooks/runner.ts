/**
 * Hook runner - executes hooks and manages their lifecycle.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ModelRegistry } from "../model-registry.js";
import type { SessionManager } from "../session-manager.js";
import type { AppendEntryHandler, LoadedHook, SendMessageHandler } from "./loader.js";
import type {
	ContextEvent,
	ContextEventResult,
	HookError,
	HookEvent,
	HookEventContext,
	HookMessageRenderer,
	HookUIContext,
	RegisteredCommand,
	SessionEvent,
	SessionEventResult,
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

// Re-export execCommand for backward compatibility
export { execCommand } from "../exec.js";

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
	custom: () => ({ close: () => {}, requestRender: () => {} }),
};

/**
 * HookRunner executes hooks and manages event emission.
 */
export class HookRunner {
	private hooks: LoadedHook[];
	private uiContext: HookUIContext;
	private hasUI: boolean;
	private cwd: string;
	private sessionManager: SessionManager;
	private modelRegistry: ModelRegistry;
	private timeout: number;
	private errorListeners: Set<HookErrorListener> = new Set();

	constructor(
		hooks: LoadedHook[],
		cwd: string,
		sessionManager: SessionManager,
		modelRegistry: ModelRegistry,
		timeout: number = DEFAULT_TIMEOUT,
	) {
		this.hooks = hooks;
		this.uiContext = noOpUIContext;
		this.hasUI = false;
		this.cwd = cwd;
		this.sessionManager = sessionManager;
		this.modelRegistry = modelRegistry;
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
	 * Get the UI context (set by mode).
	 */
	getUIContext(): HookUIContext | null {
		return this.uiContext;
	}

	/**
	 * Get whether UI is available.
	 */
	getHasUI(): boolean {
		return this.hasUI;
	}

	/**
	 * Get the paths of all loaded hooks.
	 */
	getHookPaths(): string[] {
		return this.hooks.map((h) => h.path);
	}

	/**
	 * Set the send message handler for all hooks' pi.sendMessage().
	 * Call this when the mode initializes.
	 */
	setSendMessageHandler(handler: SendMessageHandler): void {
		for (const hook of this.hooks) {
			hook.setSendMessageHandler(handler);
		}
	}

	/**
	 * Set the append entry handler for all hooks' pi.appendEntry().
	 * Call this when the mode initializes.
	 */
	setAppendEntryHandler(handler: AppendEntryHandler): void {
		for (const hook of this.hooks) {
			hook.setAppendEntryHandler(handler);
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
	/**
	 * Emit an error to all error listeners.
	 */
	emitError(error: HookError): void {
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
	 * Get a message renderer for the given customType.
	 * Returns the first renderer found across all hooks, or undefined if none.
	 */
	getMessageRenderer(customType: string): HookMessageRenderer | undefined {
		for (const hook of this.hooks) {
			const renderer = hook.messageRenderers.get(customType);
			if (renderer) {
				return renderer;
			}
		}
		return undefined;
	}

	/**
	 * Get all registered commands from all hooks.
	 */
	getRegisteredCommands(): RegisteredCommand[] {
		const commands: RegisteredCommand[] = [];
		for (const hook of this.hooks) {
			for (const command of hook.commands.values()) {
				commands.push(command);
			}
		}
		return commands;
	}

	/**
	 * Get a registered command by name.
	 * Returns the first command found across all hooks, or undefined if none.
	 */
	getCommand(name: string): RegisteredCommand | undefined {
		for (const hook of this.hooks) {
			const command = hook.commands.get(name);
			if (command) {
				return command;
			}
		}
		return undefined;
	}

	/**
	 * Create the event context for handlers.
	 */
	private createContext(): HookEventContext {
		return {
			ui: this.uiContext,
			hasUI: this.hasUI,
			cwd: this.cwd,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelRegistry,
		};
	}

	/**
	 * Emit an event to all hooks.
	 * Returns the result from session/tool_result events (if any handler returns one).
	 */
	async emit(event: HookEvent): Promise<SessionEventResult | ToolResultEventResult | undefined> {
		const ctx = this.createContext();
		let result: SessionEventResult | ToolResultEventResult | undefined;

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					// No timeout for before_compact events (like tool_call, they may take a while)
					const isBeforeCompact = event.type === "session" && (event as SessionEvent).reason === "before_compact";
					let handlerResult: unknown;

					if (isBeforeCompact) {
						handlerResult = await handler(event, ctx);
					} else {
						const timeout = createTimeout(this.timeout);
						handlerResult = await Promise.race([handler(event, ctx), timeout.promise]);
						timeout.clear();
					}

					// For session events, capture the result (for before_* cancellation)
					if (event.type === "session" && handlerResult) {
						result = handlerResult as SessionEventResult;
						// If cancelled, stop processing further hooks
						if (result.cancel) {
							return result;
						}
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

	/**
	 * Emit a context event to all hooks.
	 * Handlers are chained - each gets the previous handler's output (if any).
	 * Returns the final modified messages, or the original if no modifications.
	 *
	 * Note: Messages are already deep-copied by the caller (pi-ai preprocessor).
	 */
	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		const ctx = this.createContext();
		let currentMessages = messages;

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get("context");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: ContextEvent = { type: "context", messages: currentMessages };
					const timeout = createTimeout(this.timeout);
					const handlerResult = await Promise.race([handler(event, ctx), timeout.promise]);
					timeout.clear();

					if (handlerResult && (handlerResult as ContextEventResult).messages) {
						currentMessages = (handlerResult as ContextEventResult).messages!;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this.emitError({
						hookPath: hook.path,
						event: "context",
						error: message,
					});
				}
			}
		}

		return currentMessages;
	}
}
