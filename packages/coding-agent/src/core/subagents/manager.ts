/**
 * SubagentManager - Central registry and lifecycle manager for alive subagents.
 *
 * @module subagents/manager
 */

import { randomUUID } from "node:crypto";
import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { discoverAgents } from "./discovery.js";
import type {
	AliveSubagent,
	StartSubagentOptions,
	StartSubagentResult,
	SubagentConfig,
	SubagentFilter,
	SubagentManagerConfig,
	SubagentManagerEvent,
	SubagentManagerEventHandler,
	SubagentMessage,
	SubagentOutput,
} from "./types.js";

/**
 * SubagentManager manages the lifecycle of alive subagents.
 *
 * Features:
 * - Start/stop subagents
 * - Message passing between main agent and subagents
 * - Event subscription for status updates
 * - Agent discovery and configuration loading
 */
export class SubagentManager {
	private subagents = new Map<string, AliveSubagent>();
	private configs = new Map<string, SubagentConfig>();
	private listeners = new Set<SubagentManagerEventHandler>();
	private config: SubagentManagerConfig;
	private activeSubagentId: string | undefined;
	private cwd: string;

	constructor(config: SubagentManagerConfig) {
		this.config = config;
		this.cwd = config.cwd;
		this.loadConfigs();
	}

	// ========================================
	// Lifecycle
	// ========================================

	/**
	 * Load agent configurations from disk.
	 */
	private loadConfigs(): void {
		const discovery = discoverAgents(this.cwd);
		for (const agent of discovery.agents) {
			this.configs.set(agent.name, agent);
		}
	}

	/**
	 * Reload agent configurations from disk.
	 * Useful when agent definitions change.
	 */
	reloadConfigs(): void {
		this.configs.clear();
		this.loadConfigs();
	}

	/**
	 * Start a new subagent.
	 *
	 * @param name - Agent name (e.g., "scout", "planner")
	 * @param task - Task for the subagent to execute
	 * @param options - Start options
	 * @returns Result with subagent ID and status
	 */
	async startSubagent(name: string, task: string, options: StartSubagentOptions = {}): Promise<StartSubagentResult> {
		const config = this.configs.get(name);
		if (!config) {
			const available = Array.from(this.configs.keys()).join(", ") || "none";
			throw new Error(`Unknown agent: "${name}". Available agents: ${available}`);
		}

		// Check concurrent limit
		const active = Array.from(this.subagents.values()).filter(
			(s) => s.status !== "done" && s.status !== "error" && s.status !== "stopped",
		);
		const maxConcurrent = this.config.maxConcurrent ?? 4;
		if (active.length >= maxConcurrent) {
			throw new Error(`Maximum concurrent subagents reached (${maxConcurrent})`);
		}

		const id = this.generateId();
		const mode = options.mode ?? this.config.defaultMode ?? "in-memory";
		const cwd = options.cwd ?? this.cwd;

		const subagent: AliveSubagent = {
			id,
			name,
			config,
			mode,
			status: "starting",
			task,
			cwd,
			pendingMessages: [],
			messageHistory: [],
			startTime: Date.now(),
			lastActivity: Date.now(),
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
			turnCount: 0,
			abortController: new AbortController(),
		};

		this.subagents.set(id, subagent);
		this.emit({ type: "started", subagent });

		try {
			if (mode === "in-memory") {
				await this.startInMemory(subagent, task, options);
			} else {
				throw new Error("Process-based subagents not yet implemented. Use mode: 'in-memory'");
			}

			// If waitForResult is true, wait for completion
			const shouldWait = options.waitForResult ?? mode === "in-memory";
			if (shouldWait && subagent.status !== "done") {
				await this.waitForCompletion(id, options.timeout);
			}

			return {
				id,
				status: subagent.status,
				complete: subagent.status === "done",
				output: this.getLastOutput(subagent),
				usage: subagent.usage,
			};
		} catch (error) {
			const isTimeout = error instanceof Error && error.message.includes("timed out");
			if (isTimeout) {
				subagent.status = "error";
				this.emit({ type: "status", subagentId: id, status: "error" });
				this.emit({ type: "stopped", subagentId: id, reason: "timeout" });
				// Cancel the running work
				await this.stopSubagent(id);
			} else {
				subagent.status = "error";
				this.emit({ type: "status", subagentId: id, status: "error" });
				this.emit({ type: "stopped", subagentId: id, reason: "error" });
			}
			throw error;
		}
	}

	/**
	 * Start an in-memory subagent using the Agent class.
	 */
	private async startInMemory(subagent: AliveSubagent, task: string, options: StartSubagentOptions): Promise<void> {
		const config = subagent.config;

		// Resolve model
		const allModels = this.config.modelRegistry.getAll();
		let model = allModels.length > 0 ? allModels[0] : undefined;
		if (!model) {
			throw new Error("No models available in registry");
		}
		if (config.model) {
			const found = this.findModel(config.model);
			if (found) {
				model = found;
			}
		}
		subagent.model = model;

		// Create tools subset
		const tools = config.tools
			? this.config.toolFactory.createSubset(config.tools, subagent.cwd)
			: this.config.toolFactory.createAll(subagent.cwd);
		subagent.tools = tools;

		// Build system prompt
		let systemPrompt = config.systemPrompt;
		if (subagent.memoryContent) {
			systemPrompt = `[Previous context]\n${subagent.memoryContent}\n\n${systemPrompt}`;
		}
		if (options.context) {
			systemPrompt = `${systemPrompt}\n\n[Additional context]\n${options.context}`;
		}

		// Create Agent instance
		const agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				tools,
				messages: [],
				isStreaming: false,
				streamMessage: null,
				pendingToolCalls: new Set(),
			},
		});
		subagent.agent = agent;

		// Subscribe to agent events
		subagent.unsubscribe = agent.subscribe((event) => {
			this.handleAgentEvent(subagent, event);
		});

		// Update status and send initial task
		subagent.status = "running";
		this.emit({ type: "status", subagentId: subagent.id, status: "running" });

		// Record the task as a user message
		const taskMessage: SubagentMessage = {
			id: randomUUID(),
			subagentId: subagent.id,
			role: "user",
			content: task,
			timestamp: Date.now(),
			source: "parent",
		};
		subagent.messageHistory.push(taskMessage);

		try {
			// If waitForResult is false, start the prompt without awaiting
			if (options.waitForResult === false) {
				agent
					.prompt(task)
					.then(() => {
						subagent.status = "done";
						this.emit({ type: "status", subagentId: subagent.id, status: "done" });
						this.emit({ type: "stopped", subagentId: subagent.id, reason: "completed" });
					})
					.catch((error) => {
						subagent.status = "error";
						this.emit({ type: "status", subagentId: subagent.id, status: "error" });
						this.emit({ type: "error", subagentId: subagent.id, error: error as Error });
					});
			} else {
				await agent.prompt(task);
			}
		} catch (error) {
			// Agent errors are handled via events, but prompt() can throw synchronously
			subagent.status = "error";
			this.emit({ type: "status", subagentId: subagent.id, status: "error" });
			this.emit({ type: "error", subagentId: subagent.id, error: error as Error });
		}
	}

	/**
	 * Find a model by ID across all providers.
	 */
	private findModel(modelId: string) {
		// Try common providers
		const providers = ["anthropic", "google", "openai"];
		for (const provider of providers) {
			const model = this.config.modelRegistry.find(provider, modelId);
			if (model) return model;
		}
		return undefined;
	}

	/**
	 * Handle events from in-memory agent.
	 */
	private handleAgentEvent(subagent: AliveSubagent, event: AgentEvent): void {
		subagent.lastActivity = Date.now();

		switch (event.type) {
			case "message_start":
				// Message is starting - could be assistant or tool result
				break;

			case "message_end": {
				// Update usage for assistant messages
				if (event.message.role === "assistant") {
					const usage = (event.message as AssistantMessage).usage;
					if (usage) {
						subagent.usage.inputTokens += usage.input ?? 0;
						subagent.usage.outputTokens += usage.output ?? 0;
						subagent.usage.cacheReadTokens += usage.cacheRead ?? 0;
						subagent.usage.cacheWriteTokens += usage.cacheWrite ?? 0;
						subagent.usage.totalCost += usage.cost?.total ?? 0;
					}
				}

				// Record message in history
				const msg: SubagentMessage = {
					id: randomUUID(),
					subagentId: subagent.id,
					role: event.message.role as SubagentMessage["role"],
					content: this.messageToText(event.message),
					timestamp: Date.now(),
					source: "self",
				};
				subagent.messageHistory.push(msg);
				this.emit({ type: "message", subagentId: subagent.id, message: msg });
				break;
			}

			case "turn_end":
				subagent.turnCount++;
				break;

			case "agent_end":
				subagent.status = "done";
				this.emit({ type: "status", subagentId: subagent.id, status: "done" });
				this.emit({ type: "stopped", subagentId: subagent.id, reason: "completed" });
				break;
		}
	}

	/**
	 * Stop a subagent.
	 */
	async stopSubagent(id: string): Promise<void> {
		const subagent = this.subagents.get(id);
		if (!subagent) return;

		// Abort any ongoing operation
		subagent.abortController?.abort();

		// Kill process if process-based
		if (subagent.mode === "process" && subagent.process) {
			subagent.process.kill("SIGTERM");
		}

		// Unsubscribe from agent events
		subagent.unsubscribe?.();

		subagent.status = "stopped";
		this.emit({ type: "status", subagentId: id, status: "stopped" });
		this.emit({ type: "stopped", subagentId: id, reason: "killed" });

		// Remove from registry
		this.subagents.delete(id);

		// Clear active subagent if this was it
		if (this.activeSubagentId === id) {
			this.activeSubagentId = undefined;
		}
	}

	/**
	 * Stop all subagents.
	 */
	async stopAllSubagents(): Promise<void> {
		const ids = Array.from(this.subagents.keys());
		await Promise.all(ids.map((id) => this.stopSubagent(id)));
	}

	// ========================================
	// Communication
	// ========================================

	/**
	 * Send a message to a subagent.
	 */
	async sendToSubagent(id: string, message: string): Promise<void> {
		const subagent = this.subagents.get(id);
		if (!subagent) {
			throw new Error(`Subagent not found: ${id}`);
		}

		if (subagent.status === "done" || subagent.status === "stopped") {
			throw new Error(`Subagent ${id} is not active (status: ${subagent.status})`);
		}

		// Record the message
		const msg: SubagentMessage = {
			id: randomUUID(),
			subagentId: id,
			role: "user",
			content: message,
			timestamp: Date.now(),
			source: "parent",
		};
		subagent.messageHistory.push(msg);
		this.emit({ type: "message", subagentId: id, message: msg });

		// Update status
		const previousStatus = subagent.status;
		subagent.status = "running";
		this.emit({ type: "status", subagentId: id, status: "running" });

		try {
			if (subagent.mode === "in-memory" && subagent.agent) {
				await subagent.agent.prompt(message);
			} else if (subagent.mode === "process" && subagent.rpcClient) {
				await subagent.rpcClient.call("prompt", { message });
			} else {
				throw new Error(
					`No transport available for subagent ${subagent.id} (${subagent.name}, mode: ${subagent.mode})`,
				);
			}
		} catch (error) {
			// Restore status on error if not already in error state
			if (subagent.status === "running") {
				subagent.status = previousStatus;
				this.emit({ type: "status", subagentId: id, status: previousStatus });
			}
			throw error;
		}
	}

	/**
	 * Get subagent output.
	 */
	async getSubagentOutput(id: string): Promise<SubagentOutput> {
		const subagent = this.subagents.get(id);
		if (!subagent) {
			throw new Error(`Subagent not found: ${id}`);
		}

		return {
			id,
			status: subagent.status,
			output: this.getLastOutput(subagent),
			recentMessages: subagent.messageHistory.slice(-10),
			usage: subagent.usage,
			turnCount: subagent.turnCount,
		};
	}

	/**
	 * Wait for subagent to complete.
	 */
	async waitForCompletion(id: string, timeout?: number): Promise<void> {
		const subagent = this.subagents.get(id);
		if (!subagent) throw new Error(`Subagent not found: ${id}`);

		// Already complete?
		if (subagent.status === "done" || subagent.status === "error" || subagent.status === "stopped") {
			if (subagent.status === "error") {
				throw new Error(`Subagent ${id} failed`);
			}
			return;
		}

		return new Promise((resolve, reject) => {
			const timeoutMs = timeout ?? this.config.defaultTimeout ?? 300000;
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error(`Subagent ${id} timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			const handler = (event: SubagentManagerEvent) => {
				if (event.type === "stopped" && event.subagentId === id) {
					cleanup();
					if (event.reason === "error") {
						reject(new Error(`Subagent ${id} failed`));
					} else {
						resolve();
					}
				}
			};

			const cleanup = () => {
				clearTimeout(timer);
				this.off(handler);
			};

			this.on(handler);
		});
	}

	// ========================================
	// Query
	// ========================================

	/**
	 * Get a subagent by ID.
	 */
	getSubagent(id: string): AliveSubagent | undefined {
		return this.subagents.get(id);
	}

	/**
	 * List subagents, optionally filtered.
	 */
	listSubagents(filter?: SubagentFilter): AliveSubagent[] {
		let agents = Array.from(this.subagents.values());

		if (filter?.status) {
			const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
			agents = agents.filter((a) => statuses.includes(a.status));
		}

		if (filter?.name) {
			agents = agents.filter((a) => a.name === filter.name);
		}

		if (filter?.mode) {
			agents = agents.filter((a) => a.mode === filter.mode);
		}

		return agents;
	}

	/**
	 * Get the currently active subagent ID.
	 */
	getActiveSubagent(): string | undefined {
		return this.activeSubagentId;
	}

	/**
	 * Set the active subagent for user interaction.
	 */
	setActiveSubagent(id: string | undefined): void {
		if (id && !this.subagents.has(id)) {
			throw new Error(`Subagent not found: ${id}`);
		}
		this.activeSubagentId = id;
	}

	/**
	 * Get all available agent configurations.
	 */
	getAvailableAgents(): SubagentConfig[] {
		return Array.from(this.configs.values());
	}

	/**
	 * Get a specific agent configuration by name.
	 */
	getAgentConfig(name: string): SubagentConfig | undefined {
		return this.configs.get(name);
	}

	// ========================================
	// Events
	// ========================================

	/**
	 * Subscribe to subagent events.
	 */
	on(handler: SubagentManagerEventHandler): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	/**
	 * Unsubscribe from subagent events.
	 */
	off(handler: SubagentManagerEventHandler): void {
		this.listeners.delete(handler);
	}

	/**
	 * Emit an event to all listeners.
	 */
	private emit(event: SubagentManagerEvent): void {
		for (const handler of this.listeners) {
			try {
				handler(event);
			} catch (error) {
				console.error("Error in subagent event handler:", error);
			}
		}
	}

	// ========================================
	// Helpers
	// ========================================

	/**
	 * Generate a short unique ID for subagents.
	 */
	private generateId(): string {
		// Use first 8 characters of UUID for readability
		return randomUUID().slice(0, 8);
	}

	/**
	 * Get the last assistant output from a subagent.
	 */
	private getLastOutput(subagent: AliveSubagent): string {
		for (let i = subagent.messageHistory.length - 1; i >= 0; i--) {
			const msg = subagent.messageHistory[i];
			if (msg.role === "assistant") {
				return msg.content;
			}
		}
		return "";
	}

	/**
	 * Convert an AgentMessage to text for storage.
	 */
	private messageToText(message: AgentMessage): string {
		const msg = message as unknown as Record<string, unknown>;

		// Handle string content directly
		if (typeof msg.content === "string") {
			return msg.content;
		}

		// Handle array content (standard LLM messages)
		if (Array.isArray(msg.content)) {
			return msg.content
				.filter((c: Record<string, unknown>) => c.type === "text")
				.map((c: Record<string, unknown>) => (c as Record<string, unknown>).text)
				.join("\n");
		}

		// Handle BashExecutionMessage
		if (msg.role === "bashExecution") {
			return `$ ${(msg.command as string) ?? ""}\n${(msg.output as string) ?? ""}`;
		}

		// Fallback to JSON
		return JSON.stringify(message);
	}

	// ========================================
	// Cleanup
	// ========================================

	/**
	 * Dispose of the manager and all subagents.
	 */
	async dispose(): Promise<void> {
		await this.stopAllSubagents();
		this.listeners.clear();
		this.configs.clear();
	}
}
