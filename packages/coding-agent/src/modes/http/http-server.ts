/**
 * HTTP server implementation for HTTP mode.
 *
 * Uses Node.js native http module - no external dependencies.
 * Provides routing, JSON body parsing, and response serialization.
 */

import * as http from "node:http";
import { VERSION } from "../../config.js";
import type { AgentSession } from "../../core/agent-session.js";
import { createCommandHandler } from "../rpc/rpc-commands.js";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "../rpc/rpc-types.js";
import type { PendingExtensionRequests } from "./http-mode.js";

// ============================================================================
// Types
// ============================================================================

export type HttpServerOptions = {
	port: number;
	bind: string;
	session: AgentSession;
	onShutdown: () => void;
	/** Set of active SSE connections. Managed externally for event broadcasting. */
	sseConnections: Set<http.ServerResponse>;
	/** Map of pending extension UI requests. Managed externally, resolved by /extension_ui_response handler. */
	pendingExtensionRequests: PendingExtensionRequests;
};

export type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	body: string | null,
) => Promise<void> | void;

export type HttpServerHandle = {
	server: http.Server;
	close: () => Promise<void>;
};

// ============================================================================
// Constants
// ============================================================================

const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
const RPC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for long-running commands

// ============================================================================
// Response helpers
// ============================================================================

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
	sendJson(res, status, { error: message });
}

function send204(res: http.ServerResponse): void {
	res.writeHead(204);
	res.end();
}

// ============================================================================
// Body parser
// ============================================================================

function parseBody(req: http.IncomingMessage): Promise<string | null> {
	return new Promise((resolve, reject) => {
		// Skip body parsing for GET requests
		if (req.method === "GET") {
			resolve(null);
			return;
		}

		const chunks: Buffer[] = [];
		let size = 0;

		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			chunks.push(chunk);
		});

		req.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf8");
			resolve(body);
		});

		req.on("error", (err) => {
			reject(err);
		});
	});
}

// ============================================================================
// Timeout helper
// ============================================================================

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(message));
		}, ms);

		promise
			.then((result) => {
				clearTimeout(timeoutId);
				resolve(result);
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				reject(err);
			});
	});
}

// ============================================================================
// Router
// ============================================================================

type RouteKey = `${string} ${string}`;

function createRouter(routes: Map<RouteKey, RouteHandler>): RouteHandler {
	return async (req, res, body) => {
		const method = req.method ?? "GET";
		// Strip query string from URL for routing
		const url = req.url ?? "/";
		const path = url.split("?")[0];
		const key = `${method} ${path}` as RouteKey;

		const handler = routes.get(key);
		if (handler) {
			await handler(req, res, body);
		} else {
			sendError(res, 404, `Not found: ${method} ${path}`);
		}
	};
}

// ============================================================================
// Route handlers (placeholders for now)
// ============================================================================

function createHealthHandler(options: HttpServerOptions): RouteHandler {
	return (req, res) => {
		const { session } = options;

		// Determine readiness - ready when not in error state
		const ready = !session.state.error;

		const healthResponse = {
			status: "ok",
			ready,
			version: VERSION,
			sessionId: session.sessionId,
			isStreaming: session.isStreaming,
		};

		// Parse query string for readiness probe support
		const url = req.url ?? "/";
		const queryStart = url.indexOf("?");
		const queryString = queryStart >= 0 ? url.slice(queryStart + 1) : "";
		const params = new URLSearchParams(queryString);

		// K8s readiness probe: if ?ready=true and not ready, return 503
		if (params.get("ready") === "true" && !ready) {
			sendJson(res, 503, healthResponse);
			return;
		}

		sendJson(res, 200, healthResponse);
	};
}

function createEventsHandler(options: HttpServerOptions): RouteHandler {
	return (_req, res) => {
		const { sseConnections } = options;

		// Set SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no", // Disable nginx proxy buffering
		});
		res.flushHeaders();

		// Add to connection set
		sseConnections.add(res);

		// Clean up on client disconnect
		res.on("close", () => {
			sseConnections.delete(res);
		});

		// Keep connection alive - do NOT call res.end()
	};
}

function createRpcHandler(options: HttpServerOptions): RouteHandler {
	const { session } = options;

	// Create the shared command handler
	const handleCommand = createCommandHandler({
		session,
		// For HTTP mode, async errors are not propagated back since the response
		// has already been sent. The client should subscribe to SSE events to
		// receive streaming updates and errors.
		onAsyncError: undefined,
	});

	return async (_req, res, body) => {
		if (!body) {
			sendError(res, 400, "Request body required");
			return;
		}

		// Parse the command
		let command: RpcCommand;
		try {
			command = JSON.parse(body) as RpcCommand;
		} catch {
			sendError(res, 400, "Invalid JSON");
			return;
		}

		// Validate command has a type
		if (!command || typeof command.type !== "string") {
			sendError(res, 400, "Invalid command: missing type field");
			return;
		}

		// Execute the command with timeout
		try {
			const response = await withTimeout(handleCommand(command), RPC_TIMEOUT_MS, "Command timed out");

			// Determine status code based on response success
			const status = response.success ? 200 : 400;
			sendJson(res, status, response);
		} catch (err) {
			// Handle timeout or other errors
			const message = err instanceof Error ? err.message : "Internal server error";
			const errorResponse: RpcResponse = {
				id: command.id,
				type: "response",
				command: command.type,
				success: false,
				error: message,
			};
			sendJson(res, 500, errorResponse);
		}
	};
}

function createShutdownHandler(options: HttpServerOptions): RouteHandler {
	return (_req, res) => {
		// Send 204 immediately, then trigger shutdown
		send204(res);
		// Use setImmediate to ensure response is sent before shutdown begins
		setImmediate(() => {
			options.onShutdown();
		});
	};
}

function createExtensionUIResponseHandler(options: HttpServerOptions): RouteHandler {
	const { pendingExtensionRequests } = options;

	return (_req, res, body) => {
		if (!body) {
			sendError(res, 400, "Request body required");
			return;
		}

		let response: RpcExtensionUIResponse;
		try {
			response = JSON.parse(body) as RpcExtensionUIResponse;
		} catch {
			sendError(res, 400, "Invalid JSON");
			return;
		}

		// Validate response has required fields
		if (!response || response.type !== "extension_ui_response" || typeof response.id !== "string") {
			sendError(res, 400, "Invalid extension UI response: missing type or id field");
			return;
		}

		// Find and resolve the pending request
		const pending = pendingExtensionRequests.get(response.id);
		if (!pending) {
			// Request may have timed out or been cancelled - not an error
			sendJson(res, 200, { success: true, message: "Request not found (may have timed out)" });
			return;
		}

		// Resolve the pending request
		pendingExtensionRequests.delete(response.id);
		pending.resolve(response);

		sendJson(res, 200, { success: true });
	};
}

// ============================================================================
// Server factory
// ============================================================================

export function createHttpServer(options: HttpServerOptions): HttpServerHandle {
	// Build route table
	const routes = new Map<RouteKey, RouteHandler>();

	routes.set("GET /health", createHealthHandler(options));
	routes.set("GET /events", createEventsHandler(options));
	routes.set("POST /rpc", createRpcHandler(options));
	routes.set("POST /shutdown", createShutdownHandler(options));
	routes.set("POST /extension_ui_response", createExtensionUIResponseHandler(options));

	const router = createRouter(routes);

	// Track if server is shutting down
	let isShuttingDown = false;

	// Create HTTP server
	const server = http.createServer(async (req, res) => {
		// Reject requests during shutdown
		if (isShuttingDown) {
			sendError(res, 503, "Server is shutting down");
			return;
		}

		try {
			// Parse body (with size limit)
			const body = await parseBody(req);

			// Route the request
			await router(req, res, body);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Internal server error";

			// Check for body size error
			if (message === "Request body too large") {
				sendError(res, 400, message);
				return;
			}

			// Log unexpected errors
			console.error(`HTTP server error: ${message}`);
			sendError(res, 500, message);
		}
	});

	// Graceful close function
	const close = (): Promise<void> => {
		return new Promise((resolve) => {
			isShuttingDown = true;
			server.close(() => {
				resolve();
			});
		});
	};

	return { server, close };
}

/**
 * Start the HTTP server and return when it's listening.
 */
export async function startHttpServer(handle: HttpServerHandle, port: number, bind: string): Promise<void> {
	return new Promise((resolve, reject) => {
		handle.server.on("error", (err) => {
			reject(err);
		});

		handle.server.listen(port, bind, () => {
			resolve();
		});
	});
}
