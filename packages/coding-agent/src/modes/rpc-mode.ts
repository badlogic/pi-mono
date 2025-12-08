/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events as JSON on stdout.
 */

import * as readline from "readline";
import type { AgentSession } from "../core/agent-session.js";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events on stdout.
 *
 * Commands:
 * - { type: "prompt", message: string, attachments?: Attachment[] }
 * - { type: "abort" }
 * - { type: "compact", customInstructions?: string }
 * - { type: "bash", command: string }
 *
 * Events are output as JSON lines (same format as session manager).
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
	// Output all agent events as JSON
	session.subscribe((event) => {
		console.log(JSON.stringify(event));
	});

	// Listen for JSON input
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on("line", async (line: string) => {
		try {
			const input = JSON.parse(line);

			switch (input.type) {
				case "prompt":
					if (input.message) {
						await session.prompt(input.message, {
							attachments: input.attachments,
							expandSlashCommands: false, // RPC mode doesn't expand slash commands
						});
					}
					break;

				case "abort":
					await session.abort();
					break;

				case "compact":
					try {
						const result = await session.compact(input.customInstructions);
						console.log(JSON.stringify({ type: "compaction", ...result }));
					} catch (error: any) {
						console.log(JSON.stringify({ type: "error", error: `Compaction failed: ${error.message}` }));
					}
					break;

				case "bash":
					if (input.command) {
						try {
							const result = await session.executeBash(input.command);
							console.log(JSON.stringify({ type: "bash_end", ...result }));
						} catch (error: any) {
							console.log(JSON.stringify({ type: "error", error: `Bash failed: ${error.message}` }));
						}
					}
					break;

				default:
					console.log(JSON.stringify({ type: "error", error: `Unknown command: ${input.type}` }));
			}
		} catch (error: any) {
			console.log(JSON.stringify({ type: "error", error: error.message }));
		}
	});

	// Keep process alive forever
	return new Promise(() => {});
}
