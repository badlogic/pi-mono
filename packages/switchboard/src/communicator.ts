/**
 * Communicator Hook - Real-time Inter-Agent Communication
 *
 * Connects Pi agents to the Switchboard service via WebSocket for true push/pull messaging.
 *
 * Features:
 * - WebSocket connection for instant message delivery (PUSH)
 * - HTTP fallback for sending messages (PULL)
 * - Auto-reconnection with exponential backoff
 * - Graceful degradation if Switchboard is unavailable
 *
 * Configuration (via env vars):
 *   SWITCHBOARD_URL   - Switchboard HTTP URL (default: http://127.0.0.1:7890)
 *   SWITCHBOARD_WS    - Switchboard WebSocket URL (default: ws://127.0.0.1:7890)
 *   PI_AGENT_NAME     - Agent identifier (default: derived from cwd)
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import WebSocket from "ws";

const SWITCHBOARD_HTTP = process.env.SWITCHBOARD_URL || "http://127.0.0.1:7890";
const SWITCHBOARD_WS = process.env.SWITCHBOARD_WS || "ws://127.0.0.1:7890";

// Reconnection settings
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;

interface SwitchboardMessage {
	id: string;
	from: string;
	to: string;
	type: "task" | "info" | "question" | "response" | "alert";
	priority: "low" | "normal" | "high" | "urgent";
	subject?: string;
	message: string;
	timestamp: string;
	metadata?: Record<string, unknown>;
}

interface WebSocketEvent {
	type: "message" | "connected" | "ack" | "emitted" | "acked" | "pong";
	data?: SwitchboardMessage;
	agent?: string;
	pendingMessages?: number;
	id?: string;
	success?: boolean;
	timestamp?: number;
}

// Connection state
let ws: WebSocket | null = null;
let agentName: string | null = null;
let isConnecting = false;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let reconnectTimer: NodeJS.Timeout | null = null;
let sendHandler: ((text: string) => void) | null = null;

// Message queue for messages received while agent is busy
const pendingMessages: SwitchboardMessage[] = [];

/**
 * Format a message for display to the agent
 */
function formatMessage(msg: SwitchboardMessage): string {
	const priorityLabel: Record<string, string> = {
		urgent: "[URGENT]",
		high: "[HIGH]",
		normal: "",
		low: "[low]",
	};

	const typeLabel: Record<string, string> = {
		task: "TASK",
		question: "QUESTION",
		response: "RESPONSE",
		alert: "ALERT",
		info: "INFO",
	};

	const time = new Date(msg.timestamp).toLocaleTimeString();
	const priority = priorityLabel[msg.priority] || "";
	const type = typeLabel[msg.type] || msg.type.toUpperCase();

	let output = `\n--- INCOMING MESSAGE ---\n`;
	output += `${priority} [${type}] From: ${msg.from} @ ${time}\n`;
	if (msg.subject) output += `Subject: ${msg.subject}\n`;
	output += `\n${msg.message}\n`;
	output += `\n(Message ID: ${msg.id})\n`;
	output += `--- END MESSAGE ---\n`;

	return output;
}

/**
 * Process a received message
 */
function handleIncomingMessage(msg: SwitchboardMessage): void {
	if (!sendHandler) {
		// Queue for later if send handler not ready
		pendingMessages.push(msg);
		return;
	}

	const formatted = formatMessage(msg);
	sendHandler!(formatted);

	// Auto-acknowledge low priority info messages
	if (msg.type === "info" && msg.priority === "low" && ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: "ack", id: msg.id }));
	}
}

/**
 * Flush any pending messages
 */
function flushPendingMessages(): void {
	if (!sendHandler || pendingMessages.length === 0) return;

	for (const msg of pendingMessages) {
		const formatted = formatMessage(msg);
		sendHandler(formatted);
	}
	pendingMessages.length = 0;
}

/**
 * Connect to Switchboard via WebSocket
 */
function connect(name: string): void {
	if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;

	isConnecting = true;
	agentName = name;

	const url = `${SWITCHBOARD_WS}?agent=${encodeURIComponent(name)}`;

	try {
		ws = new WebSocket(url);

		ws.on("open", () => {
			isConnecting = false;
			reconnectDelay = INITIAL_RECONNECT_DELAY; // Reset on successful connection
			console.log(`[Communicator] Connected to Switchboard as "${name}"`);
		});

		ws.on("message", (data) => {
			try {
				const event: WebSocketEvent = JSON.parse(data.toString());

				switch (event.type) {
					case "connected":
						console.log(`[Communicator] Registered with ${event.pendingMessages || 0} pending messages`);
						break;

					case "message":
						if (event.data) {
							handleIncomingMessage(event.data);
						}
						break;

					case "ack":
						// Another agent acknowledged our message
						console.log(`[Communicator] Message ${event.id} was acknowledged`);
						break;

					case "emitted":
						console.log(`[Communicator] Message sent: ${event.id}`);
						break;

					case "acked":
						console.log(`[Communicator] Acknowledged: ${event.id}`);
						break;
				}
			} catch (e) {
				console.error("[Communicator] Failed to parse WebSocket message:", e);
			}
		});

		ws.on("close", (code, reason) => {
			isConnecting = false;
			ws = null;
			console.log(`[Communicator] Disconnected (${code}: ${reason || "unknown"})`);

			// Schedule reconnection
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = setTimeout(() => {
				if (agentName) {
					console.log(`[Communicator] Reconnecting in ${reconnectDelay}ms...`);
					connect(agentName);
					reconnectDelay = Math.min(reconnectDelay * RECONNECT_MULTIPLIER, MAX_RECONNECT_DELAY);
				}
			}, reconnectDelay);
		});

		ws.on("error", (err) => {
			isConnecting = false;
			// Error will trigger close event, which handles reconnection
			if ((err as any).code !== "ECONNREFUSED") {
				console.error("[Communicator] WebSocket error:", err.message);
			}
		});
	} catch (e) {
		isConnecting = false;
		console.error("[Communicator] Failed to create WebSocket:", e);
	}
}

/**
 * Disconnect from Switchboard
 */
export function disconnect(): void {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	if (ws) {
		ws.close(1000, "Agent shutting down");
		ws = null;
	}

	agentName = null;
	sendHandler = null;
}

/**
 * Send a message via WebSocket (if connected) or HTTP fallback
 */
async function emitMessage(
	to: string,
	message: string,
	options: { type?: string; priority?: string; subject?: string } = {},
): Promise<boolean> {
	// Try WebSocket first
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(
			JSON.stringify({
				type: "emit",
				to,
				message,
				msgType: options.type || "info",
				priority: options.priority || "normal",
				subject: options.subject,
			}),
		);
		return true;
	}

	// HTTP fallback
	try {
		const response = await fetch(`${SWITCHBOARD_HTTP}/emit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				from: agentName || "anonymous",
				to,
				message,
				type: options.type || "info",
				priority: options.priority || "normal",
				subject: options.subject,
			}),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	// Create a wrapper for sending messages
	const sendToAgent = (text: string) => {
		pi.sendMessage({
			customType: "switchboard",
			content: text,
			display: true,
		});
	};
	sendHandler = sendToAgent;

	pi.on("session_start", async (_event, ctx) => {
		// Derive agent name from project directory
		const projectName = path.basename(ctx.cwd);
		const name = process.env.PI_AGENT_NAME || projectName;

		// Connect via WebSocket
		connect(name);
	});

	// Agent start: Flush any pending messages and check connection
	pi.on("agent_start", async () => {
		// Ensure we have a send handler
		sendHandler = sendToAgent;

		// Flush any messages that arrived while idle
		flushPendingMessages();

		// Check connection health
		if (ws && ws.readyState !== WebSocket.OPEN && agentName) {
			connect(agentName);
		}
	});

	// Agent end: Check for unanswered questions
	pi.on("agent_end", async () => {
		// Could notify about pending questions here if needed
	});

	// Expose emit function for other hooks/tools (via global)
	(globalThis as any).__switchboard_emit = emitMessage;
	(globalThis as any).__switchboard_connected = () => ws?.readyState === WebSocket.OPEN;
}
