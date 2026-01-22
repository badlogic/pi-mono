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

import * as http from "node:http";
import type { AgentSession } from "../../core/agent-session.js";

export type HttpModeOptions = {
	port?: number;
	bind?: string;
};

const DEFAULT_PORT = 19000;
const DEFAULT_BIND = "127.0.0.1";

/**
 * Run in HTTP mode.
 * Starts an HTTP server that exposes the RPC protocol via HTTP/SSE.
 */
export async function runHttpMode(_session: AgentSession, options: HttpModeOptions = {}): Promise<never> {
	const port = options.port ?? DEFAULT_PORT;
	const bind = options.bind ?? DEFAULT_BIND;

	const server = http.createServer((_req, res) => {
		// Placeholder - actual routing will be implemented in Task 2.1
		res.writeHead(503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Not implemented yet" }));
	});

	// Handle server errors
	server.on("error", (err) => {
		console.error(`HTTP server error: ${err.message}`);
		process.exit(1);
	});

	// Start listening
	await new Promise<void>((resolve) => {
		server.listen(port, bind, () => {
			console.log(`HTTP mode: listening on http://${bind}:${port}`);
			resolve();
		});
	});

	// Handle graceful shutdown
	const shutdown = () => {
		console.log("HTTP mode: shutting down...");
		server.close(() => {
			process.exit(0);
		});
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	// Keep process alive forever
	return new Promise(() => {});
}
