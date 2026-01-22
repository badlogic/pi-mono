/**
 * HTTP mode: Headless operation with HTTP/SSE protocol.
 *
 * Used for embedding the agent in containerized deployments without stdin/stdout shim.
 * Exposes the RPC protocol via HTTP REST API with SSE for event streaming.
 *
 * Endpoints:
 * - GET /health - Health check for container orchestration
 * - GET /events - SSE stream of all agent events
 * - POST /rpc - Execute RPC command
 * - POST /extension_ui_response - Handle extension UI responses
 * - POST /shutdown - Graceful shutdown
 */

import type * as http from "node:http";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import { createHttpServer, startHttpServer } from "./http-server.js";

export type HttpModeOptions = {
	port?: number;
	bind?: string;
};

const DEFAULT_PORT = 19000;
const DEFAULT_BIND = "127.0.0.1";
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

// ============================================================================
// SSE Helpers
// ============================================================================

/**
 * Write an SSE event to a response stream.
 */
function writeSseEvent(res: http.ServerResponse, eventType: string, data: unknown): void {
	res.write(`event: ${eventType}\n`);
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Broadcast an SSE event to all connected clients.
 */
function broadcastSseEvent(connections: Set<http.ServerResponse>, eventType: string, data: unknown): void {
	for (const res of connections) {
		try {
			writeSseEvent(res, eventType, data);
		} catch {
			// Connection may have been closed, will be cleaned up on next event
		}
	}
}

/**
 * Determine the SSE event type for an agent session event.
 * All session events are `agent_event`. Extension UI requests are emitted
 * separately in Phase 3 with their own `extension_ui_request` type.
 */
function getSseEventType(_event: AgentSessionEvent): string {
	return "agent_event";
}

/**
 * Run in HTTP mode.
 * Starts an HTTP server that exposes the RPC protocol via HTTP/SSE.
 */
export async function runHttpMode(session: AgentSession, options: HttpModeOptions = {}): Promise<never> {
	const port = options.port ?? DEFAULT_PORT;
	const bind = options.bind ?? DEFAULT_BIND;

	// Track SSE connections for event broadcasting
	const sseConnections = new Set<http.ServerResponse>();

	// Track shutdown state
	let shutdownInitiated = false;

	// Heartbeat timer reference
	let heartbeatTimer: NodeJS.Timeout | undefined;

	// Session event unsubscribe function
	let unsubscribeSession: (() => void) | undefined;

	// Shutdown handler
	const handleShutdown = async () => {
		if (shutdownInitiated) return;
		shutdownInitiated = true;

		console.log("HTTP mode: shutting down...");

		// Stop heartbeat timer
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}

		// Unsubscribe from session events
		if (unsubscribeSession) {
			unsubscribeSession();
			unsubscribeSession = undefined;
		}

		// Close all SSE connections
		for (const res of sseConnections) {
			try {
				res.end();
			} catch {
				// Ignore errors during shutdown
			}
		}
		sseConnections.clear();

		// TODO: Emit session_shutdown event to extensions (Task 4.2)

		// Close HTTP server
		await serverHandle.close();

		process.exit(0);
	};

	// Create HTTP server
	const serverHandle = createHttpServer({
		port,
		bind,
		session,
		onShutdown: handleShutdown,
		sseConnections,
	});

	// Handle server-level errors
	serverHandle.server.on("error", (err) => {
		console.error(`HTTP server error: ${err.message}`);
		process.exit(1);
	});

	// Subscribe to session events and broadcast via SSE
	unsubscribeSession = session.subscribe((event: AgentSessionEvent) => {
		const eventType = getSseEventType(event);
		broadcastSseEvent(sseConnections, eventType, event);
	});

	// Start heartbeat timer
	heartbeatTimer = setInterval(() => {
		broadcastSseEvent(sseConnections, "heartbeat", { timestamp: Date.now() });
	}, HEARTBEAT_INTERVAL_MS);

	// Start listening
	await startHttpServer(serverHandle, port, bind);
	console.log(`HTTP mode: listening on http://${bind}:${port}`);

	// Handle graceful shutdown signals
	process.on("SIGTERM", handleShutdown);
	process.on("SIGINT", handleShutdown);

	// Keep process alive forever
	return new Promise(() => {});
}
