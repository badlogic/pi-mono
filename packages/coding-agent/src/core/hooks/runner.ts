/**
 * Hook runner - executes hooks and manages their lifecycle.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { theme } from "../../modes/interactive/theme/theme.js";
import type { ModelRegistry } from "../model-registry.js";
import type { SessionManager } from "../session-manager.js";
import type { AppendEntryHandler, LoadedHook, SendMessageHandler } from "./loader.js";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	HookContext,
	HookError,
	HookEvent,
	HookMessageRenderer,
	HookUIContext,
	RegisteredCommand,
	SessionBeforeCompactResult,
	SessionBeforeTreeResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEventResult,
} from "./types.js";

/**
 * Listener for hook errors.
 */
export type HookErrorListener = (error: HookError) => void;

// Re-export execCommand for backward compatibility
export { execCommand } from "../exec.js";

/** No-op UI context used when no UI is available */
const noOpUIContext: HookUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: () => {},
	setStatus: () => {},
	custom: async () => undefined as never,
	setEditorText: () => {},
	getEditorText: () => "",
	get theme() {
		return theme;
	},
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
	private errorListeners: Set<HookErrorListener> = new Set();
	private getModel: () => Model<any> | undefined = () => undefined;

	constructor(hooks: LoadedHook[], cwd: string, sessionManager: SessionManager, modelRegistry: ModelRegistry) {
		this.hooks = hooks;
		this.uiContext = noOpUIContext;
		this.hasUI = false;
		this.cwd = cwd;
		this.sessionManager = sessionManager;
		this.modelRegistry = modelRegistry;
	}

	/**
	 * Initialize HookRunner with all required context.
	 * Modes call this once the agent session is fully set up.
	 */
	initialize(options: {
		/** Function to get the current model */
		getModel: () => Model<any> | undefined;
		/** Handler for hooks to send messages */
		sendMessageHandler: SendMessageHandler;
		/** Handler for hooks to append entries */
		appendEntryHandler: AppendEntryHandler;
		/** UI context for interactive prompts */
		uiContext?: HookUIContext;
		/** Whether UI is available */
		hasUI?: boolean;
	}): void {
		this.getModel = options.getModel;
		for (const hook of this.hooks) {
			hook.setSendMessageHandler(options.sendMessageHandler);
			hook.setAppendEntryHandler(options.appendEntryHandler);
		}
		this.uiContext = options.uiContext ?? noOpUIContext;
		this.hasUI = options.hasUI ?? false;
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
	private createContext(): HookContext {
		return {
			ui: this.uiContext,
			hasUI: this.hasUI,
			cwd: this.cwd,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelRegistry,
			model: this.getModel(),
		};
	}

	/**
	 * Check if event type is a session "before_*" event that can be cancelled.
	 */
	private isSessionBeforeEvent(
		type: string,
	): type is
		| "session_before_switch"
		| "session_before_new"
		| "session_before_branch"
		| "session_before_compact"
		| "session_before_tree" {
		return (
			type === "session_before_switch" ||
			type === "session_before_new" ||
			type === "session_before_branch" ||
			type === "session_before_compact" ||
			type === "session_before_tree"
		);
	}

	/**
	 * Emit an event to all hooks.
	 * Returns the result from session before_* / tool_result events (if any handler returns one).
	 */
	async emit(
		event: HookEvent,
	): Promise<SessionBeforeCompactResult | SessionBeforeTreeResult | ToolResultEventResult | undefined> {
		const ctx = this.createContext();
		let result: SessionBeforeCompactResult | SessionBeforeTreeResult | ToolResultEventResult | undefined;

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const handlerResult = await handler(event, ctx);

					// For session before_* events, capture the result (for cancellation)
					if (this.isSessionBeforeEvent(event.type) && handlerResult) {
						result = handlerResult as SessionBeforeCompactResult | SessionBeforeTreeResult;
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
					const handlerResult = await handler(event, ctx);

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

	/**
	 * Emit before_agent_start event to all hooks.
	 * Returns the first message to inject (if any handler returns one).
	 */
	async emitBeforeAgentStart(
		prompt: string,
		images?: import("@mariozechner/pi-ai").ImageContent[],
	): Promise<BeforeAgentStartEventResult | undefined> {
		const ctx = this.createContext();
		let result: BeforeAgentStartEventResult | undefined;

		for (const hook of this.hooks) {
			const handlers = hook.handlers.get("before_agent_start");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: BeforeAgentStartEvent = { type: "before_agent_start", prompt, images };
					const handlerResult = await handler(event, ctx);

					// Take the first message returned
					if (handlerResult && (handlerResult as BeforeAgentStartEventResult).message && !result) {
						result = handlerResult as BeforeAgentStartEventResult;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this.emitError({
						hookPath: hook.path,
						event: "before_agent_start",
						error: message,
					});
				}
			}
		}

		return result;
	}
}
