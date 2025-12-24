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

import type { Agent, AgentEvent, AgentState, AppMessage, Attachment, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, Model, TextContent } from "@mariozechner/pi-ai";
import { isContextOverflow, supportsXhigh } from "@mariozechner/pi-ai";
import { getModelsPath } from "../config.js";
import { type BashResult, executeBash as executeBashCommand } from "./bash-executor.js";
import { calculateContextTokens, compact, shouldCompact } from "./compaction.js";
import type { LoadedCustomTool, SessionEvent as ToolSessionEvent } from "./custom-tools/index.js";
import { exportSessionToHtml } from "./export-html.js";
import type { HookRunner, SessionEventResult, TurnEndEvent, TurnStartEvent } from "./hooks/index.js";
import type { BashExecutionMessage } from "./messages.js";
import { getApiKeyForModel, getAvailableModels } from "./model-config.js";
import { loadSessionFromEntries, type SessionManager } from "./session-manager.js";
import type { SettingsManager, SkillsSettings } from "./settings-manager.js";
import { expandSlashCommand, type FileSlashCommand } from "./slash-commands.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| AgentEvent
	| { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
	| { type: "auto_compaction_end"; result: CompactionResult | null; aborted: boolean; willRetry: boolean }
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
	hookRunner?: HookRunner | null;
	/** Custom tools for session lifecycle events */
	customTools?: LoadedCustomTool[];
	skillsSettings?: Required<SkillsSettings>;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Whether to expand file-based slash commands (default: true) */
	expandSlashCommands?: boolean;
	/** Image/file attachments */
	attachments?: Attachment[];
}

/** Result from cycleModel() */
export interface ModelCycleResult {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	/** Whether cycling through scoped models (--models flag) or all available */
	isScoped: boolean;
}

/** Result from compact() or checkAutoCompaction() */
export interface CompactionResult {
	tokensBefore: number;
	summary: string;
}

/** Session statistics for /session command */
export interface SessionStats {
	sessionFile: string | null;
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
	private _compactionAbortController: AbortController | null = null;
	private _autoCompactionAbortController: AbortController | null = null;

	// Retry state
	private _retryAbortController: AbortController | null = null;
	private _retryAttempt = 0;
	private _retryPromise: Promise<void> | null = null;
	private _retryResolve: (() => void) | null = null;

	// Bash execution state
	private _bashAbortController: AbortController | null = null;
	private _pendingBashMessages: BashExecutionMessage[] = [];

	// Hook system
	private _hookRunner: HookRunner | null = null;
	private _turnIndex = 0;

	// Custom tools for session lifecycle
	private _customTools: LoadedCustomTool[] = [];

	private _skillsSettings: Required<SkillsSettings> | undefined;

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._scopedModels = config.scopedModels ?? [];
		this._fileCommands = config.fileCommands ?? [];
		this._hookRunner = config.hookRunner ?? null;
		this._customTools = config.customTools ?? [];
		this._skillsSettings = config.skillsSettings;
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
	private _lastAssistantMessage: AssistantMessage | null = null;

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
			this.sessionManager.saveMessage(event.message);

			// Track assistant message for auto-compaction (checked on agent_end)
			if (event.message.role === "assistant") {
				this._lastAssistantMessage = event.message;
			}
		}

		// Check auto-retry and auto-compaction after agent completes
		if (event.type === "agent_end" && this._lastAssistantMessage) {
			const msg = this._lastAssistantMessage;
			this._lastAssistantMessage = null;

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
			this._retryResolve = null;
			this._retryPromise = null;
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
	private _findLastAssistantMessage(): AssistantMessage | null {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as AssistantMessage;
			}
		}
		return null;
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

		// Set up agent subscription if not already done
		if (!this._unsubscribeAgent) {
			this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		}

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

	/** Current model (may be null if not yet selected) */
	get model(): Model<any> | null {
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
		return this._autoCompactionAbortController !== null || this._compactionAbortController !== null;
	}

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AppMessage[] {
		return this.agent.state.messages;
	}

	/** Current queue mode */
	get queueMode(): "all" | "one-at-a-time" {
		return this.agent.getQueueMode();
	}

	/** Current session file path, or null if sessions are disabled */
	get sessionFile(): string | null {
		return this.sessionManager.isPersisted() ? this.sessionManager.getSessionFile() : null;
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
	 * - Expands file-based slash commands by default
	 * @throws Error if no model selected or no API key available
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		// Flush any pending bash messages before the new prompt
		this._flushPendingBashMessages();

		const expandCommands = options?.expandSlashCommands ?? true;

		// Validate model
		if (!this.model) {
			throw new Error(
				"No model selected.\n\n" +
					`Use /login, set an API key environment variable or create ${getModelsPath()}\n\n` +
					"Then use /model to select a model.",
			);
		}

		// Validate API key
		const apiKey = await getApiKeyForModel(this.model);
		if (!apiKey) {
			throw new Error(
				`No API key found for ${this.model.provider}.\n\n` +
					`Set the appropriate environment variable or update ${getModelsPath()}`,
			);
		}

		// Check if we need to compact before sending (catches aborted responses)
		const lastAssistant = this._findLastAssistantMessage();
		if (lastAssistant) {
			await this._checkCompaction(lastAssistant, false);
		}

		// Expand slash commands if requested
		const expandedText = expandCommands ? expandSlashCommand(text, [...this._fileCommands]) : text;

		await this.agent.prompt(expandedText, options?.attachments);
		await this.waitForRetry();
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
		const entries = this.sessionManager.loadEntries();

		// Emit before_clear event (can be cancelled)
		if (this._hookRunner?.hasHandlers("session")) {
			const result = (await this._hookRunner.emit({
				type: "session",
				entries,
				sessionFile: this.sessionFile,
				previousSessionFile: null,
				reason: "before_clear",
			})) as SessionEventResult | undefined;

			if (result?.cancel) {
				return false;
			}
		}

		this._disconnectFromAgent();
		await this.abort();
		this.agent.reset();
		this.sessionManager.reset();
		this._queuedMessages = [];
		this._reconnectToAgent();

		// Emit session event with reason "clear" to hooks
		if (this._hookRunner) {
			this._hookRunner.setSessionFile(this.sessionFile);
			await this._hookRunner.emit({
				type: "session",
				entries: [],
				sessionFile: this.sessionFile,
				previousSessionFile,
				reason: "clear",
			});
		}

		// Emit session event to custom tools
		await this._emitToolSessionEvent("clear", previousSessionFile);
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
		const apiKey = await getApiKeyForModel(model);
		if (!apiKey) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		this.agent.setModel(model);
		this.sessionManager.saveModelChange(model.provider, model.id);
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(this.thinkingLevel);
	}

	/**
	 * Cycle to next model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @returns The new model info, or null if only one model available
	 */
	async cycleModel(): Promise<ModelCycleResult | null> {
		if (this._scopedModels.length > 0) {
			return this._cycleScopedModel();
		}
		return this._cycleAvailableModel();
	}

	private async _cycleScopedModel(): Promise<ModelCycleResult | null> {
		if (this._scopedModels.length <= 1) return null;

		const currentModel = this.model;
		let currentIndex = this._scopedModels.findIndex(
			(sm) => sm.model.id === currentModel?.id && sm.model.provider === currentModel?.provider,
		);

		if (currentIndex === -1) currentIndex = 0;
		const nextIndex = (currentIndex + 1) % this._scopedModels.length;
		const next = this._scopedModels[nextIndex];

		// Validate API key
		const apiKey = await getApiKeyForModel(next.model);
		if (!apiKey) {
			throw new Error(`No API key for ${next.model.provider}/${next.model.id}`);
		}

		// Apply model
		this.agent.setModel(next.model);
		this.sessionManager.saveModelChange(next.model.provider, next.model.id);
		this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);

		// Apply thinking level (setThinkingLevel clamps to model capabilities)
		this.setThinkingLevel(next.thinkingLevel);

		return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
	}

	private async _cycleAvailableModel(): Promise<ModelCycleResult | null> {
		const { models: availableModels, error } = await getAvailableModels();
		if (error) throw new Error(`Failed to load models: ${error}`);
		if (availableModels.length <= 1) return null;

		const currentModel = this.model;
		let currentIndex = availableModels.findIndex(
			(m) => m.id === currentModel?.id && m.provider === currentModel?.provider,
		);

		if (currentIndex === -1) currentIndex = 0;
		const nextIndex = (currentIndex + 1) % availableModels.length;
		const nextModel = availableModels[nextIndex];

		const apiKey = await getApiKeyForModel(nextModel);
		if (!apiKey) {
			throw new Error(`No API key for ${nextModel.provider}/${nextModel.id}`);
		}

		this.agent.setModel(nextModel);
		this.sessionManager.saveModelChange(nextModel.provider, nextModel.id);
		this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(this.thinkingLevel);

		return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	/**
	 * Get all available models with valid API keys.
	 */
	async getAvailableModels(): Promise<Model<any>[]> {
		const { models, error } = await getAvailableModels();
		if (error) throw new Error(error);
		return models;
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
		this.sessionManager.saveThinkingLevelChange(effectiveLevel);
		this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or null if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | null {
		if (!this.supportsThinking()) return null;

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
		// Abort any running operation
		this._disconnectFromAgent();
		await this.abort();

		// Create abort controller
		this._compactionAbortController = new AbortController();

		try {
			if (!this.model) {
				throw new Error("No model selected");
			}

			const apiKey = await getApiKeyForModel(this.model);
			if (!apiKey) {
				throw new Error(`No API key for ${this.model.provider}`);
			}

			const entries = this.sessionManager.loadEntries();
			const settings = this.settingsManager.getCompactionSettings();
			const compactionEntry = await compact(
				entries,
				this.model,
				settings,
				apiKey,
				this._compactionAbortController.signal,
				customInstructions,
			);

			if (this._compactionAbortController.signal.aborted) {
				throw new Error("Compaction cancelled");
			}

			// Save and reload
			this.sessionManager.saveCompaction(compactionEntry);
			const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
			this.agent.replaceMessages(loaded.messages);

			return {
				tokensBefore: compactionEntry.tokensBefore,
				summary: compactionEntry.summary,
			};
		} finally {
			this._compactionAbortController = null;
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
				this._emit({ type: "auto_compaction_end", result: null, aborted: false, willRetry: false });
				return;
			}

			const apiKey = await getApiKeyForModel(this.model);
			if (!apiKey) {
				this._emit({ type: "auto_compaction_end", result: null, aborted: false, willRetry: false });
				return;
			}

			const entries = this.sessionManager.loadEntries();
			const compactionEntry = await compact(
				entries,
				this.model,
				settings,
				apiKey,
				this._autoCompactionAbortController.signal,
			);

			if (this._autoCompactionAbortController.signal.aborted) {
				this._emit({ type: "auto_compaction_end", result: null, aborted: true, willRetry: false });
				return;
			}

			this.sessionManager.saveCompaction(compactionEntry);
			const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
			this.agent.replaceMessages(loaded.messages);

			const result: CompactionResult = {
				tokensBefore: compactionEntry.tokensBefore,
				summary: compactionEntry.summary,
			};
			this._emit({ type: "auto_compaction_end", result, aborted: false, willRetry });

			// Auto-retry if needed - use continue() since user message is already in context
			if (willRetry) {
				// Remove trailing error message from agent state (it's kept in session file for history)
				// This is needed because continue() requires last message to be user or toolResult
				const messages = this.agent.state.messages;
				const lastMsg = messages[messages.length - 1];
				if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
					this.agent.replaceMessages(messages.slice(0, -1));
				}

				// Use setTimeout to break out of the event handler chain
				setTimeout(() => {
					this.agent.continue().catch(() => {
						// Retry failed - silently ignore, user can manually retry
					});
				}, 100);
			}
		} catch (error) {
			// Compaction failed - emit end event without retry
			this._emit({ type: "auto_compaction_end", result: null, aborted: false, willRetry: false });

			// If this was overflow recovery and compaction failed, we have a hard stop
			if (reason === "overflow") {
				throw new Error(
					`Context overflow: ${error instanceof Error ? error.message : "compaction failed"}. Your input may be too large for the context window.`,
				);
			}
		} finally {
			this._autoCompactionAbortController = null;
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
			this._retryAbortController = null;
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			this._resolveRetry();
			return false;
		}
		this._retryAbortController = null;

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
		return this._retryPromise !== null;
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
				this.sessionManager.saveMessage(bashMessage);
			}

			return result;
		} finally {
			this._bashAbortController = null;
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
		return this._bashAbortController !== null;
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
			this.sessionManager.saveMessage(bashMessage);
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
		const previousSessionFile = this.sessionFile;
		const oldEntries = this.sessionManager.loadEntries();

		// Emit before_switch event (can be cancelled)
		if (this._hookRunner?.hasHandlers("session")) {
			const result = (await this._hookRunner.emit({
				type: "session",
				entries: oldEntries,
				sessionFile: this.sessionFile,
				previousSessionFile: null,
				reason: "before_switch",
			})) as SessionEventResult | undefined;

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
		const entries = this.sessionManager.loadEntries();
		const loaded = loadSessionFromEntries(entries);

		// Emit session event to hooks
		if (this._hookRunner) {
			this._hookRunner.setSessionFile(sessionPath);
			await this._hookRunner.emit({
				type: "session",
				entries,
				sessionFile: sessionPath,
				previousSessionFile,
				reason: "switch",
			});
		}

		// Emit session event to custom tools
		await this._emitToolSessionEvent("switch", previousSessionFile);

		this.agent.replaceMessages(loaded.messages);

		// Restore model if saved
		const savedModel = this.sessionManager.loadModel();
		if (savedModel) {
			const availableModels = (await getAvailableModels()).models;
			const match = availableModels.find((m) => m.provider === savedModel.provider && m.id === savedModel.modelId);
			if (match) {
				this.agent.setModel(match);
			}
		}

		// Restore thinking level if saved (setThinkingLevel clamps to model capabilities)
		const savedThinking = this.sessionManager.loadThinkingLevel();
		if (savedThinking) {
			this.setThinkingLevel(savedThinking as ThinkingLevel);
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
		const entries = this.sessionManager.loadEntries();
		const selectedEntry = entries[entryIndex];

		if (!selectedEntry || selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
			throw new Error("Invalid entry index for branching");
		}

		const selectedText = this._extractUserMessageText(selectedEntry.message.content);

		let skipConversationRestore = false;

		// Emit before_branch event (can be cancelled)
		if (this._hookRunner?.hasHandlers("session")) {
			const result = (await this._hookRunner.emit({
				type: "session",
				entries,
				sessionFile: this.sessionFile,
				previousSessionFile: null,
				reason: "before_branch",
				targetTurnIndex: entryIndex,
			})) as SessionEventResult | undefined;

			if (result?.cancel) {
				return { selectedText, cancelled: true };
			}
			skipConversationRestore = result?.skipConversationRestore ?? false;
		}

		// Create branched session (returns null in --no-session mode)
		const newSessionFile = this.sessionManager.createBranchedSessionFromEntries(entries, entryIndex);

		// Update session file if we have one (file-based mode)
		if (newSessionFile !== null) {
			this.sessionManager.setSessionFile(newSessionFile);
		}

		// Reload messages from entries (works for both file and in-memory mode)
		const newEntries = this.sessionManager.loadEntries();
		const loaded = loadSessionFromEntries(newEntries);

		// Emit branch event to hooks (after branch completes)
		if (this._hookRunner) {
			this._hookRunner.setSessionFile(newSessionFile);
			await this._hookRunner.emit({
				type: "session",
				entries: newEntries,
				sessionFile: newSessionFile,
				previousSessionFile,
				reason: "branch",
				targetTurnIndex: entryIndex,
			});
		}

		// Emit session event to custom tools (with reason "branch")
		await this._emitToolSessionEvent("branch", previousSessionFile);

		if (!skipConversationRestore) {
			this.agent.replaceMessages(loaded.messages);
		}

		return { selectedText, cancelled: false };
	}

	/**
	 * Get all user messages from session for branch selector.
	 */
	getUserMessagesForBranching(): Array<{ entryIndex: number; text: string }> {
		const entries = this.sessionManager.loadEntries();
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
		return exportSessionToHtml(this.sessionManager, this.state, outputPath);
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or null if no assistant message exists
	 */
	getLastAssistantText(): string | null {
		const lastAssistant = this.messages
			.slice()
			.reverse()
			.find((m) => m.role === "assistant");

		if (!lastAssistant) return null;

		let text = "";
		for (const content of (lastAssistant as AssistantMessage).content) {
			if (content.type === "text") {
				text += content.text;
			}
		}

		return text.trim() || null;
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
	get hookRunner(): HookRunner | null {
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
		previousSessionFile: string | null,
	): Promise<void> {
		const event: ToolSessionEvent = {
			entries: this.sessionManager.loadEntries(),
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
