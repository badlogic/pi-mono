/**
 * ACP mode: Agent Client Protocol implementation for pi.
 *
 * Enables pi to act as an ACP-compliant agent, allowing integration with
 * ACP-compatible clients like Zed, JetBrains IDEs, and other editors.
 *
 * Uses JSON-RPC over stdio via the @agentclientprotocol/sdk package.
 *
 * Debug logging: Set PI_ACP_DEBUG=1 to enable stderr logging.
 */

import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentSession } from "../../core/agent-session.js";
import { PiAgent } from "./acp-agent.js";

/** Debug logger for ACP mode - outputs to stderr to avoid interfering with JSON-RPC on stdout */
export function acpDebug(msg: string): void {
	if (process.env.PI_ACP_DEBUG) {
		process.stderr.write(`[ACP] ${msg}\n`);
	}
}

/**
 * Run pi in ACP mode.
 *
 * Sets up the ACP connection using stdin/stdout and handles all protocol
 * communication until the connection closes.
 *
 * @param session - The AgentSession to use for handling requests
 * @returns Promise that never resolves (connection stays open until closed)
 */
export async function runAcpMode(session: AgentSession): Promise<never> {
	// Create ndJsonStream from stdin/stdout
	// The SDK expects Web Streams, so we convert Node.js streams
	const stream = acp.ndJsonStream(
		Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
		Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
	);

	acpDebug("Starting ACP mode");

	// Create the AgentSideConnection with our PiAgent implementation
	const connection = new acp.AgentSideConnection((conn) => new PiAgent(session, conn), stream);

	acpDebug("Connection established, waiting for requests");

	// Wait for connection to close (never resolves during normal operation)
	await connection.closed;

	acpDebug("Connection closed");

	// If connection closes, exit the process
	process.exit(0);
}
