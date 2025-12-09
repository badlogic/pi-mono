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
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import { getModelsPath } from "../config.js";
import { type BashResult, executeBash as executeBashCommand } from "./bash-executor.js";
import { calculateContextTokens, compact, shouldCompact } from "./compaction.js";
import { exportSessionToHtml } from "./export-html.js";
import type { BashExecutionMessage } from "./messages.js";
import { getApiKeyForModel, getAvailableModels } from "./model-config.js";
import { loadSessionFromEntries, type SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";
import { expandSlashCommand, type FileSlashCommand } from "./slash-commands.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| AgentEvent
	| { type: "auto_compaction_start" }
	| { type: "auto_compaction_end"; result: CompactionResult | null; aborted: boolean };

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
	sessionFile: string;
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

	// Bash execution state
	private _bashAbortController: AbortController | null = null;
	private _pendingBashMessages: BashExecutionMessage[] = [];

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._scopedModels = config.scopedModels ?? [];
		this._fileCommands = config.fileCommands ?? [];
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

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
		// Notify all listeners
		this._emit(event);

		// Handle session persistence
		if (event.type === "message_end") {
			this.sessionManager.saveMessage(event.message);

			// Initialize session after first user+assistant exchange
			if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
				this.sessionManager.startSession(this.agent.state);
			}

			// Check auto-compaction after assistant messages
			if (event.message.role === "assistant") {
				await this._runAutoCompaction();
			}
		}
	};

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

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AppMessage[] {
		return this.agent.state.messages;
	}

	/** Current queue mode */
	get queueMode(): "all" | "one-at-a-time" {
		return this.agent.getQueueMode();
	}

	/** Current session file path */
	get sessionFile(): string {
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
					"Set an API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)\n" +
					`or create ${getModelsPath()}\n\n` +
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

		// Expand slash commands if requested
		const expandedText = expandCommands ? expandSlashCommand(text, [...this._fileCommands]) : text;

		await this.agent.prompt(expandedText, options?.attachments);
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

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	/**
	 * Reset agent and session to start fresh.
	 * Clears all messages and starts a new session.
	 * Listeners are preserved and will continue receiving events.
	 */
	async reset(): Promise<void> {
		this._disconnectFromAgent();
		await this.abort();
		this.agent.reset();
		this.sessionManager.reset();
		this._queuedMessages = [];
		this._reconnectToAgent();
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

		// Apply thinking level (silently use "off" if not supported)
		const effectiveThinking = next.model.reasoning ? next.thinkingLevel : "off";
		this.agent.setThinkingLevel(effectiveThinking);
		this.sessionManager.saveThinkingLevelChange(effectiveThinking);
		this.settingsManager.setDefaultThinkingLevel(effectiveThinking);

		return { model: next.model, thinkingLevel: effectiveThinking, isScoped: true };
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
	 * Silently uses "off" if model doesn't support thinking.
	 * Saves to session and settings.
	 */
	setThinkingLevel(level: ThinkingLevel): void {
		const effectiveLevel = this.supportsThinking() ? level : "off";
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

		const modelId = this.model?.id || "";
		const supportsXhigh = modelId.includes("codex-max");
		const levels: ThinkingLevel[] = supportsXhigh
			? ["off", "minimal", "low", "medium", "high", "xhigh"]
			: ["off", "minimal", "low", "medium", "high"];

		const currentIndex = levels.indexOf(this.thinkingLevel);
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];

		this.setThinkingLevel(nextLevel);
		return nextLevel;
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
	 * Internal: Run auto-compaction with events.
	 * Called after assistant messages complete.
	 */
	private async _runAutoCompaction(): Promise<void> {
		const settings = this.settingsManager.getCompactionSettings();
		if (!settings.enabled) return;

		// Get last non-aborted assistant message
		const messages = this.messages;
		let lastAssistant: AssistantMessage | null = null;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				if (assistantMsg.stopReason !== "aborted") {
					lastAssistant = assistantMsg;
					break;
				}
			}
		}
		if (!lastAssistant) return;

		const contextTokens = calculateContextTokens(lastAssistant.usage);
		const contextWindow = this.model?.contextWindow ?? 0;

		if (!shouldCompact(contextTokens, contextWindow, settings)) return;

		// Emit start event
		this._emit({ type: "auto_compaction_start" });
		this._autoCompactionAbortController = new AbortController();

		try {
			if (!this.model) {
				this._emit({ type: "auto_compaction_end", result: null, aborted: false });
				return;
			}

			const apiKey = await getApiKeyForModel(this.model);
			if (!apiKey) {
				this._emit({ type: "auto_compaction_end", result: null, aborted: false });
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
				this._emit({ type: "auto_compaction_end", result: null, aborted: true });
				return;
			}

			this.sessionManager.saveCompaction(compactionEntry);
			const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
			this.agent.replaceMessages(loaded.messages);

			const result: CompactionResult = {
				tokensBefore: compactionEntry.tokensBefore,
				summary: compactionEntry.summary,
			};
			this._emit({ type: "auto_compaction_end", result, aborted: false });
		} catch {
			// Silently fail auto-compaction but emit end event
			this._emit({ type: "auto_compaction_end", result: null, aborted: false });
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

				// Initialize session if needed
				if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
					this.sessionManager.startSession(this.agent.state);
				}
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

		// Initialize session if needed
		if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
			this.sessionManager.startSession(this.agent.state);
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
	 */
	async switchSession(sessionPath: string): Promise<void> {
		this._disconnectFromAgent();
		await this.abort();
		this._queuedMessages = [];

		// Set new session
		this.sessionManager.setSessionFile(sessionPath);

		// Reload messages
		const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
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

		// Restore thinking level if saved
		const savedThinking = this.sessionManager.loadThinkingLevel();
		if (savedThinking) {
			this.agent.setThinkingLevel(savedThinking as ThinkingLevel);
		}

		this._reconnectToAgent();
	}

	/**
	 * Create a branch from a specific entry index.
	 * @param entryIndex Index into session entries to branch from
	 * @returns The text of the selected user message (for editor pre-fill)
	 */
	branch(entryIndex: number): string {
		const entries = this.sessionManager.loadEntries();
		const selectedEntry = entries[entryIndex];

		if (!selectedEntry || selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
			throw new Error("Invalid entry index for branching");
		}

		const selectedText = this._extractUserMessageText(selectedEntry.message.content);

		// Create branched session
		const newSessionFile = this.sessionManager.createBranchedSessionFromEntries(entries, entryIndex);
		this.sessionManager.setSessionFile(newSessionFile);

		// Reload
		const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
		this.agent.replaceMessages(loaded.messages);

		return selectedText;
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
}
