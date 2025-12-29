/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import type { Agent, AgentEvent, AgentMessage, AgentState, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, TextContent } from "@mariozechner/pi-ai";
import { isContextOverflow, modelsAreEqual, supportsXhigh } from "@mariozechner/pi-ai";
import { getAuthPath } from "../config.js";
import { type BashResult, executeBash as executeBashCommand } from "./bash-executor.js";
import {
	type CompactionResult,
	calculateContextTokens,
	collectEntriesForBranchSummary,
	compact,
	generateBranchSummary,
	prepareCompaction,
	shouldCompact,
} from "./compaction/index.js";
import type { LoadedCustomTool, SessionEvent as ToolSessionEvent } from "./custom-tools/index.js";
import { exportSessionToHtml } from "./export-html.js";
import type {
	HookCommandContext,
	HookRunner,
	SessionBeforeBranchResult,
	SessionBeforeCompactResult,
	SessionBeforeNewResult,
	SessionBeforeSwitchResult,
	SessionBeforeTreeResult,
	TreePreparation,
	TurnEndEvent,
	TurnStartEvent,
} from "./hooks/index.js";
import type { BashExecutionMessage, HookMessage } from "./messages.js";
import type { ModelRegistry } from "./model-registry.js";
import type { BranchSummaryEntry, CompactionEntry, SessionManager } from "./session-manager.js";
import type { SettingsManager, SkillsSettings } from "./settings-manager.js";
import { expandSlashCommand, type FileSlashCommand } from "./slash-commands.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| AgentEvent
	| { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
	| { type: "auto_compaction_end"; result: CompactionResult | undefined; aborted: boolean; willRetry: boolean }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	/** Models to cycle through with Ctrl+P (from --models flag) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
	/** File-based slash commands for expansion */
	fileCommands?: FileSlashCommand[];
	/** Hook runner (created in main.ts with wrapped tools) */
	hookRunner?: HookRunner;
	/** Custom tools for session lifecycle events */
	customTools?: LoadedCustomTool[];
	skillsSettings?: Required<SkillsSettings>;
	/** Model registry for API key resolution and model discovery */
	modelRegistry: ModelRegistry;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Whether to expand file-based slash commands (default: true) */
	expandSlashCommands?: boolean;
	/** Image attachments */
	images?: ImageContent[];
}

/** Result from cycleModel() */
export interface ModelCycleResult {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	/** Whether cycling through scoped models (--models flag) or all available */
	isScoped: boolean;
}

/** Session statistics for /session command */
export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
}

/** Internal marker for hook messages queued through the agent loop */
// ============================================================================
// Constants
// ============================================================================

/** Standard thinking levels */
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

/** Thinking levels including xhigh (for supported models) */
const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	private _scopedModels: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
	private _fileCommands: FileSlashCommand[];

	// Event subscription state
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];

	// Message queue state
	private _queuedMessages: string[] = [];

	// Compaction state
	private _compactionAbortController: AbortController | undefined = undefined;
	private _autoCompactionAbortController: AbortController | undefined = undefined;

	// Branch summarization state
	private _branchSummaryAbortController: AbortController | undefined = undefined;

	// Retry state
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;
	private _retryPromise: Promise<void> | undefined = undefined;
	private _retryResolve: (() => void) | undefined = undefined;

	// Bash execution state
	private _bashAbortController: AbortController | undefined = undefined;
	private _pendingBashMessages: BashExecutionMessage[] = [];

	// Hook system
	private _hookRunner: HookRunner | undefined = undefined;
	private _turnIndex = 0;

	// Custom tools for session lifecycle
	private _customTools: LoadedCustomTool[] = [];

	private _skillsSettings: Required<SkillsSettings> | undefined;

	// Model registry for API key resolution
	private _modelRegistry: ModelRegistry;

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._scopedModels = config.scopedModels ?? [];
		this._fileCommands = config.fileCommands ?? [];
		this._hookRunner = config.hookRunner;
		this._customTools = config.customTools ?? [];
		this._skillsSettings = config.skillsSettings;
		this._modelRegistry = config.modelRegistry;

		// Always subscribe to agent events for internal handling
		// (session persistence, hooks, auto-compaction, retry logic)
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
	}

	/** Model registry for API key resolution and model discovery */
	get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: AgentSessionEvent): void {
		for (const l of this._eventListeners) {
			l(event);
		}
	}

	// Track last assistant message for auto-compaction check
	private _lastAssistantMessage: AssistantMessage | undefined = undefined;

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
		// When a user message starts, check if it's from the queue and remove it BEFORE emitting
		// This ensures the UI sees the updated queue state
		if (event.type === "message_start" && event.message.role === "user" && this._queuedMessages.length > 0) {
			// Extract text content from the message
			const messageText = this._getUserMessageText(event.message);
			if (messageText && this._queuedMessages.includes(messageText)) {
				// Remove the first occurrence of this message from the queue
				const index = this._queuedMessages.indexOf(messageText);
				if (index !== -1) {
					this._queuedMessages.splice(index, 1);
				}
			}
		}

		// Emit to hooks first
		await this._emitHookEvent(event);

		// Notify all listeners
		this._emit(event);

		// Handle session persistence
		if (event.type === "message_end") {
			// Check if this is a hook message
			if (event.message.role === "hookMessage") {
				// Persist as CustomMessageEntry
				this.sessionManager.appendCustomMessageEntry(
					event.message.customType,
					event.message.content,
					event.message.display,
					event.message.details,
				);
			} else if (
				event.message.role === "user" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult"
			) {
				// Regular LLM message - persist as SessionMessageEntry
				this.sessionManager.appendMessage(event.message);
			}
			// Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere

			// Track assistant message for auto-compaction (checked on agent_end)
			if (event.message.role === "assistant") {
				this._lastAssistantMessage = event.message;
			}
		}

		// Check auto-retry and auto-compaction after agent completes
		if (event.type === "agent_end" && this._lastAssistantMessage) {
			const msg = this._lastAssistantMessage;
			this._lastAssistantMessage = undefined;

			// Check for retryable errors first (overloaded, rate limit, server errors)
			if (this._isRetryableError(msg)) {
				const didRetry = await this._handleRetryableError(msg);
				if (didRetry) return; // Retry was initiated, don't proceed to compaction
			} else if (this._retryAttempt > 0) {
				// Previous retry succeeded - emit success event and reset counter
				this._emit({
					type: "auto_retry_end",
					success: true,
					attempt: this._retryAttempt,
				});
				this._retryAttempt = 0;
				// Resolve the retry promise so waitForRetry() completes
				this._resolveRetry();
			}

			await this._checkCompaction(msg);
		}
	};

	/** Resolve the pending retry promise */
	private _resolveRetry(): void {
		if (this._retryResolve) {
			this._retryResolve();
			this._retryResolve = undefined;
			this._retryPromise = undefined;
		}
	}

	/** Extract text content from a message */
	private _getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const content = message.content;
		if (typeof content === "string") return content;
		const textBlocks = content.filter((c) => c.type === "text");
		return textBlocks.map((c) => (c as TextContent).text).join("");
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	private _findLastAssistantMessage(): AssistantMessage | undefined {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as AssistantMessage;
			}
		}
		return undefined;
	}

	/** Emit hook events based on agent events */
	private async _emitHookEvent(event: AgentEvent): Promise<void> {
		if (!this._hookRunner) return;

		if (event.type === "agent_start") {
			this._turnIndex = 0;
			await this._hookRunner.emit({ type: "agent_start" });
		} else if (event.type === "agent_end") {
			await this._hookRunner.emit({ type: "agent_end", messages: event.messages });
		} else if (event.type === "turn_start") {
			const hookEvent: TurnStartEvent = {
				type: "turn_start",
				turnIndex: this._turnIndex,
				timestamp: Date.now(),
			};
			await this._hookRunner.emit(hookEvent);
		} else if (event.type === "turn_end") {
			const hookEvent: TurnEndEvent = {
				type: "turn_end",
				turnIndex: this._turnIndex,
				message: event.message,
				toolResults: event.toolResults,
			};
			await this._hookRunner.emit(hookEvent);
			this._turnIndex++;
		}
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this._eventListeners.push(listener);

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this._eventListeners.indexOf(listener);
			if (index !== -1) {
				this._eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Temporarily disconnect from agent events.
	 * User listeners are preserved and will receive events again after resubscribe().
	 * Used internally during operations that need to pause event processing.
	 */
	private _disconnectFromAgent(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
	}

	/**
	 * Reconnect to agent events after _disconnectFromAgent().
	 * Preserves all existing listeners.
	 */
	private _reconnectToAgent(): void {
		if (this._unsubscribeAgent) return; // Already connected
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	dispose(): void {
		this._disconnectFromAgent();
		this._eventListeners = [];
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model<any> | undefined {
		return this.agent.state.model;
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** Whether auto-compaction is currently running */
	get isCompacting(): boolean {
		return this._autoCompactionAbortController !== undefined || this._compactionAbortController !== undefined;
	}

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	/** Current queue mode */
	get queueMode(): "all" | "one-at-a-time" {
		return this.agent.getQueueMode();
	}

	/** Current session file path, or undefined if sessions are disabled */
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	/** Scoped models for cycling (from --models flag) */
	get scopedModels(): ReadonlyArray<{ model: Model<any>; thinkingLevel: ThinkingLevel }> {
		return this._scopedModels;
	}

	/** File-based slash commands */
	get fileCommands(): ReadonlyArray<FileSlashCommand> {
		return this._fileCommands;
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	/**
	 * Send a prompt to the agent.
	 * - Validates model and API key before sending
	 * - Handles hook commands (registered via pi.registerCommand)
	 * - Expands file-based slash commands by default
	 * @throws Error if no model selected or no API key available
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		// Flush any pending bash messages before the new prompt
		this._flushPendingBashMessages();

		const expandCommands = options?.expandSlashCommands ?? true;

		// Handle hook commands first (if enabled and text is a slash command)
		if (expandCommands && text.startsWith("/")) {
			const handled = await this._tryExecuteHookCommand(text);
			if (handled) {
				// Hook command executed, no prompt to send
				return;
			}
		}

		// Validate model
		if (!this.model) {
			throw new Error(
				"No model selected.\n\n" +
					`Use /login, set an API key environment variable, or create ${getAuthPath()}\n\n` +
					"Then use /model to select a model.",
			);
		}

		// Validate API key
		const apiKey = await this._modelRegistry.getApiKey(this.model);
		if (!apiKey) {
			throw new Error(
				`No API key found for ${this.model.provider}.\n\n` +
					`Use /login, set an API key environment variable, or create ${getAuthPath()}`,
			);
		}

		// Check if we need to compact before sending (catches aborted responses)
		const lastAssistant = this._findLastAssistantMessage();
		if (lastAssistant) {
			await this._checkCompaction(lastAssistant, false);
		}

		// Expand file-based slash commands if requested
		const expandedText = expandCommands ? expandSlashCommand(text, [...this._fileCommands]) : text;

		// Build messages array (hook message if any, then user message)
		const messages: AgentMessage[] = [];

		// Add user message
		const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: expandedText }];
		if (options?.images) {
			userContent.push(...options.images);
		}
		messages.push({
			role: "user",
			content: userContent,
			timestamp: Date.now(),
		});

		// Emit before_agent_start hook event
		if (this._hookRunner) {
			const result = await this._hookRunner.emitBeforeAgentStart(expandedText, options?.images);
			if (result?.message) {
				messages.push({
					role: "hookMessage",
					customType: result.message.customType,
					content: result.message.content,
					display: result.message.display,
					details: result.message.details,
					timestamp: Date.now(),
				});
			}
		}

		await this.agent.prompt(messages);
		await this.waitForRetry();
	}

	/**
	 * Try to execute a hook command. Returns true if command was found and executed.
	 */
	private async _tryExecuteHookCommand(text: string): Promise<boolean> {
		if (!this._hookRunner) return false;

		// Parse command name and args
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

		const command = this._hookRunner.getCommand(commandName);
		if (!command) return false;

		// Get UI context from hook runner (set by mode)
		const uiContext = this._hookRunner.getUIContext();
		if (!uiContext) return false;

		// Build command context
		const cwd = process.cwd();
		const ctx: HookCommandContext = {
			args,
			ui: uiContext,
			hasUI: this._hookRunner.getHasUI(),
			cwd,
			sessionManager: this.sessionManager,
			modelRegistry: this._modelRegistry,
		};

		try {
			await command.handler(ctx);
			return true;
		} catch (err) {
			// Emit error via hook runner
			this._hookRunner.emitError({
				hookPath: `command:${commandName}`,
				event: "command",
				error: err instanceof Error ? err.message : String(err),
			});
			return true;
		}
	}

	/**
	 * Queue a message to be sent after the current response completes.
	 * Use when agent is currently streaming.
	 */
	async queueMessage(text: string): Promise<void> {
		this._queuedMessages.push(text);
		await this.agent.queueMessage({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});
	}

	/**
	 * Send a hook message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queues message, processed when loop pulls from queue
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 *
	 * @param message Hook message with customType, content, display, details
	 * @param triggerTurn If true and not streaming, triggers a new LLM turn
	 */
	async sendHookMessage<T = unknown>(
		message: Pick<HookMessage<T>, "customType" | "content" | "display" | "details">,
		triggerTurn?: boolean,
	): Promise<void> {
		const appMessage = {
			role: "hookMessage" as const,
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		} satisfies HookMessage<T>;
		if (this.isStreaming) {
			// Queue for processing by agent loop
			await this.agent.queueMessage(appMessage);
		} else if (triggerTurn) {
			// Send as prompt - agent loop will emit message events
			await this.agent.prompt(appMessage);
		} else {
			// Just append to agent state and session, no turn
			this.agent.appendMessage(appMessage);
			this.sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
		}
	}

	/**
	 * Clear queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 */
	clearQueue(): string[] {
		const queued = [...this._queuedMessages];
		this._queuedMessages = [];
		this.agent.clearMessageQueue();
		return queued;
	}

	/** Number of messages currently queued */
	get queuedMessageCount(): number {
		return this._queuedMessages.length;
	}

	/** Get queued messages (read-only) */
	getQueuedMessages(): readonly string[] {
		return this._queuedMessages;
	}

	get skillsSettings(): Required<SkillsSettings> | undefined {
		return this._skillsSettings;
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.abortRetry();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	/**
	 * Reset agent and session to start fresh.
	 * Clears all messages and starts a new session.
	 * Listeners are preserved and will continue receiving events.
	 * @returns true if reset completed, false if cancelled by hook
	 */
	async reset(): Promise<boolean> {
		const previousSessionFile = this.sessionFile;

		// Emit session_before_new event (can be cancelled)
		if (this._hookRunner?.hasHandlers("session_before_new")) {
			const result = (await this._hookRunner.emit({
				type: "session_before_new",
			})) as SessionBeforeNewResult | undefined;

			if (result?.cancel) {
				return false;
			}
		}

		this._disconnectFromAgent();
		await this.abort();
		this.agent.reset();
		this.sessionManager.newSession();
		this._queuedMessages = [];
		this._reconnectToAgent();

		// Emit session_new event to hooks
		if (this._hookRunner) {
			await this._hookRunner.emit({
				type: "session_new",
			});
		}

		// Emit session event to custom tools
		await this._emitToolSessionEvent("new", previousSessionFile);
		return true;
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	/**
	 * Set model directly.
	 * Validates API key, saves to session and settings.
	 * @throws Error if no API key available for the model
	 */
	async setModel(model: Model<any>): Promise<void> {
		const apiKey = await this._modelRegistry.getApiKey(model);
		if (!apiKey) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		this.agent.setModel(model);
		this.sessionManager.appendModelChange(model.provider, model.id);
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(this.thinkingLevel);
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this._scopedModels.length > 0) {
			return this._cycleScopedModel(direction);
		}
		return this._cycleAvailableModel(direction);
	}

	private async _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		if (this._scopedModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = this._scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = this._scopedModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const next = this._scopedModels[nextIndex];

		// Validate API key
		const apiKey = await this._modelRegistry.getApiKey(next.model);
		if (!apiKey) {
			throw new Error(`No API key for ${next.model.provider}/${next.model.id}`);
		}

		// Apply model
		this.agent.setModel(next.model);
		this.sessionManager.appendModelChange(next.model.provider, next.model.id);
		this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);

		// Apply thinking level (setThinkingLevel clamps to model capabilities)
		this.setThinkingLevel(next.thinkingLevel);

		return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
	}

	private async _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const availableModels = await this._modelRegistry.getAvailable();
		if (availableModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = availableModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const nextModel = availableModels[nextIndex];

		const apiKey = await this._modelRegistry.getApiKey(nextModel);
		if (!apiKey) {
			throw new Error(`No API key for ${nextModel.provider}/${nextModel.id}`);
		}

		this.agent.setModel(nextModel);
		this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
		this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(this.thinkingLevel);

		return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	/**
	 * Get all available models with valid API keys.
	 */
	async getAvailableModels(): Promise<Model<any>[]> {
		return this._modelRegistry.getAvailable();
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	/**
	 * Set thinking level.
	 * Clamps to model capabilities: "off" if no reasoning, "high" if xhigh unsupported.
	 * Saves to session and settings.
	 */
	setThinkingLevel(level: ThinkingLevel): void {
		let effectiveLevel = level;
		if (!this.supportsThinking()) {
			effectiveLevel = "off";
		} else if (level === "xhigh" && !this.supportsXhighThinking()) {
			effectiveLevel = "high";
		}
		this.agent.setThinkingLevel(effectiveLevel);
		this.sessionManager.appendThinkingLevelChange(effectiveLevel);
		this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | undefined {
		if (!this.supportsThinking()) return undefined;

		const levels = this.getAvailableThinkingLevels();
		const currentIndex = levels.indexOf(this.thinkingLevel);
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];

		this.setThinkingLevel(nextLevel);
		return nextLevel;
	}

	/**
	 * Get available thinking levels for current model.
	 */
	getAvailableThinkingLevels(): ThinkingLevel[] {
		return this.supportsXhighThinking() ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
	}

	/**
	 * Check if current model supports xhigh thinking level.
	 */
	supportsXhighThinking(): boolean {
		return this.model ? supportsXhigh(this.model) : false;
	}

	/**
	 * Check if current model supports thinking/reasoning.
	 */
	supportsThinking(): boolean {
		return !!this.model?.reasoning;
	}

	// =========================================================================
	// Queue Mode Management
	// =========================================================================

	/**
	 * Set message queue mode.
	 * Saves to settings.
	 */
	setQueueMode(mode: "all" | "one-at-a-time"): void {
		this.agent.setQueueMode(mode);
		this.settingsManager.setQueueMode(mode);
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	/**
	 * Manually compact the session context.
	 * Aborts current agent operation first.
	 * @param customInstructions Optional instructions for the compaction summary
	 */
	async compact(customInstructions?: string): Promise<CompactionResult> {
		this._disconnectFromAgent();
		await this.abort();
		this._compactionAbortController = new AbortController();

		try {
			if (!this.model) {
				throw new Error("No model selected");
			}

			const apiKey = await this._modelRegistry.getApiKey(this.model);
			if (!apiKey) {
				throw new Error(`No API key for ${this.model.provider}`);
			}

			const entries = this.sessionManager.getEntries();
			const settings = this.settingsManager.getCompactionSettings();

			const preparation = prepareCompaction(entries, settings);
			if (!preparation) {
				// Check why we can't compact
				const lastEntry = entries[entries.length - 1];
				if (lastEntry?.type === "compaction") {
					throw new Error("Already compacted");
				}
				throw new Error("Nothing to compact (session too small)");
			}

			let hookCompaction: CompactionResult | undefined;
			let fromHook = false;

			if (this._hookRunner?.hasHandlers("session_before_compact")) {
				// Get previous compactions, newest first
				const previousCompactions = entries.filter((e): e is CompactionEntry => e.type === "compaction").reverse();

				const result = (await this._hookRunner.emit({
					type: "session_before_compact",
					preparation,
					previousCompactions,
					customInstructions,
					model: this.model,
					signal: this._compactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (result?.cancel) {
					throw new Error("Compaction cancelled");
				}

				if (result?.compaction) {
					hookCompaction = result.compaction;
					fromHook = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (hookCompaction) {
				// Hook provided compaction content
				summary = hookCompaction.summary;
				firstKeptEntryId = hookCompaction.firstKeptEntryId;
				tokensBefore = hookCompaction.tokensBefore;
				details = hookCompaction.details;
			} else {
				// Generate compaction result
				const result = await compact(
					entries,
					this.model,
					settings,
					apiKey,
					this._compactionAbortController.signal,
					customInstructions,
				);
				summary = result.summary;
				firstKeptEntryId = result.firstKeptEntryId;
				tokensBefore = result.tokensBefore;
				details = result.details;
			}

			if (this._compactionAbortController.signal.aborted) {
				throw new Error("Compaction cancelled");
			}

			this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.replaceMessages(sessionContext.messages);

			// Get the saved compaction entry for the hook
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._hookRunner && savedCompactionEntry) {
				await this._hookRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromHook,
				});
			}

			return {
				summary,
				firstKeptEntryId,
				tokensBefore,
				details,
			};
		} finally {
			this._compactionAbortController = undefined;
			this._reconnectToAgent();
		}
	}

	/**
	 * Cancel in-progress compaction (manual or auto).
	 */
	abortCompaction(): void {
		this._compactionAbortController?.abort();
		this._autoCompactionAbortController?.abort();
	}

	/**
	 * Cancel in-progress branch summarization.
	 */
	abortBranchSummary(): void {
		this._branchSummaryAbortController?.abort();
	}

	/**
	 * Check if compaction is needed and run it.
	 * Called after agent_end and before prompt submission.
	 *
	 * Two cases:
	 * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
	 * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 */
	private async _checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<void> {
		const settings = this.settingsManager.getCompactionSettings();
		if (!settings.enabled) return;

		// Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
		if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return;

		const contextWindow = this.model?.contextWindow ?? 0;

		// Case 1: Overflow - LLM returned context overflow error
		if (isContextOverflow(assistantMessage, contextWindow)) {
			// Remove the error message from agent state (it IS saved to session for history,
			// but we don't want it in context for the retry)
			const messages = this.agent.state.messages;
			if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
				this.agent.replaceMessages(messages.slice(0, -1));
			}
			await this._runAutoCompaction("overflow", true);
			return;
		}

		// Case 2: Threshold - turn succeeded but context is getting large
		// Skip if this was an error (non-overflow errors don't have usage data)
		if (assistantMessage.stopReason === "error") return;

		const contextTokens = calculateContextTokens(assistantMessage.usage);
		if (shouldCompact(contextTokens, contextWindow, settings)) {
			await this._runAutoCompaction("threshold", false);
		}
	}

	/**
	 * Internal: Run auto-compaction with events.
	 */
	private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<void> {
		const settings = this.settingsManager.getCompactionSettings();

		this._emit({ type: "auto_compaction_start", reason });
		this._autoCompactionAbortController = new AbortController();

		try {
			if (!this.model) {
				this._emit({ type: "auto_compaction_end", result: undefined, aborted: false, willRetry: false });
				return;
			}

			const apiKey = await this._modelRegistry.getApiKey(this.model);
			if (!apiKey) {
				this._emit({ type: "auto_compaction_end", result: undefined, aborted: false, willRetry: false });
				return;
			}

			const entries = this.sessionManager.getEntries();

			const preparation = prepareCompaction(entries, settings);
			if (!preparation) {
				this._emit({ type: "auto_compaction_end", result: undefined, aborted: false, willRetry: false });
				return;
			}

			let hookCompaction: CompactionResult | undefined;
			let fromHook = false;

			if (this._hookRunner?.hasHandlers("session_before_compact")) {
				// Get previous compactions, newest first
				const previousCompactions = entries.filter((e): e is CompactionEntry => e.type === "compaction").reverse();

				const hookResult = (await this._hookRunner.emit({
					type: "session_before_compact",
					preparation,
					previousCompactions,
					customInstructions: undefined,
					model: this.model,
					signal: this._autoCompactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (hookResult?.cancel) {
					this._emit({ type: "auto_compaction_end", result: undefined, aborted: true, willRetry: false });
					return;
				}

				if (hookResult?.compaction) {
					hookCompaction = hookResult.compaction;
					fromHook = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (hookCompaction) {
				// Hook provided compaction content
				summary = hookCompaction.summary;
				firstKeptEntryId = hookCompaction.firstKeptEntryId;
				tokensBefore = hookCompaction.tokensBefore;
				details = hookCompaction.details;
			} else {
				// Generate compaction result
				const compactResult = await compact(
					entries,
					this.model,
					settings,
					apiKey,
					this._autoCompactionAbortController.signal,
				);
				summary = compactResult.summary;
				firstKeptEntryId = compactResult.firstKeptEntryId;
				tokensBefore = compactResult.tokensBefore;
				details = compactResult.details;
			}

			if (this._autoCompactionAbortController.signal.aborted) {
				this._emit({ type: "auto_compaction_end", result: undefined, aborted: true, willRetry: false });
				return;
			}

			this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.replaceMessages(sessionContext.messages);

			// Get the saved compaction entry for the hook
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._hookRunner && savedCompactionEntry) {
				await this._hookRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromHook,
				});
			}

			const result: CompactionResult = {
				summary,
				firstKeptEntryId,
				tokensBefore,
				details,
			};
			this._emit({ type: "auto_compaction_end", result, aborted: false, willRetry });

			if (willRetry) {
				const messages = this.agent.state.messages;
				const lastMsg = messages[messages.length - 1];
				if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
					this.agent.replaceMessages(messages.slice(0, -1));
				}

				setTimeout(() => {
					this.agent.continue().catch(() => {});
				}, 100);
			}
		} catch (error) {
			this._emit({ type: "auto_compaction_end", result: undefined, aborted: false, willRetry: false });

			if (reason === "overflow") {
				throw new Error(
					`Context overflow: ${error instanceof Error ? error.message : "compaction failed"}. Your input may be too large for the context window.`,
				);
			}
		} finally {
			this._autoCompactionAbortController = undefined;
		}
	}

	/**
	 * Toggle auto-compaction setting.
	 */
	setAutoCompactionEnabled(enabled: boolean): void {
		this.settingsManager.setCompactionEnabled(enabled);
	}

	/** Whether auto-compaction is enabled */
	get autoCompactionEnabled(): boolean {
		return this.settingsManager.getCompactionEnabled();
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 */
	private _isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;

		// Context overflow is handled by compaction, not retry
		const contextWindow = this.model?.contextWindow ?? 0;
		if (isContextOverflow(message, contextWindow)) return false;

		const err = message.errorMessage;
		// Match: overloaded_error, rate limit, 429, 500, 502, 503, 504, service unavailable, connection error
		return /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error|connection.?error/i.test(
			err,
		);
	}

	/**
	 * Handle retryable errors with exponential backoff.
	 * @returns true if retry was initiated, false if max retries exceeded or disabled
	 */
	private async _handleRetryableError(message: AssistantMessage): Promise<boolean> {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) return false;

		this._retryAttempt++;

		// Create retry promise on first attempt so waitForRetry() can await it
		if (this._retryAttempt === 1 && !this._retryPromise) {
			this._retryPromise = new Promise((resolve) => {
				this._retryResolve = resolve;
			});
		}

		if (this._retryAttempt > settings.maxRetries) {
			// Max retries exceeded, emit final failure and reset
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt: this._retryAttempt - 1,
				finalError: message.errorMessage,
			});
			this._retryAttempt = 0;
			this._resolveRetry(); // Resolve so waitForRetry() completes
			return false;
		}

		const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

		this._emit({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
		});

		// Remove error message from agent state (keep in session for history)
		const messages = this.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			this.agent.replaceMessages(messages.slice(0, -1));
		}

		// Wait with exponential backoff (abortable)
		this._retryAbortController = new AbortController();
		try {
			await this._sleep(delayMs, this._retryAbortController.signal);
		} catch {
			// Aborted during sleep - emit end event so UI can clean up
			const attempt = this._retryAttempt;
			this._retryAttempt = 0;
			this._retryAbortController = undefined;
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			this._resolveRetry();
			return false;
		}
		this._retryAbortController = undefined;

		// Retry via continue() - use setTimeout to break out of event handler chain
		setTimeout(() => {
			this.agent.continue().catch(() => {
				// Retry failed - will be caught by next agent_end
			});
		}, 0);

		return true;
	}

	/**
	 * Sleep helper that respects abort signal.
	 */
	private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Aborted"));
				return;
			}

			const timeout = setTimeout(resolve, ms);

			signal?.addEventListener("abort", () => {
				clearTimeout(timeout);
				reject(new Error("Aborted"));
			});
		});
	}

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		this._retryAbortController?.abort();
		this._retryAttempt = 0;
		this._resolveRetry();
	}

	/**
	 * Wait for any in-progress retry to complete.
	 * Returns immediately if no retry is in progress.
	 */
	private async waitForRetry(): Promise<void> {
		if (this._retryPromise) {
			await this._retryPromise;
		}
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this._retryPromise !== undefined;
	}

	/** Whether auto-retry is enabled */
	get autoRetryEnabled(): boolean {
		return this.settingsManager.getRetryEnabled();
	}

	/**
	 * Toggle auto-retry setting.
	 */
	setAutoRetryEnabled(enabled: boolean): void {
		this.settingsManager.setRetryEnabled(enabled);
	}

	// =========================================================================
	// Bash Execution
	// =========================================================================

	/**
	 * Execute a bash command.
	 * Adds result to agent context and session.
	 * @param command The bash command to execute
	 * @param onChunk Optional streaming callback for output
	 */
	async executeBash(command: string, onChunk?: (chunk: string) => void): Promise<BashResult> {
		this._bashAbortController = new AbortController();

		try {
			const result = await executeBashCommand(command, {
				onChunk,
				signal: this._bashAbortController.signal,
			});

			// Create and save message
			const bashMessage: BashExecutionMessage = {
				role: "bashExecution",
				command,
				output: result.output,
				exitCode: result.exitCode,
				cancelled: result.cancelled,
				truncated: result.truncated,
				fullOutputPath: result.fullOutputPath,
				timestamp: Date.now(),
			};

			// If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
			if (this.isStreaming) {
				// Queue for later - will be flushed on agent_end
				this._pendingBashMessages.push(bashMessage);
			} else {
				// Add to agent state immediately
				this.agent.appendMessage(bashMessage);

				// Save to session
				this.sessionManager.appendMessage(bashMessage);
			}

			return result;
		} finally {
			this._bashAbortController = undefined;
		}
	}

	/**
	 * Cancel running bash command.
	 */
	abortBash(): void {
		this._bashAbortController?.abort();
	}

	/** Whether a bash command is currently running */
	get isBashRunning(): boolean {
		return this._bashAbortController !== undefined;
	}

	/** Whether there are pending bash messages waiting to be flushed */
	get hasPendingBashMessages(): boolean {
		return this._pendingBashMessages.length > 0;
	}

	/**
	 * Flush pending bash messages to agent state and session.
	 * Called after agent turn completes to maintain proper message ordering.
	 */
	private _flushPendingBashMessages(): void {
		if (this._pendingBashMessages.length === 0) return;

		for (const bashMessage of this._pendingBashMessages) {
			// Add to agent state
			this.agent.appendMessage(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}

		this._pendingBashMessages = [];
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Switch to a different session file.
	 * Aborts current operation, loads messages, restores model/thinking.
	 * Listeners are preserved and will continue receiving events.
	 * @returns true if switch completed, false if cancelled by hook
	 */
	async switchSession(sessionPath: string): Promise<boolean> {
		const previousSessionFile = this.sessionManager.getSessionFile();

		// Emit session_before_switch event (can be cancelled)
		if (this._hookRunner?.hasHandlers("session_before_switch")) {
			const result = (await this._hookRunner.emit({
				type: "session_before_switch",
				targetSessionFile: sessionPath,
			})) as SessionBeforeSwitchResult | undefined;

			if (result?.cancel) {
				return false;
			}
		}

		this._disconnectFromAgent();
		await this.abort();
		this._queuedMessages = [];

		// Set new session
		this.sessionManager.setSessionFile(sessionPath);

		// Reload messages
		const sessionContext = this.sessionManager.buildSessionContext();

		// Emit session_switch event to hooks
		if (this._hookRunner) {
			await this._hookRunner.emit({
				type: "session_switch",
				previousSessionFile,
			});
		}

		// Emit session event to custom tools
		await this._emitToolSessionEvent("switch", previousSessionFile);

		this.agent.replaceMessages(sessionContext.messages);

		// Restore model if saved
		if (sessionContext.model) {
			const availableModels = await this._modelRegistry.getAvailable();
			const match = availableModels.find(
				(m) => m.provider === sessionContext.model!.provider && m.id === sessionContext.model!.modelId,
			);
			if (match) {
				this.agent.setModel(match);
			}
		}

		// Restore thinking level if saved (setThinkingLevel clamps to model capabilities)
		if (sessionContext.thinkingLevel) {
			this.setThinkingLevel(sessionContext.thinkingLevel as ThinkingLevel);
		}

		this._reconnectToAgent();
		return true;
	}

	/**
	 * Create a branch from a specific entry index.
	 * Emits before_branch/branch session events to hooks.
	 *
	 * @param entryIndex Index into session entries to branch from
	 * @returns Object with:
	 *   - selectedText: The text of the selected user message (for editor pre-fill)
	 *   - cancelled: True if a hook cancelled the branch
	 */
	async branch(entryIndex: number): Promise<{ selectedText: string; cancelled: boolean }> {
		const previousSessionFile = this.sessionFile;
		const entries = this.sessionManager.getEntries();
		const selectedEntry = entries[entryIndex];

		if (!selectedEntry || selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
			throw new Error("Invalid entry index for branching");
		}

		const selectedText = this._extractUserMessageText(selectedEntry.message.content);

		let skipConversationRestore = false;

		// Emit session_before_branch event (can be cancelled)
		if (this._hookRunner?.hasHandlers("session_before_branch")) {
			const result = (await this._hookRunner.emit({
				type: "session_before_branch",
				entryIndex: entryIndex,
			})) as SessionBeforeBranchResult | undefined;

			if (result?.cancel) {
				return { selectedText, cancelled: true };
			}
			skipConversationRestore = result?.skipConversationRestore ?? false;
		}

		if (!selectedEntry.parentId) {
			this.sessionManager.newSession();
		} else {
			this.sessionManager.createBranchedSession(selectedEntry.parentId);
		}

		// Reload messages from entries (works for both file and in-memory mode)
		const sessionContext = this.sessionManager.buildSessionContext();

		// Emit session_branch event to hooks (after branch completes)
		if (this._hookRunner) {
			await this._hookRunner.emit({
				type: "session_branch",
				previousSessionFile,
			});
		}

		// Emit session event to custom tools (with reason "branch")
		await this._emitToolSessionEvent("branch", previousSessionFile);

		if (!skipConversationRestore) {
			this.agent.replaceMessages(sessionContext.messages);
		}

		return { selectedText, cancelled: false };
	}

	// =========================================================================
	// Tree Navigation
	// =========================================================================

	/**
	 * Navigate to a different node in the session tree.
	 * Unlike branch() which creates a new session file, this stays in the same file.
	 *
	 * @param targetId The entry ID to navigate to
	 * @param options.summarize Whether user wants to summarize abandoned branch
	 * @param options.customInstructions Custom instructions for summarizer
	 * @returns Result with editorText (if user message) and cancelled status
	 */
	async navigateTree(
		targetId: string,
		options: { summarize?: boolean; customInstructions?: string } = {},
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }> {
		const oldLeafId = this.sessionManager.getLeafId();

		// No-op if already at target
		if (targetId === oldLeafId) {
			return { cancelled: false };
		}

		// Model required for summarization
		if (options.summarize && !this.model) {
			throw new Error("No model available for summarization");
		}

		const targetEntry = this.sessionManager.getEntry(targetId);
		if (!targetEntry) {
			throw new Error(`Entry ${targetId} not found`);
		}

		// Collect entries to summarize (from old leaf to common ancestor)
		const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
			this.sessionManager,
			oldLeafId,
			targetId,
		);

		// Prepare event data
		const preparation: TreePreparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize,
			userWantsSummary: options.summarize ?? false,
		};

		// Set up abort controller for summarization
		this._branchSummaryAbortController = new AbortController();
		let hookSummary: { summary: string; details?: unknown } | undefined;
		let fromHook = false;

		// Emit session_before_tree event
		if (this._hookRunner?.hasHandlers("session_before_tree")) {
			const result = (await this._hookRunner.emit({
				type: "session_before_tree",
				preparation,
				model: this.model!, // Checked above if summarize is true
				signal: this._branchSummaryAbortController.signal,
			})) as SessionBeforeTreeResult | undefined;

			if (result?.cancel) {
				return { cancelled: true };
			}

			if (result?.summary && options.summarize) {
				hookSummary = result.summary;
				fromHook = true;
			}
		}

		// Run default summarizer if needed
		let summaryText: string | undefined;
		if (options.summarize && entriesToSummarize.length > 0 && !hookSummary) {
			const model = this.model!;
			const apiKey = await this._modelRegistry.getApiKey(model);
			if (!apiKey) {
				throw new Error(`No API key for ${model.provider}`);
			}
			const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
			const result = await generateBranchSummary(entriesToSummarize, {
				model,
				apiKey,
				signal: this._branchSummaryAbortController.signal,
				customInstructions: options.customInstructions,
				maxTokens: branchSummarySettings.maxTokens,
			});
			this._branchSummaryAbortController = undefined;
			if (result.aborted) {
				return { cancelled: true, aborted: true };
			}
			if (result.error) {
				throw new Error(result.error);
			}
			summaryText = result.summary;
		} else if (hookSummary) {
			summaryText = hookSummary.summary;
		}

		// Determine the new leaf position based on target type
		let newLeafId: string | null;
		let editorText: string | undefined;

		if (targetEntry.type === "message" && targetEntry.message.role === "user") {
			// User message: leaf = parent (null if root), text goes to editor
			newLeafId = targetEntry.parentId;
			editorText = this._extractUserMessageText(targetEntry.message.content);
		} else if (targetEntry.type === "custom_message") {
			// Custom message: leaf = parent (null if root), text goes to editor
			newLeafId = targetEntry.parentId;
			editorText =
				typeof targetEntry.content === "string"
					? targetEntry.content
					: targetEntry.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
		} else {
			// Non-user message: leaf = selected node
			newLeafId = targetId;
		}

		// Switch leaf (with or without summary)
		// Summary is attached at the navigation target position (newLeafId), not the old branch
		let summaryEntry: BranchSummaryEntry | undefined;
		if (summaryText) {
			// Create summary at target position (can be null for root)
			const summaryId = this.sessionManager.branchWithSummary(newLeafId, summaryText);
			summaryEntry = this.sessionManager.getEntry(summaryId) as BranchSummaryEntry;
		} else if (newLeafId === null) {
			// No summary, navigating to root - reset leaf
			this.sessionManager.resetLeaf();
		} else {
			// No summary, navigating to non-root
			this.sessionManager.branch(newLeafId);
		}

		// Update agent state
		const sessionContext = this.sessionManager.buildSessionContext();
		this.agent.replaceMessages(sessionContext.messages);

		// Emit session_tree event
		if (this._hookRunner) {
			await this._hookRunner.emit({
				type: "session_tree",
				newLeafId: this.sessionManager.getLeafId(),
				oldLeafId,
				summaryEntry,
				fromHook: summaryText ? fromHook : undefined,
			});
		}

		// Emit to custom tools
		await this._emitToolSessionEvent("tree", this.sessionFile);

		this._branchSummaryAbortController = undefined;
		return { editorText, cancelled: false, summaryEntry };
	}

	/**
	 * Get all user messages from session for branch selector.
	 */
	getUserMessagesForBranching(): Array<{ entryIndex: number; text: string }> {
		const entries = this.sessionManager.getEntries();
		const result: Array<{ entryIndex: number; text: string }> = [];

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.type !== "message") continue;
			if (entry.message.role !== "user") continue;

			const text = this._extractUserMessageText(entry.message.content);
			if (text) {
				result.push({ entryIndex: i, text });
			}
		}

		return result;
	}

	private _extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
		}
		return "";
	}

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		const state = this.state;
		const userMessages = state.messages.filter((m) => m.role === "user").length;
		const assistantMessages = state.messages.filter((m) => m.role === "assistant").length;
		const toolResults = state.messages.filter((m) => m.role === "toolResult").length;

		let toolCalls = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		return {
			sessionFile: this.sessionFile,
			sessionId: this.sessionId,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults,
			totalMessages: state.messages.length,
			tokens: {
				input: totalInput,
				output: totalOutput,
				cacheRead: totalCacheRead,
				cacheWrite: totalCacheWrite,
				total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
			},
			cost: totalCost,
		};
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	exportToHtml(outputPath?: string): string {
		const themeName = this.settingsManager.getTheme();
		return exportSessionToHtml(this.sessionManager, this.state, { outputPath, themeName });
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or undefined if no assistant message exists
	 */
	getLastAssistantText(): string | undefined {
		const lastAssistant = this.messages
			.slice()
			.reverse()
			.find((m) => {
				if (m.role !== "assistant") return false;
				const msg = m as AssistantMessage;
				// Skip aborted messages with no content
				if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
				return true;
			});

		if (!lastAssistant) return undefined;

		let text = "";
		for (const content of (lastAssistant as AssistantMessage).content) {
			if (content.type === "text") {
				text += content.text;
			}
		}

		return text.trim() || undefined;
	}

	// =========================================================================
	// Hook System
	// =========================================================================

	/**
	 * Check if hooks have handlers for a specific event type.
	 */
	hasHookHandlers(eventType: string): boolean {
		return this._hookRunner?.hasHandlers(eventType) ?? false;
	}

	/**
	 * Get the hook runner (for setting UI context and error handlers).
	 */
	get hookRunner(): HookRunner | undefined {
		return this._hookRunner;
	}

	/**
	 * Get custom tools (for setting UI context in modes).
	 */
	get customTools(): LoadedCustomTool[] {
		return this._customTools;
	}

	/**
	 * Emit session event to all custom tools.
	 * Called on session switch, branch, and clear.
	 */
	private async _emitToolSessionEvent(
		reason: ToolSessionEvent["reason"],
		previousSessionFile: string | undefined,
	): Promise<void> {
		const event: ToolSessionEvent = {
			entries: this.sessionManager.getEntries(),
			sessionFile: this.sessionFile,
			previousSessionFile,
			reason,
		};
		for (const { tool } of this._customTools) {
			if (tool.onSession) {
				try {
					await tool.onSession(event);
				} catch (_err) {
					// Silently ignore tool errors during session events
				}
			}
		}
	}
}
