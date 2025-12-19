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
 *
 * Debugging:
 * - Set PI_ACP_DEBUG=1 to enable logging to /tmp/pi-acp.log
 * - Set PI_ACP_DEBUG=/path/to/file.log to log to a custom file
 */

import * as fs from "node:fs";
import { ReadableStream, WritableStream } from "node:stream/web";
import { type Stream as AcpStream, AgentSideConnection, type AnyMessage } from "@agentclientprotocol/sdk";
import { AcpAgent, type AcpAgentConfig } from "./acp-agent.js";

const DEBUG_ENV = process.env.PI_ACP_DEBUG;
/**
 * PI_ACP_DEBUG:
 * - unset/""/0: disabled
 * - "1": enabled, logs to /tmp/pi-acp.log
 * - any other value: treated as a path to a log file
 */
const DEBUG_ENABLED = DEBUG_ENV !== undefined && DEBUG_ENV !== "" && DEBUG_ENV !== "0";
const LOG_FILE = DEBUG_ENV && DEBUG_ENV !== "1" && DEBUG_ENV !== "0" ? DEBUG_ENV : "/tmp/pi-acp.log";

let logStream: fs.WriteStream | null = null;

function getLogStream(): fs.WriteStream | null {
	if (!DEBUG_ENABLED) return null;
	if (!logStream) {
		logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
	}
	return logStream;
}

/**
 * Log a message to the ACP log file.
 * Only logs when PI_ACP_DEBUG environment variable is set.
 * Use this instead of console.log/console.error in ACP mode since stdio is used for the protocol.
 */
function formatLogArg(value: unknown): string {
	if (value instanceof Error) {
		return value.stack || value.message;
	}
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function acpLog(level: "info" | "error" | "debug", message: string, ...args: unknown[]): void {
	const stream = getLogStream();
	if (!stream) return;

	const timestamp = new Date().toISOString();
	const formatted = args.length > 0 ? `${message} ${args.map(formatLogArg).join(" ")}` : message;
	const line = `[${timestamp}] [${level.toUpperCase()}] ${formatted}\n`;
	stream.write(line);
}

function setupErrorHandlers(): void {
	process.on("exit", () => {
		if (logStream) {
			logStream.end();
			logStream = null;
		}
	});

	process.on("uncaughtException", (err) => {
		acpLog("error", "Uncaught exception:", err.stack || err.message);
		if (logStream) {
			logStream.end(() => process.exit(1));
		} else {
			process.exit(1);
		}
	});

	process.on("unhandledRejection", (reason) => {
		acpLog("error", "Unhandled rejection:", reason);
	});

	acpLog("info", "ACP mode started", { pid: process.pid, cwd: process.cwd() });
}

/**
 * Run in ACP mode.
 * Sets up JSON-RPC over stdin/stdout and creates an ACP agent server.
 */
export async function runAcpMode(): Promise<never> {
	setupErrorHandlers();
	const cwd = process.cwd();

	// Build ACP stream (NDJSON over stdio)
	const encoder = new TextEncoder();
	let buffer = "";

	const stream = {
		writable: new WritableStream<AnyMessage>({
			write(message) {
				acpLog("debug", ">>> SEND", message);
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
							acpLog("debug", "<<< RECV", message);
							controller.enqueue(message);
						} catch (err) {
							acpLog("error", "Failed to parse ACP message:", err);
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
