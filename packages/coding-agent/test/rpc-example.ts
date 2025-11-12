import { spawn } from "node:child_process";
import { dirname, join } from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";

/**
 * Interactive example of using coding-agent in RPC mode
 * Usage: npx tsx test/rpc-example.ts
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// Spawn agent in RPC mode
const agent = spawn("node", ["dist/cli.js", "--mode", "rpc", "--no-session"], {
	cwd: join(__dirname, ".."),
	env: process.env,
});

let isWaiting = false;

// Parse agent events
readline.createInterface({ input: agent.stdout, terminal: false }).on("line", (line: string) => {
	try {
		const event = JSON.parse(line);

		if (event.type === "agent_start") isWaiting = true;

		if (event.type === "message_update") {
			const { assistantMessageEvent } = event;
			if (assistantMessageEvent.type === "text_delta" || assistantMessageEvent.type === "thinking_delta") {
				process.stdout.write(assistantMessageEvent.delta);
			}
		}

		if (event.type === "tool_execution_start") {
			console.log(`\n[Tool: ${event.toolName}]`);
		}

		if (event.type === "tool_execution_end") {
			console.log(`[Result: ${JSON.stringify(event.result, null, 2)}]\n`);
		}

		if (event.type === "agent_end") {
			console.log("\n");
			isWaiting = false;
			process.stdout.write("You: ");
		}
	} catch (error) {
		console.error("Parse error:", line);
	}
});

// Handle user input
const stdinReader = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: true,
});

stdinReader.on("line", (line: string) => {
	if (isWaiting) return;
	isWaiting = true;
	agent.stdin.write(JSON.stringify({ type: "prompt", message: line }) + "\n");
});

// Capture readline's SIGINT and handle it ourselves
stdinReader.on("SIGINT", () => {
	process.emit("SIGINT", "SIGINT");
});

// Handle Ctrl+C
process.on("SIGINT", () => {
	if (isWaiting) {
		console.log("\n[Aborting...]");
		agent.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
	} else {
		agent.kill();
		process.exit(0);
	}
});

agent.stderr.on("data", (data) => console.error("Error:", data.toString()));

console.log("Interactive RPC mode example. Type 'exit' to quit.\n");
process.stdout.write("You: ");
