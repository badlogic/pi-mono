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
import type { Model } from "@mariozechner/pi-ai";
import { getModelsPath } from "../config.js";
import { getApiKeyForModel } from "../model-config.js";
import type { SessionManager } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";
import { expandSlashCommand, type FileSlashCommand } from "../slash-commands.js";

/** Listener function for agent events */
export type AgentEventListener = (event: AgentEvent) => void;

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
	private _eventListeners: AgentEventListener[] = [];

	// Message queue state
	private _queuedMessages: string[] = [];

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

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentEventListener): () => void {
		this._eventListeners.push(listener);

		// Set up agent subscription if not already done
		if (!this._unsubscribeAgent) {
			this._unsubscribeAgent = this.agent.subscribe(async (event) => {
				// Notify all listeners
				for (const l of this._eventListeners) {
					l(event);
				}

				// Handle session persistence
				if (event.type === "message_end") {
					this.sessionManager.saveMessage(event.message);

					// Initialize session after first user+assistant exchange
					if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
						this.sessionManager.startSession(this.agent.state);
					}

					// Check auto-compaction after assistant messages
					// (will be implemented in WP7)
					// if (event.message.role === "assistant") {
					//   await this.checkAutoCompaction();
					// }
				}
			});
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
	 * Unsubscribe from agent entirely and clear all listeners.
	 * Used during reset/cleanup operations.
	 */
	unsubscribeAll(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
		this._eventListeners = [];
	}

	/**
	 * Re-subscribe to agent after unsubscribeAll.
	 * Call this after operations that require temporary unsubscription.
	 */
	resubscribe(): void {
		if (this._unsubscribeAgent) return; // Already subscribed

		this._unsubscribeAgent = this.agent.subscribe(async (event) => {
			for (const l of this._eventListeners) {
				l(event);
			}

			if (event.type === "message_end") {
				this.sessionManager.saveMessage(event.message);

				if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
					this.sessionManager.startSession(this.agent.state);
				}
			}
		});
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
	 */
	async reset(): Promise<void> {
		this.unsubscribeAll();
		await this.abort();
		this.agent.reset();
		this.sessionManager.reset();
		this._queuedMessages = [];
		// Note: caller should re-subscribe after reset if needed
	}
}
