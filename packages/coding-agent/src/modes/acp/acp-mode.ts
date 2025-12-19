/**
 * ACP mode: Agent Client Protocol server over stdio.
 *
 * Implements ACP v1 using JSON-RPC over stdin/stdout.
 * Used for integrating pi with editors like Zed that speak ACP.
 *
 * Protocol:
 * - Uses @agentclientprotocol/sdk for JSON-RPC transport
 * - Supports session management, prompting, and streaming responses
 * - Events are streamed via ACP sessionUpdate notifications
 */

import { ReadableStream, WritableStream } from "node:stream/web";
import { type Stream as AcpStream, AgentSideConnection, type AnyMessage } from "@agentclientprotocol/sdk";
import { AcpAgent, type AcpAgentConfig } from "./acp-agent.js";

/**
 * Run in ACP mode.
 * Sets up JSON-RPC over stdin/stdout and creates an ACP agent server.
 */
export async function runAcpMode(): Promise<never> {
	const cwd = process.cwd();

	// Build ACP stream (NDJSON over stdio)
	const encoder = new TextEncoder();
	let buffer = "";

	const stream = {
		writable: new WritableStream<AnyMessage>({
			write(message) {
				const line = JSON.stringify(message) + "\n";
				return new Promise<void>((resolve, reject) => {
					process.stdout.write(encoder.encode(line), (err) => {
						if (err) reject(err);
						else resolve();
					});
				});
			},
		}),
		readable: new ReadableStream<AnyMessage>({
			start(controller) {
				process.stdin.on("data", (chunk: Buffer) => {
					buffer += chunk.toString("utf8");
					let newlineIndex = buffer.indexOf("\n");
					while (newlineIndex !== -1) {
						const line = buffer.slice(0, newlineIndex).trim();
						buffer = buffer.slice(newlineIndex + 1);
						if (line.length === 0) {
							newlineIndex = buffer.indexOf("\n");
							continue;
						}
						try {
							const message = JSON.parse(line) as AnyMessage;
							controller.enqueue(message);
						} catch (err) {
							console.error("Failed to parse ACP message:", err);
						}
						newlineIndex = buffer.indexOf("\n");
					}
				});
				process.stdin.on("end", () => controller.close());
				process.stdin.on("error", (err) => controller.error(err));
			},
		}),
	} as unknown as AcpStream;

	// Create ACP agent config
	const config: AcpAgentConfig = {
		cwd,
	};

	// Set up ACP connection with agent factory
	new AgentSideConnection((conn) => {
		return new AcpAgent(conn, config);
	}, stream);

	// Keep stdin open
	process.stdin.resume();

	// Wait forever
	return new Promise(() => {});
}
