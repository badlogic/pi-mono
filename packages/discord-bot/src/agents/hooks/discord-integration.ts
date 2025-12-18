/**
 * Discord Bot Hook Integration
 *
 * Integrates the hook system with Discord bot's agent lifecycle.
 * Provides factory functions to create hook-enabled agents.
 */

// Discord types available but not directly used in this integration layer
// import type { Message, TextChannel } from "discord.js";
import {
	AgentHookManager,
	checkpointHook,
	createDiscordContext,
	createHookRegistration,
	expertHook,
	lspHook,
} from "./index.js";
import type {
	AgentEndEvent,
	AgentHookContext,
	AgentStartEvent,
	SessionEvent,
	ToolCallEvent,
	ToolResultEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface DiscordHookConfig {
	/** Enable checkpoint hook (git state) */
	checkpoint?: boolean;
	/** Enable LSP hook (diagnostics) */
	lsp?: boolean;
	/** Enable expert hook (learning) */
	expert?: boolean;
	/** Working directory for hooks */
	cwd: string;
	/** Discord channel ID */
	channelId: string;
	/** Discord user ID */
	userId?: string;
}

export interface HookIntegration {
	manager: AgentHookManager;
	context: AgentHookContext;
	/** Emit session event */
	emitSession(reason: "start" | "switch" | "clear", sessionId: string): Promise<void>;
	/** Emit agent start event */
	emitAgentStart(turnIndex: number): Promise<void>;
	/** Emit agent end event */
	emitAgentEnd(turnIndex: number, success: boolean, output?: string): Promise<void>;
	/** Emit turn start event */
	emitTurnStart(turnIndex: number): Promise<void>;
	/** Emit turn end event */
	emitTurnEnd(turnIndex: number, message?: unknown): Promise<void>;
	/** Emit tool call event (returns block decision) */
	emitToolCall(
		toolName: string,
		toolCallId: string,
		input: Record<string, unknown>,
	): Promise<{ block: boolean; reason?: string }>;
	/** Emit tool result event (returns modified result) */
	emitToolResult(
		toolName: string,
		toolCallId: string,
		input: Record<string, unknown>,
		result: string,
		isError: boolean,
	): Promise<{ result: string; isError: boolean }>;
	/** Cleanup resources */
	dispose(): void;
}

// ============================================================================
// Per-Channel Hook Managers
// ============================================================================

const channelHookManagers = new Map<string, HookIntegration>();

/**
 * Create hook integration for a Discord channel
 */
export function createDiscordHookIntegration(config: DiscordHookConfig): HookIntegration {
	const { cwd, channelId, userId, checkpoint = true, lsp = true, expert = true } = config;

	// Check if already exists
	const existing = channelHookManagers.get(channelId);
	if (existing) {
		return existing;
	}

	// Create manager
	const manager = new AgentHookManager(cwd);

	// Register enabled hooks
	if (checkpoint) {
		manager.register(
			createHookRegistration("checkpoint", checkpointHook, {
				name: "Checkpoint",
				description: "Git-based state checkpointing",
			}),
		);
	}

	if (lsp) {
		manager.register(
			createHookRegistration("lsp", lspHook, {
				name: "LSP",
				description: "Language Server diagnostics",
			}),
		);
	}

	if (expert) {
		manager.register(
			createHookRegistration("expert", expertHook, {
				name: "Expert",
				description: "Act-Learn-Reuse integration",
			}),
		);
	}

	// Create context with Discord-specific UI callbacks
	const context = createDiscordContext(cwd, {
		channelId,
		userId,
		notifyCallback: (message, type) => {
			// Log to console - Discord notifications handled separately
			const prefix = { info: "[HOOK]", warning: "[HOOK WARN]", error: "[HOOK ERR]" }[type || "info"];
			console.log(`${prefix} [${channelId}] ${message}`);
		},
	});

	// Track current turn (used for branch event context)
	let _currentTurnIndex = 0;

	const integration: HookIntegration = {
		manager,
		context,

		async emitSession(reason, sessionId) {
			const event: SessionEvent = {
				type: "session",
				reason,
				sessionId,
			};
			await manager.emit(event, context);
		},

		async emitAgentStart(turnIndex) {
			_currentTurnIndex = turnIndex;
			const event: AgentStartEvent = {
				type: "agent_start",
				turnIndex,
				timestamp: Date.now(),
			};
			await manager.emit(event, context);
		},

		async emitAgentEnd(turnIndex, success, output) {
			const event: AgentEndEvent = {
				type: "agent_end",
				turnIndex,
				success,
				output,
			};
			await manager.emit(event, context);
		},

		async emitTurnStart(turnIndex) {
			_currentTurnIndex = turnIndex;
			const event: TurnStartEvent = {
				type: "turn_start",
				turnIndex,
				timestamp: Date.now(),
			};
			await manager.emit(event, context);
		},

		async emitTurnEnd(turnIndex, message) {
			const event: TurnEndEvent = {
				type: "turn_end",
				turnIndex,
				message,
			};
			await manager.emit(event, context);
		},

		async emitToolCall(toolName, toolCallId, input) {
			const event: ToolCallEvent = {
				type: "tool_call",
				toolName,
				toolCallId,
				input,
			};
			const result = await manager.emit(event, context);
			return {
				block: result?.block || false,
				reason: result?.reason,
			};
		},

		async emitToolResult(toolName, toolCallId, input, result, isError) {
			const event: ToolResultEvent = {
				type: "tool_result",
				toolName,
				toolCallId,
				input,
				result,
				isError,
			};
			const hookResult = await manager.emit(event, context);
			return {
				result: hookResult?.result ?? result,
				isError: hookResult?.isError ?? isError,
			};
		},

		dispose() {
			channelHookManagers.delete(channelId);
		},
	};

	channelHookManagers.set(channelId, integration);
	return integration;
}

/**
 * Get existing hook integration for a channel
 */
export function getChannelHookIntegration(channelId: string): HookIntegration | undefined {
	return channelHookManagers.get(channelId);
}

/**
 * Dispose hook integration for a channel
 */
export function disposeChannelHookIntegration(channelId: string): void {
	const integration = channelHookManagers.get(channelId);
	if (integration) {
		integration.dispose();
	}
}

/**
 * Dispose all hook integrations
 */
export function disposeAllHookIntegrations(): void {
	for (const [channelId] of channelHookManagers) {
		disposeChannelHookIntegration(channelId);
	}
}

// ============================================================================
// Agent Tool Wrapper
// ============================================================================

/**
 * Wrap a tool's execute function with hook events
 */
export function wrapToolWithHooks<T extends { name: string; execute: (...args: any[]) => Promise<any> }>(
	tool: T,
	getIntegration: () => HookIntegration | undefined,
): T {
	const originalExecute = tool.execute.bind(tool);

	const wrappedExecute = async (...args: any[]) => {
		const integration = getIntegration();
		if (!integration) {
			return originalExecute(...args);
		}

		const toolCallId = `${tool.name}-${Date.now()}`;
		const input = args[0] || {};

		// Emit tool_call (check if blocked)
		const callResult = await integration.emitToolCall(tool.name, toolCallId, input);
		if (callResult.block) {
			return {
				type: "tool_result",
				tool_use_id: toolCallId,
				content: `Tool blocked by hook: ${callResult.reason || "No reason provided"}`,
				is_error: true,
			};
		}

		// Execute tool
		let result: any;
		let isError = false;
		try {
			result = await originalExecute(...args);
		} catch (error) {
			isError = true;
			result = error instanceof Error ? error.message : String(error);
		}

		// Get result content
		const resultContent = typeof result === "string" ? result : result?.content || JSON.stringify(result);

		// Emit tool_result (may modify result)
		const hookResult = await integration.emitToolResult(tool.name, toolCallId, input, resultContent, isError);

		// Return modified result if hook changed it
		if (hookResult.result !== resultContent || hookResult.isError !== isError) {
			if (typeof result === "string") {
				return hookResult.result;
			}
			return {
				...result,
				content: hookResult.result,
				is_error: hookResult.isError,
			};
		}

		return result;
	};

	return {
		...tool,
		execute: wrappedExecute,
	} as T;
}

// ============================================================================
// Session ID Generation
// ============================================================================

/**
 * Generate a session ID for a channel
 */
export function generateSessionId(channelId: string): string {
	return `discord-${channelId}-${Date.now()}`;
}
