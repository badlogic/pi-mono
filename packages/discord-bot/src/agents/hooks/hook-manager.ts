/**
 * Hook Manager for Discord Bot Agent System
 *
 * Bridges the pi-coding-agent hook system with discord-bot's HookRegistry.
 * Manages registration, lifecycle, and event emission for all agent hooks.
 *
 * Usage:
 *   const manager = new AgentHookManager(cwd);
 *   manager.register(checkpointHook);
 *   manager.register(lspHook);
 *   manager.register(expertHook);
 *
 *   // Emit events during agent execution
 *   await manager.emit({ type: 'session', ... }, ctx);
 *   await manager.emit({ type: 'turn_start', ... }, ctx);
 */

import { exec } from "child_process";
import { promisify } from "util";
import type {
	AgentEndEvent,
	AgentHookAPI,
	AgentHookContext,
	AgentHookEvent,
	AgentHookFactory,
	AgentHookHandler,
	AgentStartEvent,
	BranchEvent,
	BranchEventResult,
	HookManager,
	HookRegistration,
	SessionEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	TurnEndEvent,
	TurnStartEvent,
} from "./types.js";

const execAsync = promisify(exec);

// ============================================================================
// Metrics Types
// ============================================================================

export interface HookMetrics {
	/** Total events emitted */
	totalEvents: number;
	/** Events by type */
	eventsByType: Record<string, number>;
	/** Hook execution times (ms) */
	executionTimes: {
		total: number;
		byHook: Record<string, number>;
		byEvent: Record<string, number>;
	};
	/** Error counts */
	errors: {
		total: number;
		byHook: Record<string, number>;
	};
	/** Session info */
	session: {
		startTime: number;
		sessionId?: string;
		turnCount: number;
	};
	/** Tool call stats */
	toolCalls: {
		total: number;
		blocked: number;
		modified: number;
	};
}

// ============================================================================
// Debug Logging
// ============================================================================

let debugLoggingEnabled = false;

export function enableDebugLogging(enabled: boolean): void {
	debugLoggingEnabled = enabled;
	if (enabled) {
		console.log("[HOOKS DEBUG] Debug logging enabled");
	}
}

export function isDebugLoggingEnabled(): boolean {
	return debugLoggingEnabled;
}

function debugLog(message: string, data?: unknown): void {
	if (!debugLoggingEnabled) return;
	const timestamp = new Date().toISOString();
	if (data) {
		console.log(`[HOOKS DEBUG ${timestamp}] ${message}`, JSON.stringify(data, null, 2));
	} else {
		console.log(`[HOOKS DEBUG ${timestamp}] ${message}`);
	}
}

// ============================================================================
// Hook Manager Implementation
// ============================================================================

type EventHandler = {
	session: AgentHookHandler<SessionEvent>[];
	agent_start: AgentHookHandler<AgentStartEvent>[];
	agent_end: AgentHookHandler<AgentEndEvent>[];
	turn_start: AgentHookHandler<TurnStartEvent>[];
	turn_end: AgentHookHandler<TurnEndEvent>[];
	tool_call: AgentHookHandler<ToolCallEvent, ToolCallEventResult | undefined>[];
	tool_result: AgentHookHandler<ToolResultEvent, ToolResultEventResult | undefined>[];
	branch: AgentHookHandler<BranchEvent, BranchEventResult | undefined>[];
};

/**
 * Agent Hook Manager
 * Coordinates all registered hooks and routes events
 */
export class AgentHookManager implements HookManager {
	private hooks: Map<string, HookRegistration> = new Map();
	private handlers: Map<string, EventHandler> = new Map();
	private cwd: string;
	private sendQueue: Array<{ text: string; attachments?: unknown[] }> = [];
	private onSend?: (text: string, attachments?: unknown[]) => void;
	private _metrics: HookMetrics;

	constructor(cwd: string, onSend?: (text: string, attachments?: unknown[]) => void) {
		this.cwd = cwd;
		this.onSend = onSend;
		this._metrics = this.createInitialMetrics();
	}

	/**
	 * Create initial metrics object
	 */
	private createInitialMetrics(): HookMetrics {
		return {
			totalEvents: 0,
			eventsByType: {},
			executionTimes: {
				total: 0,
				byHook: {},
				byEvent: {},
			},
			errors: {
				total: 0,
				byHook: {},
			},
			session: {
				startTime: Date.now(),
				turnCount: 0,
			},
			toolCalls: {
				total: 0,
				blocked: 0,
				modified: 0,
			},
		};
	}

	/**
	 * Get current metrics
	 */
	getMetrics(): HookMetrics {
		return { ...this._metrics };
	}

	/**
	 * Reset metrics (useful at session start)
	 */
	resetMetrics(sessionId?: string): void {
		this._metrics = this.createInitialMetrics();
		if (sessionId) {
			this._metrics.session.sessionId = sessionId;
		}
		debugLog("Metrics reset", { sessionId });
	}

	/**
	 * Register a hook
	 */
	register(hook: HookRegistration): void {
		if (this.hooks.has(hook.id)) {
			console.warn(`Hook ${hook.id} already registered, replacing`);
		}

		this.hooks.set(hook.id, hook);

		// Initialize handler storage for this hook
		const eventHandlers: EventHandler = {
			session: [],
			agent_start: [],
			agent_end: [],
			turn_start: [],
			turn_end: [],
			tool_call: [],
			tool_result: [],
			branch: [],
		};
		this.handlers.set(hook.id, eventHandlers);

		// Create API for this hook
		const api = this.createHookAPI(hook.id);

		// Initialize the hook
		try {
			hook.factory(api);
		} catch (error) {
			console.error(`Failed to initialize hook ${hook.id}:`, error);
		}
	}

	/**
	 * Unregister a hook
	 */
	unregister(id: string): boolean {
		if (!this.hooks.has(id)) return false;
		this.hooks.delete(id);
		this.handlers.delete(id);
		return true;
	}

	/**
	 * Enable/disable a hook
	 */
	setEnabled(id: string, enabled: boolean): boolean {
		const hook = this.hooks.get(id);
		if (!hook) return false;
		hook.enabled = enabled;
		return true;
	}

	/**
	 * List all registered hooks
	 */
	list(): HookRegistration[] {
		return Array.from(this.hooks.values());
	}

	/**
	 * Create HookAPI for a specific hook
	 */
	private createHookAPI(hookId: string): AgentHookAPI {
		const handlers = this.handlers.get(hookId)!;

		const api: AgentHookAPI = {
			on: ((event: string, handler: any) => {
				const eventType = event as keyof EventHandler;
				if (handlers[eventType]) {
					handlers[eventType].push(handler);
				}
			}) as AgentHookAPI["on"],

			send: (text: string, attachments?: unknown[]) => {
				if (this.onSend) {
					this.onSend(text, attachments);
				} else {
					this.sendQueue.push({ text, attachments });
				}
			},
		};

		return api;
	}

	/**
	 * Create context for hook execution
	 */
	private createContext(overrides: Partial<AgentHookContext> = {}): AgentHookContext {
		return {
			exec: async (command: string, args: string[]) => {
				const fullCommand = `${command} ${args.join(" ")}`;
				try {
					const { stdout, stderr } = await execAsync(fullCommand, { cwd: this.cwd });
					return { stdout, stderr, code: 0 };
				} catch (error: any) {
					return {
						stdout: error.stdout || "",
						stderr: error.stderr || error.message,
						code: error.code || 1,
					};
				}
			},
			ui: {
				select: async (title: string, options: string[]) => {
					// Default implementation - return first option
					console.log(`[Hook UI] Select: ${title}`);
					for (let i = 0; i < options.length; i++) {
						console.log(`  ${i + 1}. ${options[i]}`);
					}
					return options[0] || null;
				},
				confirm: async (title: string, message: string) => {
					console.log(`[Hook UI] Confirm: ${title} - ${message}`);
					return true;
				},
				input: async (title: string, placeholder?: string) => {
					console.log(`[Hook UI] Input: ${title} (placeholder: ${placeholder})`);
					return null;
				},
				notify: (message: string, type?: "info" | "warning" | "error") => {
					const prefix = { info: "[INFO]", warning: "[WARN]", error: "[ERROR]" }[type || "info"];
					console.log(`${prefix} ${message}`);
				},
			},
			hasUI: false,
			cwd: this.cwd,
			...overrides,
		};
	}

	/**
	 * Emit an event to all registered hooks
	 */
	async emit<E extends AgentHookEvent>(
		event: E,
		ctx?: Partial<AgentHookContext>,
	): Promise<
		E extends ToolCallEvent
			? ToolCallEventResult | undefined
			: E extends ToolResultEvent
				? ToolResultEventResult | undefined
				: E extends BranchEvent
					? BranchEventResult | undefined
					: void
	> {
		const eventStart = Date.now();
		const context = this.createContext(ctx);
		const eventType = event.type as keyof EventHandler;

		// Update metrics
		this._metrics.totalEvents++;
		this._metrics.eventsByType[eventType] = (this._metrics.eventsByType[eventType] || 0) + 1;

		// Track special events
		if (eventType === "session") {
			const sessionEvent = event as SessionEvent;
			if (sessionEvent.reason === "start") {
				this._metrics.session.sessionId = sessionEvent.sessionId;
				this._metrics.session.startTime = Date.now();
			}
		} else if (eventType === "turn_start") {
			this._metrics.session.turnCount++;
		} else if (eventType === "tool_call") {
			this._metrics.toolCalls.total++;
		}

		debugLog(`Emitting ${eventType} event`, { event, hookCount: this.hooks.size });

		let result: any;
		const originalResult = eventType === "tool_result" ? (event as ToolResultEvent).result : undefined;

		for (const [hookId, hook] of this.hooks.entries()) {
			if (!hook.enabled) continue;

			const handlers = this.handlers.get(hookId);
			if (!handlers) continue;

			const eventHandlers = handlers[eventType];
			if (!eventHandlers || eventHandlers.length === 0) continue;

			const hookStart = Date.now();
			for (const handler of eventHandlers) {
				try {
					debugLog(`Running ${hookId} handler for ${eventType}`);
					const handlerResult = await handler(event as any, context);

					// Merge results for tool_call, tool_result, and branch events
					if (handlerResult !== undefined) {
						if (eventType === "tool_call") {
							const tcResult = handlerResult as ToolCallEventResult;
							if (tcResult.block) {
								this._metrics.toolCalls.blocked++;
								debugLog(`Tool blocked by ${hookId}`, { reason: tcResult.reason });
								return tcResult as any; // Block immediately
							}
						} else if (eventType === "tool_result") {
							const trResult = handlerResult as ToolResultEventResult;
							if (trResult.result !== undefined) {
								// Update the event's result for subsequent handlers
								(event as ToolResultEvent).result = trResult.result;
								result = trResult;
							}
						} else if (eventType === "branch") {
							result = handlerResult;
						}
					}
				} catch (error) {
					console.error(`Hook ${hookId} error on ${eventType}:`, error);
					this._metrics.errors.total++;
					this._metrics.errors.byHook[hookId] = (this._metrics.errors.byHook[hookId] || 0) + 1;
					debugLog(`Hook ${hookId} error`, { error: String(error) });
				}
			}
			const hookDuration = Date.now() - hookStart;
			this._metrics.executionTimes.byHook[hookId] =
				(this._metrics.executionTimes.byHook[hookId] || 0) + hookDuration;
		}

		// Track if tool result was modified
		if (eventType === "tool_result" && result && originalResult !== (event as ToolResultEvent).result) {
			this._metrics.toolCalls.modified++;
			debugLog("Tool result modified by hooks");
		}

		const totalDuration = Date.now() - eventStart;
		this._metrics.executionTimes.total += totalDuration;
		this._metrics.executionTimes.byEvent[eventType] =
			(this._metrics.executionTimes.byEvent[eventType] || 0) + totalDuration;

		debugLog(`Event ${eventType} completed in ${totalDuration}ms`);

		return result;
	}

	/**
	 * Get queued messages (for hooks without onSend callback)
	 */
	getQueuedMessages(): Array<{ text: string; attachments?: unknown[] }> {
		const messages = [...this.sendQueue];
		this.sendQueue = [];
		return messages;
	}

	/**
	 * Set send callback (can be set after construction)
	 */
	setSendCallback(onSend: (text: string, attachments?: unknown[]) => void): void {
		this.onSend = onSend;
		// Process queued messages
		for (const msg of this.sendQueue) {
			onSend(msg.text, msg.attachments);
		}
		this.sendQueue = [];
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a hook registration from a factory function
 */
export function createHookRegistration(
	id: string,
	factory: AgentHookFactory,
	options: {
		name?: string;
		description?: string;
		enabled?: boolean;
	} = {},
): HookRegistration {
	return {
		id,
		name: options.name || id,
		description: options.description,
		factory,
		enabled: options.enabled !== false,
	};
}

/**
 * Create a pre-configured hook manager with common hooks
 */
export function createDefaultHookManager(
	cwd: string,
	options: {
		checkpoint?: boolean;
		lsp?: boolean;
		expert?: boolean;
		onSend?: (text: string, attachments?: unknown[]) => void;
	} = {},
): AgentHookManager {
	const manager = new AgentHookManager(cwd, options.onSend);

	// Import and register hooks dynamically to avoid circular deps
	if (options.checkpoint !== false) {
		import("./checkpoint-hook.js").then(({ checkpointHook }) => {
			manager.register(
				createHookRegistration("checkpoint", checkpointHook, {
					name: "Checkpoint Hook",
					description: "Git-based state checkpointing for conversation branching",
				}),
			);
		});
	}

	if (options.lsp !== false) {
		import("./lsp-hook.js").then(({ lspHook }) => {
			manager.register(
				createHookRegistration("lsp", lspHook, {
					name: "LSP Hook",
					description: "Language Server Protocol diagnostics integration",
				}),
			);
		});
	}

	if (options.expert !== false) {
		import("./expert-hook.js").then(({ expertHook }) => {
			manager.register(
				createHookRegistration("expert", expertHook, {
					name: "Expert Hook",
					description: "Act-Learn-Reuse expertise integration",
				}),
			);
		});
	}

	return manager;
}

// ============================================================================
// Discord-specific Context
// ============================================================================

/**
 * Create Discord-aware hook context
 */
export function createDiscordContext(
	cwd: string,
	options: {
		channelId?: string;
		userId?: string;
		selectCallback?: (title: string, options: string[]) => Promise<string | null>;
		confirmCallback?: (title: string, message: string) => Promise<boolean>;
		inputCallback?: (title: string, placeholder?: string) => Promise<string | null>;
		notifyCallback?: (message: string, type?: "info" | "warning" | "error") => void;
	} = {},
): AgentHookContext {
	return {
		exec: async (command: string, args: string[]) => {
			const fullCommand = `${command} ${args.join(" ")}`;
			try {
				const { stdout, stderr } = await execAsync(fullCommand, { cwd });
				return { stdout, stderr, code: 0 };
			} catch (error: any) {
				return {
					stdout: error.stdout || "",
					stderr: error.stderr || error.message,
					code: error.code || 1,
				};
			}
		},
		ui: {
			select: options.selectCallback || (async () => null),
			confirm: options.confirmCallback || (async () => true),
			input: options.inputCallback || (async () => null),
			notify:
				options.notifyCallback ||
				((message, type) => {
					console.log(`[${type?.toUpperCase() || "INFO"}] ${message}`);
				}),
		},
		hasUI: !!(options.selectCallback || options.confirmCallback),
		cwd,
		channelId: options.channelId,
		userId: options.userId,
	};
}
