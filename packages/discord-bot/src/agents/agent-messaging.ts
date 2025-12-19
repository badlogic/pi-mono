/**
 * Agent-to-Agent Messaging System
 *
 * Enables multi-agent coordination with async/sync messaging patterns.
 * Superior to Letta: Integrated with cross-platform hub, no external API.
 *
 * Features:
 * - Asynchronous messaging (fire-and-forget)
 * - Synchronous messaging (wait for response)
 * - Broadcast to tagged agents
 * - Message queue with persistence
 * - Agent discovery by tags
 */

import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export interface AgentMessage {
	id: string;
	from: string;
	to: string;
	content: string;
	timestamp: string;
	replyTo?: string;
	metadata?: Record<string, unknown>;
}

export interface AgentInfo {
	id: string;
	name: string;
	tags: string[];
	status: "online" | "offline" | "busy";
	lastSeen: string;
	capabilities?: string[];
}

export interface MessageResult {
	success: boolean;
	messageId: string;
	delivered: boolean;
	response?: string;
	error?: string;
}

export interface BroadcastResult {
	success: boolean;
	sent: number;
	delivered: number;
	responses: Array<{
		agentId: string;
		response?: string;
		error?: string;
	}>;
}

type MessageHandler = (message: AgentMessage) => Promise<string | void>;

// ============================================================================
// Agent Message Bus
// ============================================================================

export class AgentMessageBus extends EventEmitter {
	private agents: Map<string, AgentInfo> = new Map();
	private handlers: Map<string, MessageHandler> = new Map();
	private messageQueue: Map<string, AgentMessage[]> = new Map();
	private pendingResponses: Map<string, { resolve: (value: string) => void; timeout: NodeJS.Timeout }> = new Map();
	private dataDir: string;

	constructor(dataDir: string = DEFAULT_DATA_DIR) {
		super();
		this.dataDir = dataDir;
		this.loadState();
	}

	/**
	 * Load persisted state
	 */
	private loadState(): void {
		const statePath = join(this.dataDir, "agent_bus_state.json");
		if (existsSync(statePath)) {
			try {
				const data = JSON.parse(readFileSync(statePath, "utf-8"));
				if (data.agents) {
					for (const [id, info] of Object.entries(data.agents)) {
						this.agents.set(id, info as AgentInfo);
					}
				}
				if (data.messageQueue) {
					for (const [id, messages] of Object.entries(data.messageQueue)) {
						this.messageQueue.set(id, messages as AgentMessage[]);
					}
				}
			} catch {
				// Ignore corrupt state
			}
		}
	}

	/**
	 * Persist state
	 */
	private saveState(): void {
		const dir = dirname(join(this.dataDir, "agent_bus_state.json"));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const state = {
			agents: Object.fromEntries(this.agents),
			messageQueue: Object.fromEntries(this.messageQueue),
		};

		writeFileSync(join(this.dataDir, "agent_bus_state.json"), JSON.stringify(state, null, 2));
	}

	/**
	 * Generate unique message ID
	 */
	private generateMessageId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	// ========================================================================
	// Agent Registration
	// ========================================================================

	/**
	 * Register an agent with the message bus
	 */
	registerAgent(info: AgentInfo, handler: MessageHandler): void {
		this.agents.set(info.id, {
			...info,
			status: "online",
			lastSeen: new Date().toISOString(),
		});
		this.handlers.set(info.id, handler);

		// Deliver any queued messages
		this.deliverQueuedMessages(info.id);

		this.emit("agent:registered", info);
		this.saveState();
	}

	/**
	 * Unregister an agent
	 */
	unregisterAgent(agentId: string): void {
		const info = this.agents.get(agentId);
		if (info) {
			info.status = "offline";
			info.lastSeen = new Date().toISOString();
		}
		this.handlers.delete(agentId);

		this.emit("agent:unregistered", agentId);
		this.saveState();
	}

	/**
	 * Update agent status
	 */
	updateAgentStatus(agentId: string, status: AgentInfo["status"]): void {
		const info = this.agents.get(agentId);
		if (info) {
			info.status = status;
			info.lastSeen = new Date().toISOString();
			this.saveState();
		}
	}

	/**
	 * Get all registered agents
	 */
	getAgents(): AgentInfo[] {
		return Array.from(this.agents.values());
	}

	/**
	 * Find agents by tags
	 */
	findAgentsByTags(tags: string[], matchAll = true): AgentInfo[] {
		return Array.from(this.agents.values()).filter((agent) => {
			if (matchAll) {
				return tags.every((tag) => agent.tags.includes(tag));
			}
			return tags.some((tag) => agent.tags.includes(tag));
		});
	}

	// ========================================================================
	// Messaging
	// ========================================================================

	/**
	 * Send asynchronous message (fire-and-forget)
	 */
	async sendAsync(
		from: string,
		to: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MessageResult> {
		const message: AgentMessage = {
			id: this.generateMessageId(),
			from,
			to,
			content,
			timestamp: new Date().toISOString(),
			metadata,
		};

		const handler = this.handlers.get(to);

		if (handler) {
			// Agent is online, deliver immediately
			try {
				handler(message).catch((err) => {
					console.error(`Error handling message ${message.id}:`, err);
				});

				this.emit("message:sent", message);

				return {
					success: true,
					messageId: message.id,
					delivered: true,
				};
			} catch (error) {
				return {
					success: false,
					messageId: message.id,
					delivered: false,
					error: error instanceof Error ? error.message : "Unknown error",
				};
			}
		} else {
			// Agent offline, queue message
			if (!this.messageQueue.has(to)) {
				this.messageQueue.set(to, []);
			}
			this.messageQueue.get(to)!.push(message);
			this.saveState();

			this.emit("message:queued", message);

			return {
				success: true,
				messageId: message.id,
				delivered: false,
			};
		}
	}

	/**
	 * Send synchronous message and wait for response
	 */
	async sendAndWait(
		from: string,
		to: string,
		content: string,
		timeoutMs = 30000,
		metadata?: Record<string, unknown>,
	): Promise<MessageResult> {
		const message: AgentMessage = {
			id: this.generateMessageId(),
			from,
			to,
			content,
			timestamp: new Date().toISOString(),
			metadata,
		};

		const handler = this.handlers.get(to);

		if (!handler) {
			return {
				success: false,
				messageId: message.id,
				delivered: false,
				error: `Agent "${to}" is not online`,
			};
		}

		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				this.pendingResponses.delete(message.id);
				resolve({
					success: false,
					messageId: message.id,
					delivered: true,
					error: "Response timeout",
				});
			}, timeoutMs);

			this.pendingResponses.set(message.id, {
				resolve: (response: string) => {
					clearTimeout(timeout);
					this.pendingResponses.delete(message.id);
					resolve({
						success: true,
						messageId: message.id,
						delivered: true,
						response,
					});
				},
				timeout,
			});

			// Execute handler and resolve with response
			handler(message)
				.then((response) => {
					const pending = this.pendingResponses.get(message.id);
					if (pending) {
						pending.resolve(response || "");
					}
				})
				.catch((error) => {
					const pending = this.pendingResponses.get(message.id);
					if (pending) {
						clearTimeout(pending.timeout);
						this.pendingResponses.delete(message.id);
						resolve({
							success: false,
							messageId: message.id,
							delivered: true,
							error: error instanceof Error ? error.message : "Handler error",
						});
					}
				});

			this.emit("message:sent", message);
		});
	}

	/**
	 * Broadcast message to agents matching tags
	 */
	async broadcast(
		from: string,
		tags: string[],
		content: string,
		waitForResponses = false,
		metadata?: Record<string, unknown>,
	): Promise<BroadcastResult> {
		const targetAgents = this.findAgentsByTags(tags, true);

		if (targetAgents.length === 0) {
			return {
				success: false,
				sent: 0,
				delivered: 0,
				responses: [],
			};
		}

		const results: BroadcastResult["responses"] = [];
		let delivered = 0;

		for (const agent of targetAgents) {
			if (waitForResponses) {
				const result = await this.sendAndWait(from, agent.id, content, 30000, metadata);
				results.push({
					agentId: agent.id,
					response: result.response,
					error: result.error,
				});
				if (result.delivered) delivered++;
			} else {
				const result = await this.sendAsync(from, agent.id, content, metadata);
				results.push({
					agentId: agent.id,
					error: result.error,
				});
				if (result.delivered) delivered++;
			}
		}

		return {
			success: true,
			sent: targetAgents.length,
			delivered,
			responses: results,
		};
	}

	/**
	 * Deliver queued messages to an agent
	 */
	private async deliverQueuedMessages(agentId: string): Promise<void> {
		const queue = this.messageQueue.get(agentId);
		const handler = this.handlers.get(agentId);

		if (!queue || queue.length === 0 || !handler) {
			return;
		}

		// Deliver all queued messages
		for (const message of queue) {
			try {
				await handler(message);
				this.emit("message:delivered", message);
			} catch (error) {
				console.error(`Error delivering queued message ${message.id}:`, error);
			}
		}

		// Clear queue
		this.messageQueue.delete(agentId);
		this.saveState();
	}

	/**
	 * Get pending messages for an agent
	 */
	getPendingMessages(agentId: string): AgentMessage[] {
		return this.messageQueue.get(agentId) || [];
	}
}

// ============================================================================
// Agent Messaging Tools
// ============================================================================

export function createAgentMessagingTools(bus: AgentMessageBus, currentAgentId: string) {
	return {
		send_message_to_agent_async: {
			name: "send_message_to_agent_async",
			description:
				"Send a message to another agent without waiting for a response. Use for notifications or fire-and-forget communication.",
			parameters: {
				type: "object",
				properties: {
					target_agent: {
						type: "string",
						description: "ID of the agent to send message to",
					},
					message: {
						type: "string",
						description: "Message content to send",
					},
				},
				required: ["target_agent", "message"],
			},
			execute: async (args: { target_agent: string; message: string }) => {
				const result = await bus.sendAsync(currentAgentId, args.target_agent, args.message);
				return JSON.stringify(result);
			},
		},

		send_message_to_agent_and_wait: {
			name: "send_message_to_agent_and_wait",
			description:
				"Send a message to another agent and wait for their response. Use when you need information from another agent.",
			parameters: {
				type: "object",
				properties: {
					target_agent: {
						type: "string",
						description: "ID of the agent to send message to",
					},
					message: {
						type: "string",
						description: "Message content to send",
					},
					timeout_seconds: {
						type: "number",
						description: "How long to wait for response (default: 30)",
					},
				},
				required: ["target_agent", "message"],
			},
			execute: async (args: { target_agent: string; message: string; timeout_seconds?: number }) => {
				const timeoutMs = (args.timeout_seconds || 30) * 1000;
				const result = await bus.sendAndWait(currentAgentId, args.target_agent, args.message, timeoutMs);
				return JSON.stringify(result);
			},
		},

		broadcast_to_agents: {
			name: "broadcast_to_agents",
			description:
				"Send a message to all agents matching specified tags. Use for coordinating multiple worker agents.",
			parameters: {
				type: "object",
				properties: {
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Tags that target agents must have (all must match)",
					},
					message: {
						type: "string",
						description: "Message content to broadcast",
					},
					wait_for_responses: {
						type: "boolean",
						description: "Whether to wait for responses from all agents (default: false)",
					},
				},
				required: ["tags", "message"],
			},
			execute: async (args: { tags: string[]; message: string; wait_for_responses?: boolean }) => {
				const result = await bus.broadcast(
					currentAgentId,
					args.tags,
					args.message,
					args.wait_for_responses || false,
				);
				return JSON.stringify(result);
			},
		},

		list_available_agents: {
			name: "list_available_agents",
			description: "List all available agents and their status.",
			parameters: {
				type: "object",
				properties: {
					tags: {
						type: "array",
						items: { type: "string" },
						description: "Optional: filter by tags",
					},
					online_only: {
						type: "boolean",
						description: "Only show online agents (default: true)",
					},
				},
			},
			execute: async (args: { tags?: string[]; online_only?: boolean }) => {
				let agents = bus.getAgents();

				if (args.tags && args.tags.length > 0) {
					agents = bus.findAgentsByTags(args.tags, false);
				}

				if (args.online_only !== false) {
					agents = agents.filter((a) => a.status === "online");
				}

				return JSON.stringify({
					count: agents.length,
					agents: agents.map((a) => ({
						id: a.id,
						name: a.name,
						tags: a.tags,
						status: a.status,
						capabilities: a.capabilities,
					})),
				});
			},
		},
	};
}

// ============================================================================
// Singleton Instance
// ============================================================================

let messageBusInstance: AgentMessageBus | null = null;

export function getAgentMessageBus(dataDir?: string): AgentMessageBus {
	if (!messageBusInstance) {
		messageBusInstance = new AgentMessageBus(dataDir);
	}
	return messageBusInstance;
}

export function disposeAgentMessageBus(): void {
	messageBusInstance = null;
}

export default AgentMessageBus;
