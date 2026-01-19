/**
 * ACP mode: Agent Client Protocol implementation for pi.
 *
 * Enables pi to act as an ACP-compliant agent, allowing integration with
 * ACP-compatible clients like Zed, JetBrains IDEs, and other editors.
 *
 * Uses JSON-RPC over stdio via the @agentclientprotocol/sdk package.
 */

import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentSession } from "../../core/agent-session.js";
import { PiAgent } from "./acp-agent.js";

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

	// Create the AgentSideConnection with our PiAgent implementation
	const connection = new acp.AgentSideConnection((conn) => new PiAgent(session, conn), stream);

	// Wait for connection to close (never resolves during normal operation)
	await connection.closed;

	// If connection closes, exit the process
	process.exit(0);
}
